"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type Abi, type Address, type ContractFunctionArgs, type ContractFunctionName, type Hex, encodeFunctionData, parseEther } from "viem";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { callFunction } from "@/lib/api";
import { publicClient } from "@/lib/chain";
import { chain } from "@/lib/config";
import { friendlyError } from "@/lib/errors";
import { useSession } from "@/lib/session/context";

export type Call = { to: Address; data: Hex; value?: bigint };

export function contractCall<const TAbi extends Abi, TName extends ContractFunctionName<TAbi, "nonpayable" | "payable">>(p: {
  address: Address;
  abi: TAbi;
  functionName: TName;
  args: ContractFunctionArgs<TAbi, "nonpayable" | "payable", TName>;
}): Call {
  return { to: p.address, data: encodeFunctionData(p as Parameters<typeof encodeFunctionData>[0]) };
}

/** Below this, ask the gas sponsor for a top-up first (SYSTEM_DESIGN 6.3). */
const GAS_FLOOR = parseEther("0.0002");

type TxState = { status: "idle" | "sending" | "done" | "error"; error: string | null; step: string | null };

/**
 * Sends calls from the signed-in wallet, in order: switch to the configured network if needed (FR-F3), top up gas
 * without the user seeing it, send, wait for each receipt, then refresh cached data.
 */
export function useSendCalls() {
  const session = useSession();
  const { chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();
  const [state, setState] = useState<TxState>({ status: "idle", error: null, step: null });

  async function send(calls: Call[], labels: string[] = []): Promise<Hex[] | null> {
    setState({ status: "sending", error: null, step: labels[0] ?? null });
    try {
      if (!walletClient || !session.address) throw new Error("Sign in first.");
      if (chainId !== chain.id) await switchChainAsync({ chainId: chain.id });
      const balance = await publicClient.getBalance({ address: session.address });
      if (balance < GAS_FLOOR) {
        // a refused top-up (already topped up today, balance fine) isn't the user's problem; the send says if it is
        await callFunction("gas-drip", { method: "POST", token: await session.getAccessToken() }).catch(() => null);
      }
      const hashes: Hex[] = [];
      for (const [i, call] of calls.entries()) {
        setState({ status: "sending", error: null, step: labels[i] ?? null });
        // simulate first so a refusal comes back with the contract's reason instead of a bare revert
        await publicClient.call({ account: session.address, to: call.to, data: call.data, value: call.value ?? 0n });
        const hash = await walletClient.sendTransaction({
          account: session.address,
          chain,
          to: call.to,
          data: call.data,
          value: call.value ?? 0n,
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("The transaction was refused. Refresh and try again.");
        hashes.push(hash);
      }
      await queryClient.invalidateQueries();
      setState({ status: "done", error: null, step: null });
      return hashes;
    } catch (error) {
      setState({ status: "error", error: friendlyError(error), step: null });
      return null;
    }
  }

  return { send, ...state, reset: () => setState({ status: "idle", error: null, step: null }) };
}
