"use client";

import { ExternalLink } from "lucide-react";
import { InfoNotice } from "@/components/app/notice";
import { Topbar } from "@/components/app/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { GlyphField } from "@/components/landing/glyph-field";
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
      <div className="flex max-w-5xl flex-col gap-6">
        {/* the landing's orange lenders card: a white title, Night for the small text (white is too faint on this
            orange at that size), and the vault's bank rising out of the bottom right corner. Phones leave the bank
            out, where it would run into the title */}
        <section className="bg-grad-feature text-ink relative isolate flex min-h-[260px] flex-col gap-4 overflow-hidden rounded-3xl p-6 sm:min-h-[280px] sm:p-8 sm:pr-[42%]">
          <GlyphField
            shape="bank"
            seed={8}
            cell={11}
            anchor={1}
            fit={1}
            className="absolute -z-10 hidden sm:top-[8%] sm:-right-[2%] sm:-bottom-[12%] sm:block sm:w-[40%]"
          />
          <span className="text-sm">Single asset vault · {ASSET}</span>
          <h2 className="display-type text-on-ink max-w-[16ch] text-[32px] sm:text-[44px]">Fund loans, earn the interest</h2>
          <p className="mt-auto max-w-lg text-base leading-snug sm:text-lg">
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
        </section>

        {/* the same white card as the expedite form: generous padding, sections well apart, a display heading over a muted line */}
        <Card className="lg:py-10">
          <CardContent className="flex flex-col gap-10 sm:px-8 lg:px-10">
            <section className="flex flex-col gap-6">
              <div className="space-y-3">
                <h2 className="display-type text-2xl">Vault series</h2>
                <p className="text-muted-foreground text-sm">Deposit into the series taking deposits. It lends after that and pays out on its date.</p>
              </div>
              {ledgerReady ? (
                <VaultActions />
              ) : (
                <InfoNotice title="The vault isn't set up yet">
                  Deposits, withdrawals, and live vault numbers switch on once the vault, loan broker, and credential domain are
                  created on the ledger.
                </InfoNotice>
              )}
            </section>

            <section className="flex flex-col gap-6">
              <div className="space-y-3">
                <h2 className="display-type text-2xl">How it works</h2>
                <p className="text-muted-foreground text-sm">Four steps, in the order a lender meets them.</p>
              </div>
              <ol className="grid gap-3 sm:grid-cols-2">
                {STEPS.map((step, i) => (
                  <li key={step.title} className="border-border bg-surface flex gap-4 rounded-lg border px-5 py-4">
                    <span className="bg-surface-muted flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold">{i + 1}</span>
                    <span className="flex flex-col gap-1">
                      <span className="text-sm font-semibold">{step.title}</span>
                      <span className="text-muted-foreground text-sm leading-relaxed">{step.body}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="flex flex-col gap-6">
              <div className="space-y-3">
                <h2 className="display-type text-2xl">Terms</h2>
                <p className="text-muted-foreground text-sm">Set by the vault on the ledger, the same for every lender.</p>
              </div>
              <dl className="grid gap-3 sm:grid-cols-3">
                {[
                  ["Vault deposit cap", usd(config.params.poolDepositCap)],
                  ["Largest single loan", usd(config.params.perReceivableCap)],
                  ["Interest", `${config.params.feeBps / 100}% a year`],
                ].map(([label, value]) => (
                  <div key={label} className="border-border bg-surface flex flex-col gap-1 rounded-lg border px-5 py-4">
                    <dt className="text-muted-foreground text-sm">{label}</dt>
                    <dd className="money-type text-2xl">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
