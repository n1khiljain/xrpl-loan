import type { NetworkConfig } from "@app/config";

/** Explorer pages for the configured network. */
export function explorerTx(config: Pick<NetworkConfig, "explorer">, hash: string): string {
  return `${config.explorer.replace(/\/+$/, "")}/transactions/${hash}`;
}

export function explorerAccount(config: Pick<NetworkConfig, "explorer">, address: string): string {
  return `${config.explorer.replace(/\/+$/, "")}/accounts/${address}`;
}
