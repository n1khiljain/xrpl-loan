import { type NetworkConfig, requireDeployed } from "@app/config";
import type { PublicClient } from "viem";
import { type Fetch, publicClientFor } from "../shared/chain.ts";
import { AdapterConfigError } from "../shared/errors.ts";
import { createGoldskyChainReader } from "./goldsky.ts";
import { createRpcChainReader } from "./rpc.ts";
import type { ChainReader } from "./types.ts";

export * from "./types.ts";
export * from "./rpc.ts";
export * from "./goldsky.ts";
export * from "./refresh.ts";

export type ChainReaderDeps = { publicClient?: PublicClient; fetch?: Fetch; logChunkSize?: bigint };

/** Picks the implementation named by `config.adapters.chainReader` (FR-A1). Needs deployed contracts. */
export function createChainReader(config: NetworkConfig, deps: ChainReaderDeps = {}): ChainReader {
  const deployed = requireDeployed(config);
  const rpc = createRpcChainReader({
    publicClient: deps.publicClient ?? publicClientFor(config),
    claimRegistry: deployed.claimRegistry,
    pool: deployed.pool,
    orgRegistry: deployed.orgRegistry,
    fromBlock: BigInt(deployed.block),
    deployless: config.network === "local",
    ...(deps.logChunkSize ? { logChunkSize: deps.logChunkSize } : {}),
  });
  switch (config.adapters.chainReader) {
    case "rpc":
      return rpc;
    case "goldsky": {
      if (config.goldskyUrl === null) throw new AdapterConfigError("ChainReader", "'goldsky' needs goldskyUrl (U-52)");
      return createGoldskyChainReader({ url: config.goldskyUrl, state: rpc, ...(deps.fetch ? { fetch: deps.fetch } : {}) });
    }
  }
}
