import type { Address } from "viem";
import type { ChainEvent, ClaimEvent, ClaimState, ClaimView } from "../shared/claims.ts";

export type PoolStats = {
  totalAssets: bigint;
  idleCash: bigint;
  outstandingPrincipal: bigint;
  /** Gross principal written off (U-46). */
  totalLosses: bigint;
  totalSupply: bigint;
  /** frxUSD wei one whole pool share redeems for. */
  sharePrice: bigint;
  /** Pool share decimals: frxUSD's 18 plus the vault's offset. */
  shareDecimals: number;
};

export type ClaimFilter = {
  recipient?: Address;
  guarantor?: Address;
  orgId?: bigint;
  states?: readonly ClaimState[];
};

/** `cap` is what purchases are checked against: the org's own cap if the admin set one, else `perOrgCap` (U-69). */
export type OrgExposure = { orgId: bigint; name: string; active: boolean; outstanding: bigint; cap: bigint; customCap: boolean };

export type EventRange = { fromBlock: bigint; toBlock?: bigint };

/**
 * Reads pool and claim state for dashboards and `chain-sync` (SYSTEM_DESIGN section 4). `getEvents` is the extra
 * read `chain-sync` needs to rebuild `status_cache`, `orgs`, and `org_officers`.
 */
export interface ChainReader {
  readonly kind: "rpc" | "goldsky";
  getPoolStats(): Promise<PoolStats>;
  /** A claim ID that was never used comes back with state `None`. */
  getClaim(id: bigint): Promise<ClaimView>;
  getClaims(ids: readonly bigint[]): Promise<ClaimView[]>;
  /** Claim IDs run from 1 through this number; every one of them is a real claim. */
  claimCount(): Promise<bigint>;
  listClaims(filter?: ClaimFilter): Promise<ClaimView[]>;
  getOrgExposure(): Promise<OrgExposure[]>;
  getClaimEvents(id: bigint): Promise<ClaimEvent[]>;
  /**
   * Every claim and org event from `fromBlock` through `toBlock`, oldest first. `toBlock` defaults to, and is
   * capped at, the newest block the reader can see. The result says which block it read through.
   */
  getEvents(range: EventRange): Promise<{ events: ChainEvent[]; toBlock: bigint }>;
}

export function matchesFilter(claim: ClaimView, filter: ClaimFilter): boolean {
  const same = (a: Address, b: Address) => a.toLowerCase() === b.toLowerCase();
  if (claim.state === "None") return false;
  if (filter.recipient && !same(claim.recipient, filter.recipient)) return false;
  if (filter.guarantor && !same(claim.guarantor, filter.guarantor)) return false;
  if (filter.orgId !== undefined && claim.orgId !== filter.orgId) return false;
  if (filter.states && !filter.states.includes(claim.state)) return false;
  return true;
}
