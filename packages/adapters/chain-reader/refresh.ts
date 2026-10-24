import { type ClaimView, FINAL_CLAIM_STATES } from "../shared/claims.ts";
import type { ChainReader } from "./types.ts";

/**
 * Every claim, like `listClaims()`, but claims already in a final state are carried over from `previous` instead of
 * read again: nothing about them can change (I-6). A dashboard that polls then pays one read per open or new claim,
 * not one per claim ever made. Pass `[]` the first time. The result is in ID order.
 */
export async function refreshClaims(reader: Pick<ChainReader, "claimCount" | "getClaims">, previous: readonly ClaimView[]): Promise<ClaimView[]> {
  const count = await reader.claimCount();
  // IDs only grow, so a lower count means a different chain (a restarted anvil); start over
  const known = previous.reduce((max, c) => (c.id > max ? c.id : max), 0n);
  const carried = new Map(known > count ? [] : previous.filter((c) => FINAL_CLAIM_STATES.includes(c.state)).map((c) => [c.id, c] as const));
  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));
  const stale = ids.filter((id) => !carried.has(id));
  const fresh = new Map((stale.length > 0 ? await reader.getClaims(stale) : []).map((c) => [c.id, c] as const));
  return ids.map((id) => carried.get(id) ?? fresh.get(id)).filter((c): c is ClaimView => c !== undefined && c.state !== "None");
}
