"use client";

import { AdminShell } from "@/components/admin/admin-shell";
import { StatusText } from "@/components/admin/status-text";
import { InfoNotice } from "@/components/app/notice";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ASSET, accountUrl, config, ledgerReady } from "@/lib/config";
import { shortAddress, usd } from "@/lib/format";

type Row = { label: string; value: string; hint: string };

const days = (seconds: number) => `${Math.round(seconds / 86_400)} days`;

const LIMITS: Row[] = [
  { label: "Advance rate", value: `${config.params.advanceRateBps / 100}%`, hint: "Share of face value that can be paid out" },
  { label: "Interest", value: `${config.params.feeBps / 100}% a year`, hint: "Yearly rate on the unpaid loan. A shorter horizon costs less." },
  { label: "Per-loan cap", value: usd(config.params.perReceivableCap), hint: "Largest single one" },
  { label: "Per-business cap", value: usd(config.params.perOrgCap), hint: "Outstanding across one business" },
  { label: "Vault deposit cap", value: usd(config.params.poolDepositCap), hint: "Most the vault takes in" },
  { label: "Due window", value: days(config.params.overdueWindowSeconds), hint: "From payout to due date" },
  { label: "Approval expiry", value: days(config.params.approvalExpirySeconds), hint: "Time to collect after approval" },
  { label: "Write-off grace", value: days(config.params.writeOffGraceSeconds), hint: "After the approver is asked to cover" },
];

/** The ledger accounts and objects `pnpm xrpl:setup` writes into deployments/<network>.json. */
const ACCOUNTS: Array<{ label: string; address: string | null | undefined }> = [
  { label: `${ASSET} issuer`, address: config.asset.issuer },
  { label: "Loan broker", address: config.ledger.broker },
  { label: "Credential issuer", address: config.ledger.credentialIssuer },
  { label: "Repayment account", address: config.ledger.repaymentAccount },
];
const OBJECTS: Array<{ label: string; id: string | undefined }> = [
  { label: "Permissioned domain", id: config.ledger.domainId },
];

/** Product terms and ledger setup, read from deployments/<network>.json. Changing them is a config change and a redeploy. */
function Params() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Limits</CardTitle>
          <CardDescription>Set in deployments/{config.network}.json.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {LIMITS.map((row) => (
            <div key={row.label} className="border-border flex flex-col gap-1.5 rounded-md border p-4">
              <span className="text-[13px] font-bold">{row.label}</span>
              <span className="tabular text-lg font-semibold">{row.value}</span>
              <span className="text-muted-foreground text-xs">{row.hint}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            XRPL {config.network.replace("xrpl-", "")}
            <StatusText tone={ledgerReady ? "success" : "warning"}>{ledgerReady ? "Set up" : "Not set up"}</StatusText>
          </CardTitle>
          <CardDescription>
            Loan asset {ASSET}
            {config.asset.standIn ? ", issued by the app as a stand-in because RLUSD isn't on this network" : ""}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!ledgerReady ? (
            <InfoNotice title="Run the setup script">pnpm xrpl:setup creates the issuer, broker, and credential domain, then a first vault series with its loan broker and first-loss cover.</InfoNotice>
          ) : null}
          <dl className="divide-divider divide-y text-sm">
            {ACCOUNTS.map((a) => (
              <div key={a.label} className="flex items-center justify-between gap-3 py-2.5">
                <dt className="text-muted-foreground">{a.label}</dt>
                <dd className="font-mono text-xs">
                  {a.address ? (
                    <a href={accountUrl(a.address)} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                      {shortAddress(a.address)}
                    </a>
                  ) : (
                    "not created"
                  )}
                </dd>
              </div>
            ))}
            {OBJECTS.map((o) => (
              <div key={o.label} className="flex items-center justify-between gap-3 py-2.5">
                <dt className="text-muted-foreground">{o.label}</dt>
                <dd className="font-mono text-xs">{o.id ? `${o.id.slice(0, 10)}…` : "not created"}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ParamsPage() {
  return <AdminShell title="Parameters">{() => <Params />}</AdminShell>;
}
