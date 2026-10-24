import { claimRegistryAbi, orgRegistryAbi } from "@app/abi";
import { type AbiEvent, type Hash, getAddress } from "viem";
import type { Fetch } from "../shared/chain.ts";
import {
  CLAIM_EVENT_NAMES,
  type ChainEvent,
  type ClaimEvent,
  type EventArg,
  ORG_EVENT_NAMES,
  compareEvents,
} from "../shared/claims.ts";
import { UpstreamError } from "../shared/errors.ts";
import { type ChainReader, type ClaimFilter, type EventRange, matchesFilter } from "./types.ts";

/**
 * Mainnet ChainReader. Current state (pool stats, claims, exposure) still comes from the chain, through the RPC
 * reader passed in, because a subgraph lags and only indexes events. History comes from a Goldsky subgraph built
 * straight from our ABI (U-22).
 *
 * The queries assume Goldsky's instant-subgraph schema: one entity per event, named after the event, with the
 * event's parameters as fields plus `block_number` and `transactionHash_`, and an `id` of the transaction hash
 * followed by the log index as 4 little-endian bytes. UNCERTAIN: U-52
 */
export type GoldskyReaderOptions = {
  /** `goldskyUrl` from the network config. */
  url: string;
  /** Reads current state. The factory passes an RPC reader for the same network. */
  state: ChainReader;
  fetch?: Fetch;
  /** Rows per GraphQL page. The Graph caps `first` at 1000. */
  pageSize?: number;
};

type Row = Record<string, unknown> & { id: string; block_number: string; transactionHash_: string };

type EntitySpec = { contract: "ClaimRegistry" | "OrgRegistry"; event: AbiEvent; collection: string };

function findEvent(abi: readonly { type: string; name?: string }[], name: string): AbiEvent {
  const item = abi.find((entry) => entry.type === "event" && entry.name === name);
  if (!item) throw new Error(`event ${name} missing from the ABI`);
  return item as AbiEvent;
}

/** `ClaimSubmitted` becomes `claimSubmitteds`, the collection field graph-node generates. */
function collectionOf(name: string): string {
  return `${name.charAt(0).toLowerCase()}${name.slice(1)}s`;
}

const ENTITIES: EntitySpec[] = [
  ...CLAIM_EVENT_NAMES.map((name) => ({
    contract: "ClaimRegistry" as const,
    event: findEvent(claimRegistryAbi, name),
    collection: collectionOf(name),
  })),
  ...ORG_EVENT_NAMES.map((name) => ({
    contract: "OrgRegistry" as const,
    event: findEvent(orgRegistryAbi, name),
    collection: collectionOf(name),
  })),
];

/** Converts a subgraph field back to what viem would decode for the same ABI type. */
function fromGraph(type: string, value: unknown): EventArg {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new UpstreamError("ChainReader", null, `unexpected ${type} value ${String(value)}`);
  }
  const match = /^u?int(\d+)$/.exec(type);
  if (match) {
    const bits = Number(match[1]);
    return bits <= 48 ? Number(value) : BigInt(value);
  }
  if (type === "address") return getAddress(String(value));
  return String(value);
}

/** Recovers the log index from an instant-subgraph ID: tx hash (32 bytes) then an int32, little-endian. */
export function logIndexFromId(id: string): number {
  const hex = id.startsWith("0x") ? id.slice(2) : id;
  if (hex.length !== 72) return 0;
  const bytes = hex.slice(64).match(/../g) ?? [];
  return Number.parseInt(bytes.reverse().join(""), 16);
}

function toEvent(spec: EntitySpec, row: Row): ChainEvent {
  const args: Record<string, EventArg> = {};
  for (const input of spec.event.inputs) {
    if (!input.name) continue;
    args[input.name] = fromGraph(input.type, row[input.name]);
  }
  const base = {
    blockNumber: BigInt(row.block_number),
    logIndex: logIndexFromId(row.id),
    transactionHash: row.transactionHash_ as Hash,
    args,
  };
  const name = spec.event.name;
  if (spec.contract === "ClaimRegistry") {
    return { ...base, contract: "ClaimRegistry", name: name as ClaimEvent["name"], claimId: args.claimId as bigint };
  }
  return { ...base, contract: "OrgRegistry", name: name as (typeof ORG_EVENT_NAMES)[number], orgId: args.orgId as bigint };
}

