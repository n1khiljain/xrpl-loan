/**
 * The browser's anon key can't read or write any table. This goes through the real API
 * gateway and PostgREST on the local stack, the same path a browser would take. `supabase/tests/database` checks
 * the same thing inside Postgres.
 */
import { assert, assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { LOCAL_STACK } from "../_shared/local-stack.ts";

const EXPECTED_TABLES = [
  "admin_actions",
  "claim_documents",
  "claims",
  "guarantor_invites",
  "ledger_txs",
  "notifications",
  "once_keys",
  "org_officers",
  "orgs",
  "profiles",
  "staff",
  "sync_state",
  "wallets",
];

/** Every table PostgREST exposes, and one real column of each, from its OpenAPI document (service role). */
async function exposedTables(url: string, serviceKey: string): Promise<Map<string, string>> {
  const res = await fetch(`${url}/rest/v1/`, { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } });
  const spec = (await res.json()) as { paths: Record<string, unknown>; definitions: Record<string, { properties: Record<string, unknown> }> };
  const tables = Object.keys(spec.paths)
    .map((p) => p.replace(/^\//, ""))
    .filter((p) => p !== "" && !p.startsWith("rpc/"))
    .sort();
  return new Map(tables.map((t) => [t, Object.keys(spec.definitions[t]?.properties ?? {})[0] ?? "id"]));
}

Deno.test({
  name: "the anon key cannot select from, insert into, update, or delete from any table",
  ignore: LOCAL_STACK === null,
  async fn() {
    const stack = LOCAL_STACK!;
    const columns = await exposedTables(stack.url, stack.serviceKey);
    const tables = [...columns.keys()];
    assertEquals(tables, EXPECTED_TABLES, "the API exposes exactly our tables, and the test covers each one");

    // a row in every table the browser might go looking for, so an empty result can't pass for a denial
    const service = createClient(stack.url, stack.serviceKey, { auth: { persistSession: false } });
    const probe = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
    await service.from("staff").upsert({ wallet_address: probe, role: "admin" });
    await service.from("sync_state").upsert({ key: "anon-probe", last_ledger: 1 });

    const keys = [["anon", stack.anonKey], ...(stack.publishableKey ? [["publishable", stack.publishableKey]] : [])];
    try {
      for (const [label, key] of keys) {
        const headers = { apikey: key as string, authorization: `Bearer ${key}`, "content-type": "application/json" };
        for (const table of tables) {
          const select = await fetch(`${stack.url}/rest/v1/${table}?select=*`, { headers });
          const body = await select.json();
          assert(select.status === 401 || select.status === 403, `${label} select ${table}: HTTP ${select.status} ${JSON.stringify(body)}`);
          assertEquals(body.code, "42501", `${label} select ${table}`);

          const insert = await fetch(`${stack.url}/rest/v1/${table}`, { method: "POST", headers, body: "{}" });
          await insert.body?.cancel();
          assert(insert.status === 401 || insert.status === 403, `${label} insert ${table}: HTTP ${insert.status}`);

          const update = await fetch(`${stack.url}/rest/v1/${table}?${columns.get(table)}=not.is.null`, {
            method: "PATCH",
            headers,
            body: "{}",
          });
          await update.body?.cancel();
          assert(update.status === 401 || update.status === 403, `${label} update ${table}: HTTP ${update.status}`);

          // a filter on a real column, since PostgREST refuses an unfiltered DELETE before checking privileges
          const del = await fetch(`${stack.url}/rest/v1/${table}?${columns.get(table)}=not.is.null`, { method: "DELETE", headers });
          await del.body?.cancel();
          assert(del.status === 401 || del.status === 403, `${label} delete ${table}: HTTP ${del.status}`);
        }

        const rpc = await fetch(`${stack.url}/rest/v1/rpc/reserve_gas_drip`, {
          method: "POST",
          headers,
          body: JSON.stringify({ p_wallet: probe, p_window_seconds: 1 }),
        });
        await rpc.body?.cancel();
        assert(rpc.status >= 400, `${label} rpc reserve_gas_drip: HTTP ${rpc.status}`);
      }
    } finally {
      await service.from("staff").delete().eq("wallet_address", probe);
      await service.from("sync_state").delete().eq("key", "anon-probe");
    }
  },
});

Deno.test({
  name: "the anon key cannot list or download receipts",
  ignore: LOCAL_STACK === null,
  async fn() {
    const stack = LOCAL_STACK!;
    const service = createClient(stack.url, stack.serviceKey, { auth: { persistSession: false } });
    const path = `anon-probe/${crypto.randomUUID()}`;
    const upload = await service.storage.from("receipts").upload(path, new Blob(["%PDF-1.7 secret"], { type: "application/pdf" }));
    assertEquals(upload.error, null);
    try {
      const anon = createClient(stack.url, stack.anonKey, { auth: { persistSession: false } });
      const listed = await anon.storage.from("receipts").list("anon-probe");
      assertEquals(listed.data ?? [], []);
      const download = await anon.storage.from("receipts").download(path);
      assert(download.error !== null && download.data === null, "anon must not download a receipt");
      const publicUrl = await fetch(`${stack.url}/storage/v1/object/public/receipts/${path}`);
      await publicUrl.body?.cancel();
      assert(publicUrl.status >= 400, `public URL answered ${publicUrl.status}`);
      const write = await anon.storage.from("receipts").upload(`anon-probe/${crypto.randomUUID()}`, new Blob(["x"], { type: "application/pdf" }));
      assert(write.error !== null, "anon must not upload a receipt");
    } finally {
      await service.storage.from("receipts").remove([path]);
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
