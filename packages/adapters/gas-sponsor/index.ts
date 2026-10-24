import type { NetworkConfig } from "@app/config";
import { type Hex, type PublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainFromConfig, publicClientFor } from "../shared/chain.ts";
import { AdapterConfigError } from "../shared/errors.ts";
import { createDripGasSponsor } from "./drip.ts";
import { createMockGasSponsor } from "./mock.ts";
import type { GasSponsor } from "./types.ts";

export * from "./types.ts";
export * from "./drip.ts";
export * from "./mock.ts";
export * from "./policy.ts";

export type GasSponsorDeps = {
  /** `DRIP_PRIVATE_KEY` */
  dripPrivateKey?: string;
  /** `DRIP_AMOUNT_WEI` */
  amountWei?: string;
  /** `DRIP_THRESHOLD_WEI` */
  thresholdWei?: string;
  publicClient?: PublicClient;
};

function weiFromEnv(name: string, value: string | undefined): bigint {
  if (!value || !/^[0-9]+$/.test(value)) {
    throw new AdapterConfigError("GasSponsor", `'drip' needs ${name} as a decimal string of wei`);
  }
  return BigInt(value);
}

/** Picks the implementation named by `config.adapters.gasSponsor` (FR-A1). */
export function createGasSponsor(config: NetworkConfig, deps: GasSponsorDeps = {}): GasSponsor {
  switch (config.adapters.gasSponsor) {
    case "mock":
      return createMockGasSponsor();
    case "drip": {
      const key = deps.dripPrivateKey;
      if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
        throw new AdapterConfigError("GasSponsor", "'drip' needs DRIP_PRIVATE_KEY as a 32-byte hex key");
      }
      const chain = chainFromConfig(config);
      return createDripGasSponsor({
        publicClient: deps.publicClient ?? publicClientFor(config),
        walletClient: createWalletClient({ account: privateKeyToAccount(key as Hex), chain, transport: http(config.rpcUrl) }),
        amountWei: weiFromEnv("DRIP_AMOUNT_WEI", deps.amountWei),
        thresholdWei: weiFromEnv("DRIP_THRESHOLD_WEI", deps.thresholdWei),
      });
    }
  }
}
