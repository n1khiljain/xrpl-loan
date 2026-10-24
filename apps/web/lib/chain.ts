import { type ChainReader, createChainReader } from "@app/adapters";
import { type PublicClient, createPublicClient, http } from "viem";
import { chain, config, deployedContracts } from "./config";

export const publicClient: PublicClient = createPublicClient({ chain, transport: http(config.rpcUrl), pollingInterval: 1_000 });

let reader: ChainReader | null = null;

/** Dashboard and claim state come through the ChainReader adapter (FR-F12). Null until contracts are deployed. */
export function chainReader(): ChainReader | null {
  if (!deployedContracts()) return null;
  reader ??= createChainReader(config, { publicClient });
  return reader;
}
