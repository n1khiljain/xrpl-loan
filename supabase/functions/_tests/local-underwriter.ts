/**
 * Local only: makes anvil's first dev account the offchain underwriter, matching Deploy.s.sol, which gives it every
 * onchain role on local. This used to sit in supabase/seed.sql, where any `db reset` would install a publicly known
 * key as staff (security campaign E-6a); now `pnpm local` and `pnpm demo` (scripts/local-demo.ts), the Playwright setup, and the backend e2e test call it.
 *   deno run --allow-all --config supabase/functions/deno.json supabase/functions/_tests/local-underwriter.ts
 * Refuses any Supabase that isn't on this machine. Hosted projects add staff by hand (docs/RUNBOOK.md).
 */
import { LOCAL_STACK, type LocalStack } from "../_shared/local-stack.ts";

/** anvil's account 0 from the public dev mnemonic, lowercase as `staff` stores it. */
export const ANVIL_UNDERWRITER = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

export async function ensureLocalUnderwriter(stack: Pick<LocalStack, "url" | "serviceKey">): Promise<void> {
  const host = new URL(stack.url).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error(`refusing to add the anvil underwriter to ${stack.url}: local only`);
  const res = await fetch(`${stack.url}/rest/v1/staff?on_conflict=wallet_address`, {
    method: "POST",
    headers: {
      apikey: stack.serviceKey,
      authorization: `Bearer ${stack.serviceKey}`,
      "content-type": "application/json",
      prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify({ wallet_address: ANVIL_UNDERWRITER, role: "underwriter" }),
  });
  if (!res.ok) throw new Error(`adding the local underwriter failed: ${res.status} ${await res.text()}`);
  await res.body?.cancel();
}

if (import.meta.main) {
  if (!LOCAL_STACK) throw new Error("no local Supabase running (supabase start)");
  await ensureLocalUnderwriter(LOCAL_STACK);
  console.log(`staff: ${ANVIL_UNDERWRITER} is the local underwriter`);
}
