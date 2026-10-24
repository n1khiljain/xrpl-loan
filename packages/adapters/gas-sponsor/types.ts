import type { Address, Hash } from "viem";

export type GasResult = {
  funded: boolean;
  txHash?: Hash;
  reason?: "above_threshold" | "rate_limited" | "no_profile";
};

/** Tops up a user's native gas balance so they never need to buy FRAX (FR-B7, U-05). SYSTEM_DESIGN section 4. */
export interface GasSponsor {
  readonly kind: "drip" | "mock";
  ensureGas(wallet: Address): Promise<GasResult>;
}
