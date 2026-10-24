"use client";

import { TEST_DRAW_UNITS } from "@app/adapters";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorNotice } from "@/components/app/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCall } from "@/hooks/use-api";
import { ASSET, config } from "@/lib/config";
import { friendlyError } from "@/lib/errors";
import { dateFromSeconds, parseUsd, usd } from "@/lib/format";

type VaultView = {
  phase: "subscription" | "lending" | "closed" | "unknown";
  subscriptionAt: number | null;
  redemptionAt: number | null;
  assetsTotal: string | null;
  assetsAvailable: string | null;
  balance: string | null;
};

/** Deposit, withdraw, and (on the stand-in asset) draw test RLUSD. The ledger decides which phase allows which. */
export function VaultActions() {
  const call = useCall();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const vault = useQuery({ queryKey: ["vault"], queryFn: () => call<VaultView>("vault") });
  const send = useMutation({
    mutationFn: (action: "deposit" | "withdraw" | "draw") => {
      if (action === "draw") return call("vault", { method: "POST", body: { action } });
      const units = parseUsd(amount);
      if (units === null || units <= 0n) throw new Error("Enter an amount like 100.00");
      return call("vault", { method: "POST", body: { action, amount: units.toString() } });
    },
    onSuccess: async () => {
      setAmount("");
      setLocalError(null);
      await queryClient.invalidateQueries({ queryKey: ["vault"] });
    },
  });
  const data = vault.data;
  const depositsOpen = !data || data.phase === "subscription" || data.phase === "unknown";
  const loansUntil = data?.redemptionAt ? data.redemptionAt - config.params.overdueWindowSeconds - 60 : null;
  const phaseLine =
    data?.phase === "subscription"
      ? `Deposits are open${data.subscriptionAt ? ` until ${dateFromSeconds(data.subscriptionAt)}` : ""}. Loans start after that.`
      : data?.phase === "lending"
        ? `Deposits are closed. Loans are open${loansUntil ? ` until ${dateFromSeconds(loansUntil)}` : ""}, while a loan still ends before redemption.`
        : data?.phase === "closed"
          ? "This vault is past the point where a new loan can be paid back before redemption."
          : null;

  function go(action: "deposit" | "withdraw" | "draw") {
    setLocalError(null);
    if (action !== "draw") {
      const units = parseUsd(amount);
      if (units === null || units <= 0n) {
        setLocalError("Enter an amount like 100.00");
        return;
      }
    }
    send.mutate(action);
  }

  return (
    <div className="flex flex-col gap-4" data-testid="vault-actions">
      {vault.isError ? <ErrorNotice>{friendlyError(vault.error)}</ErrorNotice> : null}
      {data ? (
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <Stat label="In the vault" value={usd(data.assetsTotal ?? 0n)} />
          <Stat label="Available to lend" value={usd(data.assetsAvailable ?? 0n)} />
          <Stat label={`Your ${ASSET}`} value={usd(data.balance ?? 0n)} />
        </div>
      ) : null}
      {phaseLine ? <p className="text-muted-foreground text-sm">{phaseLine}</p> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          inputMode="decimal"
          placeholder="0.00"
          aria-label={`Amount of ${ASSET}`}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <div className="flex gap-2">
          <Button disabled={!depositsOpen || send.isPending} onClick={() => go("deposit")} data-testid="vault-deposit">
            Deposit
          </Button>
          <Button variant="outline" disabled={send.isPending} onClick={() => go("withdraw")} data-testid="vault-withdraw">
            Withdraw
          </Button>
        </div>
      </div>
      {config.asset.standIn ? (
        <div>
          <Button variant="outline" size="sm" disabled={send.isPending} onClick={() => go("draw")} data-testid="vault-draw">
            {`Get ${usd(TEST_DRAW_UNITS)} test ${ASSET}`}
          </Button>
        </div>
      ) : null}
      {localError ? <ErrorNotice>{localError}</ErrorNotice> : null}
      {send.isError ? <ErrorNotice>{friendlyError(send.error)}</ErrorNotice> : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular font-semibold">{value}</span>
    </div>
  );
}
