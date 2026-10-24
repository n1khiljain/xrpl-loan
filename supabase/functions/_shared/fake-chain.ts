import type { ChainEvent, ChainReader, ClaimView } from "@app/adapters";
import { onchainClaim } from "./testing.ts";

/** A ChainReader over in-memory claims and events, for function tests. */
export class FakeChain implements ChainReader {
  readonly kind = "rpc" as const;
  readonly claims = new Map<bigint, ClaimView>();
  events: ChainEvent[] = [];
  head = 0n;
  readonly ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];

  set(id: bigint, overrides: Partial<ClaimView> = {}) {
    this.claims.set(id, onchainClaim({ id, ...overrides }));
  }
  getPoolStats(): Promise<never> {
    return Promise.reject(new Error("not used"));
  }
  getClaim(id: bigint) {
    return Promise.resolve(this.claims.get(id) ?? onchainClaim({ id, state: "None" }));
  }
  getClaims(ids: readonly bigint[]) {
    return Promise.all(ids.map((id) => this.getClaim(id)));
  }
  claimCount() {
    return Promise.resolve([...this.claims.keys()].reduce((max, id) => (id > max ? id : max), 0n));
  }
  listClaims() {
    return Promise.resolve([...this.claims.values()]);
  }
  getOrgExposure() {
    return Promise.resolve([]);
  }
  getClaimEvents() {
    return Promise.resolve([]);
  }
  getEvents(range: { fromBlock: bigint; toBlock?: bigint }) {
    const toBlock = range.toBlock !== undefined && range.toBlock < this.head ? range.toBlock : this.head;
    this.ranges.push({ fromBlock: range.fromBlock, toBlock });
    const events = this.events.filter((e) => e.blockNumber >= range.fromBlock && e.blockNumber <= toBlock);
    return Promise.resolve({ events, toBlock });
  }
}
