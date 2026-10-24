import { type DeployedContracts, type NetworkConfig, isTestnet, loadNetworkConfig } from "@app/config";
import { chainFromConfig } from "@app/adapters";
import { PUBLIC_ENV } from "./env";

/** The network this build targets (FR-F3). Addresses come from deployments/<network>.json, never hand-copied (FR-F11). */
export const config: NetworkConfig = loadNetworkConfig(PUBLIC_ENV.network);
export const chain = chainFromConfig(config);
/** From the chain ID, never the file (security campaign E-1). */
export const onTestnet = isTestnet(config);

/** Deployed addresses, or null until Deploy.s.sol has run for this network. */
export function deployedContracts(): DeployedContracts | null {
  const d = config.deployed;
  if (d.block === undefined || !d.frxUSD || !d.orgRegistry || !d.claimRegistry || !d.pool || !d.claimNft) return null;
  return d as DeployedContracts;
}

export const params = {
  advanceRateBps: BigInt(config.params.advanceRateBps),
  perClaimCap: BigInt(config.params.perClaimCap),
  feeBps: BigInt(config.params.feeBps),
  overdueWindowSeconds: config.params.overdueWindowSeconds,
  approvalExpirySeconds: config.params.approvalExpirySeconds,
};
