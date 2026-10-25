"use client";

import { ExternalLink } from "lucide-react";
import { GradientPanel } from "@/components/app/gradient-panel";
import { InfoNotice } from "@/components/app/notice";
import { Topbar } from "@/components/app/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VaultActions } from "@/components/lend/vault-actions";
import { ASSET, accountUrl, config, ledgerReady } from "@/lib/config";
import { usd } from "@/lib/format";

/** How lending works on the XRP Ledger, in the order a lender meets it. */
const STEPS = [
  { title: "Get verified", body: "A reviewer approves you, then the app issues you an XRPL credential." },
  { title: "Join the vault's domain", body: "The vault is private: only accounts holding that credential can deposit." },
  { title: `Deposit ${ASSET}`, body: "The vault runs in rolling series. Deposit into the series taking deposits; it lends after that and pays out on its date, when you withdraw." },
  { title: "Earn the interest", body: "Each funded payment is an upfront loan from the vault. Borrowers pay it back with interest, and that interest flows back to the vault." },
];

/**
 * The lender's view of the XRPL single asset vaults, which run as rolling series. Until `pnpm xrpl:setup` has run, it
 * shows the terms and how lending works.
 */
export default function LendPage() {
  return (
    <div>
      <Topbar title="Lending vault" crumb={`XRPL ${config.network.replace("xrpl-", "")}`} action={null} />
      <div className="flex max-w-4xl flex-col gap-5">
        <GradientPanel tone="ledger" className="flex flex-col gap-4 p-6 sm:p-7">
          <span className="text-on-ink/75 text-[13px]">Single asset vault · {ASSET}</span>
          <h2 className="display-type text-[28px] sm:text-[36px]">Fund loans, earn the interest</h2>
          <p className="text-on-ink/82 max-w-xl text-sm leading-relaxed sm:text-[15px]">
            Lenders deposit {ASSET} into a private vault on the XRP Ledger. Verified businesses get an upfront loan from it,
            and pay it back with interest based on the loan horizon. A first-loss cushion from the loan broker sits in front of lenders.
          </p>
          {config.ledger.broker ? (
            <div>
              <Button asChild variant="light" size="sm">
                <a href={accountUrl(config.ledger.broker ?? "")} target="_blank" rel="noopener noreferrer">
                  Broker on the explorer <ExternalLink className="size-4" />
                </a>
              </Button>
            </div>
          ) : null}
        </GradientPanel>

        {ledgerReady ? (
          <Card>
            <CardHeader>
              <CardTitle>Vault series</CardTitle>
            </CardHeader>
            <CardContent>
              <VaultActions />
            </CardContent>
          </Card>
        ) : (
          <InfoNotice title="The vault isn't set up yet">
            Deposits, withdrawals, and live vault numbers switch on once the vault, loan broker, and credential domain are
            created on the ledger.
          </InfoNotice>
        )}

        <Card>
          <CardHeader>
            <CardTitle>How it works</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-4 sm:grid-cols-2">
              {STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-3">
                  <span className="bg-surface-muted flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold">{i + 1}</span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold">{step.title}</span>
                    <span className="text-muted-foreground text-sm">{step.body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Terms</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-muted-foreground">Vault deposit cap</span>
              <span className="tabular font-semibold">{usd(config.params.poolDepositCap)}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-muted-foreground">Largest single loan</span>
              <span className="tabular font-semibold">{usd(config.params.perReceivableCap)}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-muted-foreground">Interest</span>
              <span className="tabular font-semibold">{config.params.feeBps / 100}% a year</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
