import { type Address, encodeFunctionData, erc20Abi } from "viem";
import type { CashOut } from "./types.ts";

export type SimulatedCashOutOptions = {
  /** The frxUSD the pool uses on this network (MockFrxUSD on local). */
  frxUSD: Address;
  /** `cashOutSink` from the network config. */
  sink: Address;
};

/**
 * Testnet cash-out: one real frxUSD transfer to `cashOutSink`. The bank transfer after it is a screen labeled as a
 * testnet simulation. UNCERTAIN: U-17
 */
export function createSimulatedCashOut(options: SimulatedCashOutOptions): CashOut {
  return {
    kind: "simulated",
    simulated: true,
    async buildTransfer({ amount }) {
      if (amount <= 0n) throw new RangeError("cash-out amount must be above 0");
      return [
        {
          to: options.frxUSD,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [options.sink, amount] }),
          value: 0n,
        },
      ];
    },
  };
}
