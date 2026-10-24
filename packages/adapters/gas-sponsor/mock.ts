import type { Address } from "viem";
import type { GasSponsor } from "./types.ts";

export interface MockGasSponsor extends GasSponsor {
  readonly kind: "mock";
  /** Wallets `ensureGas` was called for, in order. */
  readonly calls: readonly Address[];
}

/** Local anvil accounts already hold ETH, so the mock sends nothing and always reports funded. */
export function createMockGasSponsor(): MockGasSponsor {
  const calls: Address[] = [];
  return {
    kind: "mock",
    calls,
    async ensureGas(wallet) {
      calls.push(wallet);
      return { funded: true };
    },
  };
}
