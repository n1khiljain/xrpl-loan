import xrplDevnet from "../../../deployments/xrpl-devnet.json" with { type: "json" };
import { type LedgerObjects, type NetworkConfig, type NetworkName, NETWORKS, networkConfigSchema } from "./schema.ts";

export * from "./schema.ts";

/** The files in `deployments/`, bundled at build time so the static web export and the edge functions can read them. */
export const RAW_CONFIGS: Record<NetworkName, unknown> = {
  "xrpl-devnet": xrplDevnet,
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

/** Loads and validates `deployments/<network>.json`. The name comes from `NETWORK` (functions) or `NEXT_PUBLIC_NETWORK` (web). */
export function loadNetworkConfig(network: string): NetworkConfig {
  if (!isNetworkName(network)) {
    throw new ConfigError(network, [`unknown network; expected one of ${NETWORKS.join(", ")}`]);
  }
  return parseNetworkConfig(RAW_CONFIGS[network], network);
}

export type LedgerSetup = Required<LedgerObjects> & { issuer: NonNullable<NetworkConfig["asset"]["issuer"]> };

/** Thrown when code needs ledger objects the setup script has not created yet. */
export class NotSetUpError extends Error {
  constructor(
    readonly network: string,
    readonly missing: string[],
  ) {
    super(`The XRPL setup hasn't run on ${network} (missing ${missing.join(", ")}). Run \`pnpm xrpl:setup\`.`);
    this.name = "NotSetUpError";
  }
}

/** Every ledger object the app needs, or throws `NotSetUpError` naming the missing ones. */
export function requireSetup(config: NetworkConfig): LedgerSetup {
  const keys = ["broker", "credentialIssuer", "credentialType", "domainId", "vaultId", "loanBrokerId", "repaymentAccount"] as const;
  const missing: string[] = keys.filter((key) => config.ledger[key] === undefined);
  if (config.asset.issuer === null) missing.unshift("asset.issuer");
  if (missing.length > 0) throw new NotSetUpError(config.network, missing);
  return { ...(config.ledger as Required<LedgerObjects>), issuer: config.asset.issuer! };
}

/** Whether the setup script has run, without throwing. */
export function isSetUp(config: NetworkConfig): boolean {
  try {
    requireSetup(config);
    return true;
  } catch {
    return false;
  }
}

/** Product terms as bigints, for code that compares amounts. */
export function paramsAsBigInt(config: NetworkConfig) {
  const p = config.params;
  return {
    advanceRateBps: BigInt(p.advanceRateBps),
    perReceivableCap: BigInt(p.perReceivableCap),
    perOrgCap: BigInt(p.perOrgCap),
    poolDepositCap: BigInt(p.poolDepositCap),
    feeBps: BigInt(p.feeBps),
  };
}
