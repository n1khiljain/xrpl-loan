/**
 * Local only: makes an XRPL address staff on the local Supabase stack, for `pnpm local` and the demo script.
 *   deno run --allow-all --config supabase/functions/deno.json supabase/functions/_tests/local-underwriter.ts <address> [role]
 * Refuses any Supabase that isn't on this machine, and the seed makes nobody staff, so a `db reset` against a hosted
 * project can never install a demo account as staff. Hosted projects add staff by hand.
 */
import { LOCAL_STACK, type LocalStack } from "../_shared/local-stack.ts";
import type { StaffRole } from "../_shared/db/types.ts";

export function assertLocal(url: string): void {
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1", "host.docker.internal"].includes(host)) {
    throw new Error(`refusing to add staff to ${url}: local only`);
  }
}

export async function ensureLocalStaff(stack: Pick<LocalStack, "url" | "serviceKey">, address: string, role: StaffRole): Promise<void> {
  assertLocal(stack.url);
  if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address)) throw new Error(`${address} is not an XRPL address`);
  const res = await fetch(`${stack.url}/rest/v1/staff?on_conflict=wallet_address`, {
    method: "POST",
    headers: {
      apikey: stack.serviceKey,
      authorization: `Bearer ${stack.serviceKey}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ wallet_address: address, role }),
  });
  if (!res.ok) throw new Error(`adding local staff failed: ${res.status} ${await res.text()}`);
  await res.body?.cancel();
}

if (import.meta.main) {
  if (!LOCAL_STACK) throw new Error("no local Supabase running (supabase start)");
  const [address, role = "underwriter"] = Deno.args;
  if (!address) throw new Error("usage: local-underwriter.ts <address> [underwriter|attester|admin]");
  await ensureLocalStaff(LOCAL_STACK, address, role as StaffRole);
  console.log(`staff: ${address} is a local ${role}`);
}
