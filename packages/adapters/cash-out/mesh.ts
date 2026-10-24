import { type Address, type PublicClient, encodeFunctionData, erc20Abi, getAddress, pad } from "viem";
import { ETHEREUM_EID, oftAbi } from "./oft.ts";
import { type Call, type CashOut, checkLiquidationAddress } from "./types.ts";

/** frxUSD has 18 decimals (FR-C18). */
const LOCAL_DECIMALS = 18;

export type MeshCashOutOptions = {
  publicClient: PublicClient;
  /** `fraxMesh` from the network config: the Frax Mesh OFT on Fraxtal. */
  oft: Address;
  /** frxUSD on this network. The OFT's `token()` must match it. */
  frxUSD: Address;
  /** LayerZero endpoint ID of the chain that holds the liquidation address. Defaults to Ethereum. */
  dstEid?: number;
};

/**
 * Mainnet cash-out over Frax Mesh, treated as a LayerZero V2 OFT: approve the OFT if it wraps the token, then
 * `send` to the liquidation address on Ethereum with the quoted native fee. The amount is rounded down to the
 * OFT's shared decimals, since OFTs drop smaller units. UNCERTAIN: U-17, U-53
 */
export function createMeshCashOut(options: MeshCashOutOptions): CashOut {
  const { publicClient, oft } = options;
  const dstEid = options.dstEid ?? ETHEREUM_EID;

  return {
    kind: "mesh",
    simulated: false,
    async buildTransfer({ from, amount, liquidationAddress }): Promise<Call[]> {
      if (amount <= 0n) throw new RangeError("cash-out amount must be above 0");
      const destination = checkLiquidationAddress(liquidationAddress);
      const read = <F extends "token" | "approvalRequired" | "sharedDecimals">(functionName: F) =>
        publicClient.readContract({ address: oft, abi: oftAbi, functionName });
      const [token, approvalRequired, sharedDecimals] = await Promise.all([
        read("token"),
        read("approvalRequired"),
        read("sharedDecimals"),
      ]);
      if (getAddress(token) !== getAddress(options.frxUSD)) {
        throw new Error(`fraxMesh ${oft} moves ${token}, not frxUSD ${options.frxUSD}`);
      }
      // the token or the bridge itself pasted by mistake would lose the frxUSD
      if ([token, oft, options.frxUSD].some((known) => getAddress(known) === destination)) {
        throw new RangeError("That's a token or bridge contract, not your FraxNet deposit address.");
      }

      const dust = 10n ** BigInt(LOCAL_DECIMALS - sharedDecimals);
      const amountLD = amount - (amount % dust);
      if (amountLD === 0n) throw new RangeError(`cash-out amount is below the OFT's smallest unit (${dust} wei)`);

      const draft = {
        dstEid,
        to: pad(destination, { size: 32 }),
        amountLD,
        minAmountLD: amountLD,
        extraOptions: "0x",
        composeMsg: "0x",
        oftCmd: "0x",
      } as const;
      const [, , receipt] = await publicClient.readContract({
        address: oft,
        abi: oftAbi,
        functionName: "quoteOFT",
        args: [draft],
      });
      const sendParam = { ...draft, minAmountLD: receipt.amountReceivedLD };
      const fee = await publicClient.readContract({
        address: oft,
        abi: oftAbi,
        functionName: "quoteSend",
        args: [sendParam, false],
      });

      const calls: Call[] = [];
      if (approvalRequired) {
        calls.push({
          to: token,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [oft, amountLD] }),
          value: 0n,
        });
      }
      calls.push({
        to: oft,
        data: encodeFunctionData({ abi: oftAbi, functionName: "send", args: [sendParam, fee, from] }),
        value: fee.nativeFee,
      });
      return calls;
    },
  };
}
