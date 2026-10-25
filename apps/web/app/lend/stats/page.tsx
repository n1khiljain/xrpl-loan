"use client";

import { ExternalLink } from "lucide-react";
import { AccountGate } from "@/components/app/account-gate";
import { GradientPanel } from "@/components/app/gradient-panel";
import { ErrorNotice, InfoNotice } from "@/components/app/notice";
import { Topbar } from "@/components/app/topbar";
import { Stat, seriesName, seriesStage, useVault } from "@/components/lend/vault-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ASSET, accountUrl, config, ledgerReady } from "@/lib/config";
import { friendlyError } from "@/lib/errors";
import { usd } from "@/lib/format";

/**
 * Vault stats across every series. Deposits, debt, cover, and unrealized loss come from the vault and loan broker
 * objects on the ledger; interest comes from the loans the app recorded (paid on closed-out loans, and still due on
 * open ones).
 */
function Stats() {
  const vault = useVault();
  if (!ledgerReady) return <InfoNotice title="The vault isn't set up yet">Run pnpm xrpl:setup to create it.</InfoNotice>;
  if (vault.isPending) return <Skeleton className="h-64 w-full rounded-3xl" />;
  if (vault.isError) return <ErrorNotice>{friendlyError(vault.error)}</ErrorNotice>;
  const { totals, series } = vault.data;
  const lent = BigInt(totals.assetsTotal) - BigInt(totals.assetsAvailable);
  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <GradientPanel tone="ledger" className="flex flex-col gap-5 p-6 sm:p-7">
        <div className="flex flex-col gap-1">
          <span className="text-on-ink/75 text-[13px]">All vault series · {ASSET}</span>
          <span className="money-type text-5xl" data-testid="stats-total">
            {usd(totals.assetsTotal)}
          </span>
          <span className="text-on-ink/80 text-sm">in the vaults, {usd(lent)} of it lent out</span>
        </div>
        <div className="grid gap-4 text-sm sm:grid-cols-4">
          <Stat onInk label="Outstanding debt" value={usd(totals.debtTotal)} />
          <Stat onInk label="First-loss cover" value={usd(totals.coverAvailable)} />
          <Stat onInk label="Interest earned" value={usd(totals.interestEarned)} />
          <Stat onInk label="Interest still due" value={usd(totals.interestExpected)} />
        </div>
      </GradientPanel>

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          ["Available to lend", usd(totals.assetsAvailable)],
          ["Unrealized loss", usd(totals.lossUnrealized)],
          ["Loans outstanding", String(totals.loansOutstanding)],
          ["Late or defaulted", `${totals.loansImpaired} late · ${totals.loansDefaulted} defaulted`],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="pt-6">
              <Stat label={label as string} value={value as string} />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Series</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <a href={accountUrl(vault.data.broker)} target="_blank" rel="noopener noreferrer">
              Broker on the explorer <ExternalLink className="size-4" />
            </a>
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {series.length === 0 ? (
            <InfoNotice title="No series yet" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Series</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">In the vault</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Debt</TableHead>
                  <TableHead className="text-right">Cover</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {series.map((s) => (
                  <TableRow key={s.vaultId} data-testid={`stats-series-${s.vaultId.slice(0, 8)}`}>
                    <TableCell className="font-medium">
                      {seriesName(s)}
                      <span className="text-muted-foreground block font-mono text-xs">{s.vaultId.slice(0, 10)}…</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{seriesStage(s)}</TableCell>
                    <TableCell className="tabular text-right">{usd(s.assetsTotal)}</TableCell>
                    <TableCell className="tabular text-right">{usd(s.assetsAvailable)}</TableCell>
                    <TableCell className="tabular text-right">{usd(s.debtTotal)}</TableCell>
                    <TableCell className="tabular text-right">{usd(s.coverAvailable)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <p className="text-muted-foreground text-xs">
        Interest is {config.params.feeBps / 100}% a year, prorated to each loan&apos;s length. Each series&apos;s first-loss cover is posted by the loan broker
        and absorbs a default before lenders do.
      </p>
    </div>
  );
}

export default function VaultStatsPage() {
  return (
    <AccountGate reason="Sign in to see the vault stats.">
      {() => (
        <>
          <Topbar title="Vault stats" crumb="Lending" action={null} />
          <Stats />
        </>
      )}
    </AccountGate>
  );
}
