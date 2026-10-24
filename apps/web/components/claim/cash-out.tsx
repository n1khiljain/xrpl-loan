"use client";

import { checkLiquidationAddress, createCashOut } from "@app/adapters";
import { ArrowRightLeft, Check, ExternalLink, Landmark, Wallet, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { CtaLabel } from "@/components/app/cta";
import { Disclosure } from "@/components/app/disclosure";
import { MoneyField } from "@/components/app/money-field";
import { EASE } from "@/components/motion";
import { ErrorNotice } from "@/components/app/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSendCalls } from "@/hooks/use-tx";
import { publicClient } from "@/lib/chain";
import { config, deployedContracts } from "@/lib/config";
import { parseUsd, usd, weiToInput } from "@/lib/format";
import { useSession } from "@/lib/session/context";
import { useTokenBalance } from "./settle-panel";

/** A dot and a line, the way the rest of the app marks testnet-only things (U-75). */
function TestnetNote({ children }: { children: string }) {
  return (
    <p role="status" className="text-muted-foreground flex items-center gap-2 text-[13px]">
      <span aria-hidden className="bg-warning size-1.5 shrink-0 rounded-full" />
      {children}
    </p>
  );
}

type Step = { icon: LucideIcon; label: string; detail: string };

/** The path frxUSD takes to a bank account, from the design canvas; Frax Mesh only shows up for the mesh adapter. */
function moneyPath(kind: "mesh" | "simulated" | undefined): Step[] {
  const steps: Step[] = [{ icon: Wallet, label: "Your wallet", detail: "frxUSD on Fraxtal" }];
  if (kind === "mesh") steps.push({ icon: ArrowRightLeft, label: "Frax Mesh", detail: "Fraxtal to Ethereum, under a minute" });
  steps.push({ icon: ArrowRightLeft, label: "FraxNet", detail: "Your liquidation address" });
  steps.push({ icon: Landmark, label: "Your bank", detail: "ACH, 1 to 3 business days" });
  return steps;
}

/** Sends frxUSD from the wallet to the user's bank through the CashOut adapter (PRD 8.6). `reminder` is what they still owe Frax. */
export function CashOut({ reminder = null }: { reminder?: string | null }) {
  const session = useSession();
  const tx = useSendCalls();
  const balance = useTokenBalance();
  const [amount, setAmount] = useState("");
  const [liquidation, setLiquidation] = useState("");
  const [addressError, setAddressError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const wei = parseUsd(amount) ?? balance.data ?? 0n;
  const cashOut = deployedContracts() ? createCashOut(config, { publicClient }) : null;

  async function send() {
    if (!cashOut || wei === 0n || !session.address) return;
    // UNCERTAIN: U-37 (on mainnet the user pastes it until FraxNet's API returns it)
    let liquidationAddress = config.cashOutSink as `0x${string}`;
    if (!cashOut.simulated) {
      try {
        // a checksummed, non-zero address (E-5c)
        liquidationAddress = checkLiquidationAddress(liquidation);
      } catch (error) {
        setAddressError(error instanceof Error ? error.message : "That isn't a valid address.");
        return;
      }
    }
    setAddressError(null);
    const calls = await cashOut.buildTransfer({ from: session.address, amount: wei, liquidationAddress });
    if (await tx.send(calls.map((c) => ({ to: c.to, data: c.data, value: c.value })), ["Sending to your bank"])) setSent(usd(wei));
  }

  if (sent) {
    const note = cashOut?.simulated ? " (simulated)" : "";
    return (
      <motion.div className="flex flex-col gap-4" data-testid="cash-out-done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}>
        <div className="flex items-center gap-3">
          <motion.span
            className="bg-foreground text-background flex size-10 shrink-0 items-center justify-center rounded-full"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 22, delay: 0.1 }}
          >
            <Check aria-hidden className="size-5" strokeWidth={2.6} />
          </motion.span>
          <p className="font-semibold">Sent {sent} to your bank</p>
        </div>
        <ol className="text-muted-foreground space-y-1 text-sm">
          <li>Sent {sent} to FraxNet</li>
          <li>Bank transfer started{note}</li>
          <li>Arrives in 1 to 2 business days{note}</li>
        </ol>
        {cashOut?.simulated ? <TestnetNote>Testnet: simulated bank transfer</TestnetNote> : null}
      </motion.div>
    );
  }

  const steps = moneyPath(cashOut?.kind);

  return (
    <div className="space-y-6" data-testid="cash-out">
      {cashOut?.simulated && config.features.testnetBanner ? <TestnetNote>The transfer is real on Fraxtal testnet. The bank deposit is simulated.</TestnetNote> : null}

      <MoneyField
        id="cash-amount"
        label="Amount to send to your bank"
        value={amount}
        onChange={setAmount}
        placeholder={balance.data ? weiToInput(balance.data) : "0.00"}
        onMax={() => balance.data && setAmount(weiToInput(balance.data))}
        maxDisabled={!balance.data}
        hint={
          <p className="text-muted-foreground text-sm">
            Your wallet has {usd(balance.data ?? 0n)}.{reminder ? ` ${reminder}` : ""}
          </p>
        }
      />

      <Disclosure label="Where the money goes" hint={steps.map((s) => s.label).join(", then ")}>
        <ol className="space-y-3">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <li key={step.label} className="flex items-center gap-3">
                <Icon aria-hidden className="text-muted-foreground size-[18px] shrink-0" strokeWidth={1.8} />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold">{step.label}</span>
                  <span className="text-muted-foreground text-xs">{step.detail}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </Disclosure>

      <div className="border-border flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3.5">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">Bank account linked on FraxNet</span>
          <span className="text-muted-foreground text-xs">Change it on net.frax.com under Settings, Bank accounts</span>
        </span>
        <a href="https://net.frax.com" target="_blank" rel="noopener noreferrer" className="text-foreground flex shrink-0 items-center gap-1 text-sm font-semibold underline-offset-4 hover:underline">
          Manage on FraxNet <ExternalLink className="size-3.5" />
        </a>
      </div>

      {cashOut && !cashOut.simulated ? (
        <div className="space-y-2">
          <Label htmlFor="liquidation">Your bank deposit address from FraxNet</Label>
          <Input
            id="liquidation"
            value={liquidation}
            onChange={(e) => setLiquidation(e.target.value)}
            aria-invalid={addressError !== null}
            aria-describedby={addressError ? "liquidation-error" : undefined}
          />
          {addressError ? (
            <p id="liquidation-error" className="text-destructive text-sm">
              {addressError}
            </p>
          ) : null}
        </div>
      ) : null}

      <Button
        size="lg"
        className="w-full pr-2 sm:w-auto sm:self-end"
        onClick={() => void send()}
        disabled={wei === 0n || tx.status === "sending"}
        data-testid="send-cash-out"
      >
        <CtaLabel>{tx.status === "sending" ? "Sending..." : `Cash out ${wei ? usd(wei) : ""}`}</CtaLabel>
      </Button>
      {tx.error ? <ErrorNotice>{tx.error}</ErrorNotice> : null}
    </div>
  );
}
