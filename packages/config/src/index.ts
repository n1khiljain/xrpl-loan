import local from "../../../deployments/local.json" with { type: "json" };
import fraxtalTestnet from "../../../deployments/fraxtal-testnet.json" with { type: "json" };
import sepolia from "../../../deployments/sepolia.json" with { type: "json" };
import fraxtal from "../../../deployments/fraxtal.json" with { type: "json" };
import {
  type Address,
  type Deployed,
  type NetworkConfig,
  type NetworkName,
  NETWORKS,
  networkConfigSchema,
} from "./schema.ts";

export * from "./schema.ts";

/**
 * The four files in `deployments/`, bundled at build time so the static web export and the edge functions can read
 * them without a filesystem.
 */
export const RAW_CONFIGS: Record<NetworkName, unknown> = {
  local,
  "fraxtal-testnet": fraxtalTestnet,
  sepolia,
  fraxtal,
};

/** Thrown when a network config fails validation. `issues` lists every problem with its path. */
export class ConfigError extends Error {
  constructor(
    readonly network: string,
    readonly issues: string[],
  ) {
    super(`Invalid network config for ${network}:\n  ${issues.join("\n  ")}`);
    this.name = "ConfigError";
  }
}

/** Validates any value against the full schema, including the cross-field rules. */
export function parseNetworkConfig(input: unknown, label = "input"): NetworkConfig {
  const result = networkConfigSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigError(
      label,
      result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  return result.data;
}

export function isNetworkName(value: string): value is NetworkName {
  return (NETWORKS as readonly string[]).includes(value);
}

/**
 * Loads and validates `deployments/<network>.json`. The name usually comes from `NETWORK` (contracts, functions)
 * or `NEXT_PUBLIC_NETWORK` (web).
 */
export function loadNetworkConfig(network: string): NetworkConfig {
  if (!isNetworkName(network)) {
    throw new ConfigError(network, [`unknown network; expected one of ${NETWORKS.join(", ")}`]);
  }
  return parseNetworkConfig(RAW_CONFIGS[network], network);
}

export type DeployedContracts = Required<Deployed>;

/** Thrown when code needs contract addresses that the deploy script has not written yet. */
export class NotDeployedError extends Error {
  constructor(
    readonly network: string,
    readonly missing: string[],
  ) {
    super(
      `Contracts are not deployed on ${network} (missing ${missing.join(", ")}). ` +
        `Run NETWORK=${network} forge script script/Deploy.s.sol from contracts/.`,
    );
    this.name = "NotDeployedError";
  }
}

/** Returns every deployed address, or throws `NotDeployedError` naming the ones missing. */
export function requireDeployed(config: NetworkConfig): DeployedContracts {
  const keys = ["block", "frxUSD", "orgRegistry", "claimRegistry", "pool", "claimNft"] as const;
  const missing = keys.filter((key) => config.deployed[key] === undefined);
  if (missing.length > 0) throw new NotDeployedError(config.network, missing);
  return config.deployed as DeployedContracts;
}

/** Product terms as bigints, for code that compares amounts. */
export function paramsAsBigInt(config: NetworkConfig) {
  const p = config.params;
  return {
    advanceRateBps: BigInt(p.advanceRateBps),
    perClaimCap: BigInt(p.perClaimCap),
    perOrgCap: BigInt(p.perOrgCap),
    poolDepositCap: BigInt(p.poolDepositCap),
    feeBps: BigInt(p.feeBps),
  };
}

export type { Address };
