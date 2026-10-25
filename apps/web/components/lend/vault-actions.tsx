"use client";

import { TEST_DRAW_UNITS } from "@app/adapters";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorNotice, InfoNotice } from "@/components/app/notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCall } from "@/hooks/use-api";
import { ASSET, config } from "@/lib/config";
import { friendlyError } from "@/lib/errors";
import { dateFromSeconds, parseUsd, usd } from "@/lib/format";
import type { VaultSeriesView, VaultView } from "@/lib/types";

/** The vault series, as one shared query: the lender page and the stats page read the same data. */
export function useVault() {
  const call = useCall();
  return useQuery({ queryKey: ["vault"], queryFn: () => call<VaultView>("vault"), refetchInterval: 15_000 });
}

/** A short, stable name for a series: when it pays out. */
export function seriesName(s: VaultSeriesView): string {
  return s.redemptionAt ? `Series paying out ${dateFromSeconds(s.redemptionAt)}` : "Open vault";
}

/** What a series is doing now, in one line. */
export function seriesStage(s: VaultSeriesView): string {
  if (s.phase === "subscription") return `Taking deposits until ${s.subscriptionAt ? dateFromSeconds(s.subscriptionAt) : "soon"}, then lending`;
  if (s.phase === "lending") return `Lending until ${s.redemptionAt ? dateFromSeconds(s.redemptionAt) : "its payout date"}`;
  if (s.phase === "closed") return "Paying out: withdraw your share";
  return "Taking deposits and lending";
}

function SeriesCard({ series }: { series: VaultSeriesView }) {
  const call = useCall();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const send = useMutation({
    mutationFn: (action: "deposit" | "withdraw") => {
      const units = parseUsd(amount);
      if (units === null || units <= 0n) throw new Error("Enter an amount like 100.00");
      return call("vault", { method: "POST", body: { action, amount: units.toString(), vaultId: series.vaultId } });
    },
    onSuccess: async () => {
      setAmount("");
      await queryClient.invalidateQueries({ queryKey: ["vault"] });
    },
  });
  const canDeposit = series.phase === "subscription" || series.phase === "open";
  const canWithdraw = (series.phase === "closed" || series.phase === "open") && BigInt(series.yourShares) > 0n;
  return (
    <Card data-testid={`series-${series.vaultId.slice(0, 8)}`}>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">{seriesName(series)}</span>
          <span className="text-muted-foreground text-sm">{seriesStage(series)}</span>
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <Stat label="In this series" value={usd(series.assetsTotal)} />
          <Stat label="Available to lend" value={usd(series.assetsAvailable)} />
          <Stat label="Your share" value={usd(series.yourValue)} />
        </div>
        {canDeposit || canWithdraw ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input inputMode="decimal" placeholder="0.00" aria-label={`Amount of ${ASSET}`} value={amount} onChange={(event) => setAmount(event.target.value)} />
            <div className="flex gap-2">
              {canDeposit ? (
                <Button disabled={send.isPending} onClick={() => send.mutate("deposit")} data-testid="vault-deposit">
                  Deposit
                </Button>
              ) : null}
              {canWithdraw ? (
                <Button variant="outline" disabled={send.isPending} onClick={() => send.mutate("withdraw")} data-testid="vault-withdraw">
                  Withdraw
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            {series.phase === "lending" && BigInt(series.yourShares) > 0n
              ? `Your share is lent out. You can withdraw it once the series pays out${series.redemptionAt ? ` on ${dateFromSeconds(series.redemptionAt)}` : ""}.`
              : "Deposits closed when this series started lending."}
          </p>
        )}
        {send.isError ? <ErrorNotice>{friendlyError(send.error)}</ErrorNotice> : null}
      </CardContent>
    </Card>
  );
}

/**
 * The rolling vault series: one card per series, newest first. Deposits go into a series taking deposits; each
 * series lends after that and pays out on its date, when its lenders withdraw. On the stand-in asset there's a
 * button for test RLUSD to deposit.
 */
export function VaultActions() {
  const call = useCall();
  const queryClient = useQueryClient();
  const vault = useVault();
  const draw = useMutation({
    mutationFn: () => call("vault", { method: "POST", body: { action: "draw" } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vault"] }),
  });
  const data = vault.data;
  const series = [...(data?.series ?? [])].sort((a, b) => (b.subscriptionAt ?? 0) - (a.subscriptionAt ?? 0));
  return (
    <div className="flex flex-col gap-4" data-testid="vault-actions">
      {vault.isError ? <ErrorNotice>{friendlyError(vault.error)}</ErrorNotice> : null}
      {data ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            Your wallet: <span className="tabular font-semibold">{usd(data.balance)}</span> {ASSET}
          </p>
          {config.asset.standIn ? (
            <Button variant="outline" size="sm" disabled={draw.isPending} onClick={() => draw.mutate()} data-testid="vault-draw">
              {draw.isPending ? "Sending..." : `Get ${usd(TEST_DRAW_UNITS)} test ${ASSET}`}
            </Button>
          ) : null}
        </div>
      ) : null}
      {draw.isError ? <ErrorNotice>{friendlyError(draw.error)}</ErrorNotice> : null}
      {data && series.length === 0 ? <InfoNotice title="No vault series yet">Run pnpm xrpl:setup series to open one.</InfoNotice> : null}
      {series.map((s) => (
        <SeriesCard key={s.vaultId} series={s} />
      ))}
    </div>
  );
}

/** A label over a figure. `onInk` for dark panels, where the muted grey is too faint. */
export function Stat({ label, value, onInk = false }: { label: string; value: string; onInk?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={onInk ? "text-on-ink/75" : "text-muted-foreground"}>{label}</span>
      <span className="tabular font-semibold">{value}</span>
    </div>
  );
}
