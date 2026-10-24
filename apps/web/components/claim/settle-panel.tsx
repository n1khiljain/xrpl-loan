"use client";

import { claimRegistryAbi } from "@app/abi";
import type { ClaimView } from "@app/adapters";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { erc20Abi } from "viem";
import { ErrorNotice } from "@/components/app/notice";
import { MoneyField } from "@/components/app/money-field";
import { Button } from "@/components/ui/button";
import { contractCall, useSendCalls } from "@/hooks/use-tx";
import { publicClient } from "@/lib/chain";
import { deployedContracts } from "@/lib/config";
import { amountDue, parseUsd, usd, weiToInput } from "@/lib/format";
import { useSession } from "@/lib/session/context";

export function useTokenBalance() {
  const session = useSession();
  const deployed = deployedContracts();
  return useQuery({
    queryKey: ["balance", session.address],
    enabled: Boolean(session.address && deployed),
    queryFn: () =>
      publicClient.readContract({ address: deployed!.frxUSD, abi: erc20Abi, functionName: "balanceOf", args: [session.address!] }),
    refetchInterval: 5_000,
  });
}

/** An hour of fee covers the time between reading what's owed and the payment landing. */
const FEE_BUFFER_SECONDS = 3_600;

/**
 * What to approve and pass to `settle` for a payment of `wei`. Paying everything that's shown adds an hour of fee on
 * the unpaid principal, because the fee keeps accruing until the payment lands (U-84). `settle` only takes what's
 * owed, so nobody pays the buffer.
 */
function withFeeBuffer(onchain: ClaimView, wei: bigint): bigint {
  const accruing = onchain.state === "Funded" || onchain.state === "GuarantorCalled";
  if (!accruing || onchain.feeBps === 0 || wei < onchain.amountRemaining) return wei;
  const unpaidPrincipal = onchain.purchasePrice > onchain.amountPaid ? onchain.purchasePrice - onchain.amountPaid : 0n;
  return wei + amountDue(unpaidPrincipal, BigInt(onchain.feeBps), FEE_BUFFER_SECONDS) - unpaidPrincipal;
}

/** Pays some or all of what's left. Anyone can pay; partial payments are fine (PRD 8.7). */
export function SettlePanel({ onchain, label = "Send" }: { onchain: ClaimView; label?: string }) {
  const session = useSession();
  const deployed = deployedContracts();
  const balance = useTokenBalance();
  const tx = useSendCalls();
  const [amount, setAmount] = useState(weiToInput(onchain.amountRemaining));
  const wei = parseUsd(amount);
  const short = balance.data !== undefined && wei !== null && balance.data < wei;
  const after = balance.data !== undefined && wei !== null && !short ? balance.data - wei : null;

  async function settle() {
    if (!deployed || !wei || !session.address) return;
    const payment = withFeeBuffer(onchain, wei);
    const allowance = await publicClient.readContract({
      address: deployed.frxUSD,
      abi: erc20Abi,
      functionName: "allowance",
      args: [session.address, deployed.claimRegistry],
    });
    const calls = [];
    const labels = [];
    if (allowance < payment) {
      calls.push(contractCall({ address: deployed.frxUSD, abi: erc20Abi, functionName: "approve", args: [deployed.claimRegistry, payment] }));
      labels.push("Allowing the payment");
    }
    calls.push(contractCall({ address: deployed.claimRegistry, abi: claimRegistryAbi, functionName: "settle", args: [onchain.id, payment] }));
    labels.push("Paying the pool");
    await tx.send(calls, labels);
  }

  return (
    <div className="space-y-4" data-testid="settle-panel">
      <MoneyField id="settle-amount" label="Amount to send" value={amount} onChange={setAmount} onMax={() => setAmount(weiToInput(onchain.amountRemaining))} />
      <div className="grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
        <span className="text-muted-foreground">Left to send</span>
        <span className="text-right font-semibold">{usd(onchain.amountRemaining)}</span>
        <span className="text-muted-foreground">Your wallet</span>
        <span className="text-right font-semibold">{usd(balance.data ?? 0n)}</span>
        {after !== null ? (
          <>
            <span className="text-muted-foreground">Left after this</span>
            <span className="text-right font-semibold">{usd(after)}</span>
          </>
        ) : null}
      </div>
      {short ? <p className="text-warning text-sm">Your wallet doesn&apos;t have that much yet.</p> : null}
      <Button onClick={() => void settle()} disabled={!wei || wei === 0n || short || tx.status === "sending"} data-testid="settle" size="lg" className="w-full sm:w-auto">
        {tx.status === "sending" ? (tx.step ?? "Sending...") : `${label} ${wei ? usd(wei) : ""} to Frax`}
      </Button>
      <p className="text-muted-foreground text-xs">Anyone can send this for you, so a teammate or your org can too.</p>
      {tx.error ? <ErrorNotice>{tx.error}</ErrorNotice> : null}
    </div>
  );
}