export function createGoldskyChainReader(options: GoldskyReaderOptions): ChainReader {
  const doFetch: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const pageSize = options.pageSize ?? 1000;
  const { state } = options;

  async function query<T>(text: string, variables: Record<string, unknown>): Promise<T> {
    const response = await doFetch(options.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query: text, variables }),
    });
    if (!response.ok) throw new UpstreamError("ChainReader", response.status, `subgraph returned HTTP ${response.status}`);
    const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) {
      throw new UpstreamError("ChainReader", response.status, body.errors.map((e) => e.message).join("; "));
    }
    if (!body.data) throw new UpstreamError("ChainReader", response.status, "subgraph returned no data");
    return body.data;
  }

  /** Every row of one entity that matches `where`, paging by `id`. */
  async function rows(spec: EntitySpec, where: Record<string, string>): Promise<Row[]> {
    const fields = ["id", "block_number", "transactionHash_", ...spec.event.inputs.map((i) => i.name ?? "")].filter(Boolean);
    const conditions = Object.entries(where).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
    const out: Row[] = [];
    let after = "";
    for (;;) {
      const filter = [...conditions, `id_gt: ${JSON.stringify(after || "0x")}`].join(", ");
      const text = `{ page: ${spec.collection}(first: ${pageSize}, orderBy: id, orderDirection: asc, where: { ${filter} }) { ${fields.join(" ")} } }`;
      const data = await query<{ page: Row[] }>(text, {});
      out.push(...data.page);
      const last = data.page.at(-1);
      if (data.page.length < pageSize || !last) return out;
      after = last.id;
    }
  }

  async function indexedBlock(): Promise<bigint> {
    const data = await query<{ _meta: { block: { number: number } } }>("{ _meta { block { number } } }", {});
    return BigInt(data._meta.block.number);
  }

  return {
    kind: "goldsky",
    getPoolStats: () => state.getPoolStats(),
    getClaim: (id) => state.getClaim(id),
    getClaims: (ids) => state.getClaims(ids),
    claimCount: () => state.claimCount(),
    getOrgExposure: () => state.getOrgExposure(),

    async listClaims(filter: ClaimFilter = {}) {
      const spec = ENTITIES.find((e) => e.event.name === "ClaimSubmitted");
      if (!spec) throw new Error("ClaimSubmitted entity missing");
      const where: Record<string, string> = {};
      if (filter.recipient) where.recipient = filter.recipient.toLowerCase();
      if (filter.guarantor) where.guarantor = filter.guarantor.toLowerCase();
      if (filter.orgId !== undefined) where.orgId = filter.orgId.toString();
      const submitted = await rows(spec, where);
      const ids = [...new Set(submitted.map((row) => BigInt(String(row.claimId))))].sort((a, b) => (a < b ? -1 : 1));
      return (await state.getClaims(ids)).filter((claim) => matchesFilter(claim, filter));
    },

    async getClaimEvents(id) {
      const specs = ENTITIES.filter((e) => e.contract === "ClaimRegistry");
      const pages = await Promise.all(specs.map((spec) => rows(spec, { claimId: id.toString() })));
      return pages
        .flatMap((page, i) => page.map((row) => toEvent(specs[i] as EntitySpec, row)))
        .filter((event): event is ClaimEvent => event.contract === "ClaimRegistry")
        .sort(compareEvents);
    },

    async getEvents(range: EventRange) {
      const head = await indexedBlock();
      const toBlock = range.toBlock !== undefined && range.toBlock < head ? range.toBlock : head;
      if (range.fromBlock > toBlock) return { events: [], toBlock };
      const where = { block_number_gte: range.fromBlock.toString(), block_number_lte: toBlock.toString() };
      const pages = await Promise.all(ENTITIES.map((spec) => rows(spec, where)));
      const events = pages.flatMap((page, i) => page.map((row) => toEvent(ENTITIES[i] as EntitySpec, row)));
      return { events: events.sort(compareEvents), toBlock };
    },
  };
}

