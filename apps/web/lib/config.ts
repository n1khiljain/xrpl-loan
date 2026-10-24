import { type NetworkConfig, isSetUp, isTestnet, loadNetworkConfig } from "@app/config";
import { explorerAccount, explorerTx } from "@app/adapters";
import { PUBLIC_ENV } from "./env";

/** The network this build targets. Addresses and ledger IDs come from deployments/<network>.json, never hand-copied. */
export const config: NetworkConfig = loadNetworkConfig(PUBLIC_ENV.network);
/** From the network ID, never the file. */
export const onTestnet = isTestnet(config);
/** Whether `pnpm xrpl:setup` has created the vault, broker, domain, and issuer on this network. */
export const ledgerReady = isSetUp(config);

/** The loan asset's name as people see it, e.g. "RLUSD". */
export const ASSET = config.asset.code;

export const txUrl = (hash: string) => explorerTx(config, hash);
export const accountUrl = (address: string) => explorerAccount(config, address);

export const params = {
  advanceRateBps: BigInt(config.params.advanceRateBps),
  perReceivableCap: BigInt(config.params.perReceivableCap),
  feeBps: BigInt(config.params.feeBps),
  overdueWindowSeconds: config.params.overdueWindowSeconds,
  approvalExpirySeconds: config.params.approvalExpirySeconds,
};
