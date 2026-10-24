import { claimRegistryAbi, orgRegistryAbi, receivablesPoolAbi } from "@app/abi";
import {
  type Abi,
  type Address,
  type Log,
  type PublicClient,
  formatLog,
  numberToHex,
  pad,
  parseEventLogs,
  toHex,
} from "viem";
import {
  CLAIM_EVENT_NAMES,
  type ChainEvent,
  type ClaimEvent,
  type ClaimEventName,
  type EventArg,
  ORG_EVENT_NAMES,
  type OrgEventName,
  type RawClaim,
  compareEvents,
  toClaimView,
} from "../shared/claims.ts";
import { type ChainReader, type ClaimFilter, type EventRange, type PoolStats, matchesFilter } from "./types.ts";

export type RpcReaderOptions = {
  publicClient: PublicClient;
  claimRegistry: Address;
  pool: Address;
  orgRegistry: Address;
  /** `deployed.block`: no events exist before it. */
  fromBlock: bigint;
  /** Largest block span per `eth_getLogs`. Public RPCs time out on wide ranges. */
  logChunkSize?: bigint;
  /** Use viem's deployless multicall, for chains without Multicall3 (local anvil). */
  deployless?: boolean;
};

const CLAIM_EVENTS = new Set<string>(CLAIM_EVENT_NAMES);
const ORG_EVENTS = new Set<string>(ORG_EVENT_NAMES);

