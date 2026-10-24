import { type Account, type Address, type Chain, type PublicClient, type Transport, type WalletClient } from "viem";
import type { GasResult, GasSponsor } from "./types.ts";

export type DripOptions = {
  publicClient: PublicClient;
  /** A wallet client holding the drip key (`DRIP_PRIVATE_KEY`), which lives only in Supabase secrets. */
  walletClient: WalletClient<Transport, Chain, Account>;
  /** `DRIP_AMOUNT_WEI`: native FRAX sent per top-up. */
  amountWei: bigint;
  /** `DRIP_THRESHOLD_WEI`: only wallets below this balance get a top-up. */
  thresholdWei: bigint;
};

/**
 * Sends `amountWei` of the native gas token from a small hot wallet when the user's balance is below
 * `thresholdWei`. The once-a-day and profile rules are in `withDripPolicy`, so they apply to both implementations.
 * UNCERTAIN: U-05
 */
export function createDripGasSponsor(options: DripOptions): GasSponsor {
  if (options.amountWei <= 0n) throw new RangeError("DRIP_AMOUNT_WEI must be above 0");
  if (options.thresholdWei <= 0n) throw new RangeError("DRIP_THRESHOLD_WEI must be above 0");

  return {
    kind: "drip",
    async ensureGas(wallet: Address): Promise<GasResult> {
      const balance = await options.publicClient.getBalance({ address: wallet });
      if (balance >= options.thresholdWei) return { funded: false, reason: "above_threshold" };
      const txHash = await options.walletClient.sendTransaction({
        to: wallet,
        value: options.amountWei,
        account: options.walletClient.account,
        chain: options.walletClient.chain,
      });
      const receipt = await options.publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") throw new Error(`gas drip ${txHash} reverted`);
      return { funded: true, txHash };
    },
  };
}
