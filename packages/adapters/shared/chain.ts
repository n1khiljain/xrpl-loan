import { type NetworkConfig, isTestnet } from "@app/config";
import { type Chain, type PublicClient, createPublicClient, defineChain, http } from "viem";

/** Multicall3 is deployed at this address on Fraxtal, Fraxtal testnet, and Sepolia (checked with eth_getCode). */
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

const NATIVE: Record<NetworkConfig["network"], { name: string; symbol: string }> = {
  local: { name: "Ether", symbol: "ETH" },
  "fraxtal-testnet": { name: "Frax", symbol: "FRAX" },
  sepolia: { name: "Ether", symbol: "ETH" },
  fraxtal: { name: "Frax", symbol: "FRAX" },
};

/**
 * A viem chain built from the network config, so the RPC URL and chain ID come from `deployments/<network>.json`
 * rather than viem's bundled list (viem's `fraxtalTestnet` is the retired chain 2522). Local anvil has no
 * Multicall3, so readers use viem's deployless multicall there.
 */
export function chainFromConfig(config: NetworkConfig): Chain {
  return defineChain({
    id: config.chainId,
    name: config.network,
    nativeCurrency: { ...NATIVE[config.network], decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
    testnet: isTestnet(config),
    ...(config.network === "local" ? {} : { contracts: { multicall3: { address: MULTICALL3 } } }),
  });
}

export function publicClientFor(config: NetworkConfig): PublicClient {
  return createPublicClient({ chain: chainFromConfig(config), transport: http(config.rpcUrl) });
}

/** The fetch signature adapters accept, so tests and Deno can pass their own. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