function toArgs(args: unknown): Record<string, EventArg> {
  const out: Record<string, EventArg> = {};
  if (typeof args !== "object" || args === null) return out;
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "bigint" || typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

type DecodedLog = Log & { eventName: string; args: unknown };

/** Turns decoded registry logs into `ChainEvent`s, dropping events offchain state doesn't use (roles, pause). */
export function toChainEvents(logs: readonly DecodedLog[], addresses: { claimRegistry: Address; orgRegistry: Address }) {
  const events: ChainEvent[] = [];
  for (const log of logs) {
    if (log.blockNumber === null || log.logIndex === null || log.transactionHash === null) continue;
    const args = toArgs(log.args);
    const base = { blockNumber: log.blockNumber, logIndex: log.logIndex, transactionHash: log.transactionHash, args };
    const from = log.address.toLowerCase();
    if (from === addresses.claimRegistry.toLowerCase() && CLAIM_EVENTS.has(log.eventName)) {
      const claimId = args.claimId;
      if (typeof claimId !== "bigint") continue;
      events.push({ ...base, contract: "ClaimRegistry", name: log.eventName as ClaimEventName, claimId });
    } else if (from === addresses.orgRegistry.toLowerCase() && ORG_EVENTS.has(log.eventName)) {
      const orgId = args.orgId;
      if (typeof orgId !== "bigint") continue;
      events.push({ ...base, contract: "OrgRegistry", name: log.eventName as OrgEventName, orgId });
    }
  }
  return events.sort(compareEvents);
}

const EVENTS_ABI = [...claimRegistryAbi, ...orgRegistryAbi] as const satisfies Abi;

/**
 * Testnet and local ChainReader: state through multicall, history through `eth_getLogs` from `deployed.block`
 * in chunks.
 */
export function createRpcChainReader(options: RpcReaderOptions): ChainReader {
  const { publicClient: client, claimRegistry, pool, orgRegistry } = options;
  const chunk = options.logChunkSize ?? 10_000n;
  const deployless = options.deployless ?? false;
  let shareDecimals: number | undefined;

  function claimCount() {
    return client.readContract({ address: claimRegistry, abi: claimRegistryAbi, functionName: "claimCount" });
  }

  async function getClaims(ids: readonly bigint[]) {
    if (ids.length === 0) return [];
    const registry = { address: claimRegistry, abi: claimRegistryAbi } as const;
    const [raws, remaining] = await Promise.all([
      client.multicall({
        contracts: ids.map((id) => ({ ...registry, functionName: "getClaim", args: [id] }) as const),
        allowFailure: false,
        deployless,
      }),
      // the fee accrues every second, so what's owed now comes from the registry, not the stored amountDue (U-84)
      client.multicall({
        contracts: ids.map((id) => ({ ...registry, functionName: "amountRemaining", args: [id] }) as const),
        allowFailure: false,
        deployless,
      }),
    ]);
    return raws.map((raw, i) => toClaimView(raw as RawClaim, remaining[i]));
  }

  async function rawLogs(fromBlock: bigint, toBlock: bigint, addresses: Address[], topics: (`0x${string}` | null)[]) {
    const logs: Log[] = [];
    for (let start = fromBlock; start <= toBlock; start += chunk) {
      const end = start + chunk - 1n < toBlock ? start + chunk - 1n : toBlock;
      const page = await client.request({
        method: "eth_getLogs",
        params: [{ address: addresses, topics, fromBlock: numberToHex(start), toBlock: numberToHex(end) }],
      });
      for (const raw of page) logs.push(formatLog(raw));
    }
    return parseEventLogs({ abi: EVENTS_ABI, logs, strict: true }) as unknown as DecodedLog[];
  }

  return {
    kind: "rpc",

    async getPoolStats(): Promise<PoolStats> {
      const read = <F extends "totalAssets" | "idleCash" | "outstandingPrincipal" | "totalLosses" | "totalSupply">(
        functionName: F,
      ) => ({ address: pool, abi: receivablesPoolAbi, functionName }) as const;
      const [totalAssets, idleCash, outstandingPrincipal, totalLosses, totalSupply, decimals] = await client.multicall({
        contracts: [
          read("totalAssets"),
          read("idleCash"),
          read("outstandingPrincipal"),
          read("totalLosses"),
          read("totalSupply"),
          { address: pool, abi: receivablesPoolAbi, functionName: "decimals" },
        ],
        allowFailure: false,
        deployless,
      });
      shareDecimals ??= decimals;
      const sharePrice = await client.readContract({
        address: pool,
        abi: receivablesPoolAbi,
        functionName: "convertToAssets",
        args: [10n ** BigInt(decimals)],
      });
      return { totalAssets, idleCash, outstandingPrincipal, totalLosses, totalSupply, sharePrice, shareDecimals: decimals };
    },

    async getClaim(id) {
      const [claim] = await getClaims([id]);
      if (!claim) throw new Error(`no result for claim ${id}`);
      return claim;
    },

    getClaims,

    claimCount,

    async listClaims(filter: ClaimFilter = {}) {
      const count = await claimCount();
      const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));
      return (await getClaims(ids)).filter((claim) => matchesFilter(claim, filter));
    },

    async getOrgExposure() {
      const [count, params] = await client.multicall({
        contracts: [
          { address: orgRegistry, abi: orgRegistryAbi, functionName: "orgCount" },
          { address: claimRegistry, abi: claimRegistryAbi, functionName: "params" },
        ],
        allowFailure: false,
        deployless,
      });
      const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));
      if (ids.length === 0) return [];
      const results = await client.multicall({
        contracts: ids.flatMap(
          (orgId) =>
            [
              { address: orgRegistry, abi: orgRegistryAbi, functionName: "orgName", args: [orgId] },
              { address: orgRegistry, abi: orgRegistryAbi, functionName: "isActiveOrg", args: [orgId] },
              { address: claimRegistry, abi: claimRegistryAbi, functionName: "orgOutstanding", args: [orgId] },
              { address: claimRegistry, abi: claimRegistryAbi, functionName: "orgCapOverride", args: [orgId] },
            ] as const,
        ),
        allowFailure: false,
        deployless,
      });
      return ids.map((orgId, i) => {
        // UNCERTAIN: U-69 (0 means the org is on perOrgCap)
        const override = results[i * 4 + 3] as bigint;
        return {
          orgId,
          name: results[i * 4] as string,
          active: results[i * 4 + 1] as boolean,
          outstanding: results[i * 4 + 2] as bigint,
          cap: override > 0n ? override : params.perOrgCap,
          customCap: override > 0n,
        };
      });
    },

    async getClaimEvents(id) {
      // no cache: viem otherwise reuses the head for 4s, and a warm edge worker would sync behind the chain
      const latest = await client.getBlockNumber({ cacheTime: 0 });
      const logs = await rawLogs(options.fromBlock, latest, [claimRegistry], [null, pad(toHex(id), { size: 32 })]);
      return toChainEvents(logs, { claimRegistry, orgRegistry }).filter(
        (event): event is ClaimEvent => event.contract === "ClaimRegistry" && event.claimId === id,
      );
    },

    async getEvents(range: EventRange) {
      // no cache: viem otherwise reuses the head for 4s, and a warm edge worker would sync behind the chain
      const latest = await client.getBlockNumber({ cacheTime: 0 });
      const toBlock = range.toBlock !== undefined && range.toBlock < latest ? range.toBlock : latest;
      const fromBlock = range.fromBlock > options.fromBlock ? range.fromBlock : options.fromBlock;
      if (fromBlock > toBlock) return { events: [], toBlock };
      const logs = await rawLogs(fromBlock, toBlock, [claimRegistry, orgRegistry], []);
      return { events: toChainEvents(logs, { claimRegistry, orgRegistry }), toBlock };
    },
  };
}
