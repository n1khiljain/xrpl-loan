"use client";

import type { ClaimView } from "@app/adapters";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AccountGate } from "@/components/app/account-gate";
import { GradientPanel } from "@/components/app/gradient-panel";
import { Segmented } from "@/components/app/segmented";
import { Money } from "@/components/app/money";
import { ErrorNotice } from "@/components/app/notice";
import { CARD_TONE, STATE_LABEL, StateChip, type DisplayState } from "@/components/app/state-chip";
import { Topbar } from "@/components/app/topbar";
import { ClaimCard, cardNumber } from "@/components/brand/claim-card";
import { CountUp, EASE } from "@/components/motion";
import { CashOut } from "@/components/claim/cash-out";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCall, useOrgs } from "@/hooks/use-api";
import { findOnchain } from "@/hooks/use-claim";
import { useNowSeconds } from "@/hooks/use-now";
import { displayState } from "@/lib/claim-record";
import { friendlyError } from "@/lib/errors";
import { dateFromSeconds, daysFrom, usd } from "@/lib/format";
import type { DirectoryOrg, MeResponse, OffchainClaim } from "@/lib/types";
import { cn } from "@/lib/utils";

type Role = "claimant" | "guarantor" | "org";
type Row = { claim: OffchainClaim; onchain: ClaimView | null; state: DisplayState; role: Role };

const OPEN_STATES: DisplayState[] = ["Draft", "Submitted", "Approved", "Funded", "GuarantorCalled"];
// the table needs about 670px; below that (a narrow window, or the laptop widths where the card aside takes room)
// the section shows the phone rows instead. Keyed to the section's own width, not the window's.
const TABLE_COLS = "@2xl:grid-cols-[40px_minmax(0,1fr)_104px_88px_120px_100px]";

function useClaimRows(me: MeResponse) {
  const call = useCall();
  const wallet = me.profile?.wallet;
  return useQuery({
    queryKey: ["claims", "mine"],
    queryFn: async () => {
      const { claims } = await call<{ claims: OffchainClaim[] }>("claims");
      const rows = await Promise.all(
        claims.map(async (claim): Promise<Row> => {
          const onchain = await findOnchain(claim).catch(() => null);
          const state = displayState(claim, onchain);
          const role: Role = claim.recipientWallet === wallet ? "claimant" : claim.guarantorWallet === wallet ? "guarantor" : "org";
          return { claim, onchain, state, role };
        }),
      );
      return rows.sort((a, b) => new Date(b.claim.updatedAt).getTime() - new Date(a.claim.updatedAt).getTime());
    },
  });
}

function resolveOrgName(rows: Row[], orgs: DirectoryOrg[] | undefined): string | null {
  if (!orgs || orgs.length === 0) return null;
  const mine = rows.find((r) => r.role === "claimant") ?? rows[0];
  if (!mine) return null;
  return orgs.find((o) => o.id === mine.claim.orgId)?.name ?? null;
}

function crumbFor(me: MeResponse, orgName: string | null): string {
  if (me.officerOrgs.length > 0) return me.officerOrgs.map((o) => o.name).join(", ");
  return orgName ?? "Member";
}

function roleLabel(role: Role): string {
  return role === "claimant" ? "Yours" : role === "guarantor" ? "You signed off" : "Your org";
}

function payerLabel(claim: OffchainClaim): string {
  return claim.recipientType === "org_treasurer" ? "Org paid" : "You paid";
}

function dateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });
}

function idFor(row: Row): string {
  if (row.onchain && row.onchain.state !== "None") return `#${row.onchain.id}`;
  if (row.claim.onchainClaimId !== null) return `#${row.claim.onchainClaimId}`;
  return "Draft";
}

/** The dollar figure that matters most for a row's current state, from the onchain claim when there is one. */
function amountFor(row: Row): bigint {
  const { claim, onchain, state } = row;
  if (onchain && onchain.state !== "None") {
    if (state === "Approved") return onchain.approvedAmount;
    if (state === "Funded" || state === "GuarantorCalled") return onchain.amountRemaining;
    if (state === "Settled" || state === "Recovered" || state === "WrittenOff") return onchain.amountDue;
  }
  return BigInt(claim.requestedAmount);
}

function nextStepFor(row: Row, nowSeconds: number): string {
  const { claim, onchain, state } = row;
  if (state === "Draft") {
    if (!claim.packetHash) return "Add receipts to continue";
    if (!claim.guarantySigned) return "Waiting for officer sign-off";
    return "Ready to submit";
  }
  if (state === "Submitted") return "Reviewed within a day";
  if (state === "Approved" && onchain) {
    const days = daysFrom(onchain.approvalExpiresAt, nowSeconds * 1000);
    return `Expires in ${days} ${days === 1 ? "day" : "days"}`;
  }
  if (state === "Funded" && onchain) return `Send by ${dateFromSeconds(onchain.dueAt)}`;
  if (state === "GuarantorCalled") return "Payment needed";
  if (state === "Settled") return `Closed out ${dateOnly(claim.updatedAt)}`;
  if (state === "Recovered") return `Closed out ${dateOnly(claim.updatedAt)}`;
  if (state === "WrittenOff") return "Written off";
  return "";
}

/** Get paid / Settle / View / Finish, from the design canvas; blank once a claim is closed out. */
function actionFor(row: Row): string {
  const { state, role } = row;
  if (role === "claimant") {
    if (state === "Draft") return "Finish";
    if (state === "Submitted") return "View";
    if (state === "Approved") return "Get paid";
    if (state === "Funded" || state === "GuarantorCalled") return "Send to Frax";
    return "";
  }
  if (role === "guarantor") {
    if (state === "GuarantorCalled" || state === "WrittenOff") return "Send to Frax";
    if (state === "Settled" || state === "Recovered" || state === "Rejected" || state === "Cancelled") return "";
    return "View";
  }
  if (state === "Settled" || state === "Recovered" || state === "Rejected" || state === "Cancelled" || state === "WrittenOff") return "";
  return "View";
}

function mobileStatusLine(row: Row, next: string): string {
  const label = STATE_LABEL[row.state];
  if (!next) return label;
  if (next.toLowerCase().startsWith(label.toLowerCase())) return next;
  return `${label} · ${next.charAt(0).toLowerCase()}${next.slice(1)}`;
}

function ClaimRow({ row, now, index }: { row: Row; now: number; index: number }) {
  const { claim, state, role } = row;
  const id = idFor(row);
  const title = claim.description ?? `Purchase request ${claim.callinkPrNumber}`;
  const sub = `${roleLabel(role)}${role === "claimant" ? ` · ${payerLabel(claim)}` : ""} · ${dateOnly(claim.createdAt)}`;
  const amount = amountFor(row);
  const next = nextStepFor(row, now);
  const action = actionFor(row);

  return (
    <motion.li initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: Math.min(index, 8) * 0.04, ease: EASE }}>
      <Link href={`/claim/?id=${claim.id}`} className="hover:bg-surface-muted -mx-1 block rounded-lg px-1 transition-colors">
        {/* phone */}
        <div className="flex items-center gap-3 py-3 @2xl:hidden">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[15px] font-semibold">{title}</span>
            <span className="text-muted-foreground truncate text-xs">{mobileStatusLine(row, next)}</span>
          </span>
          <span className="flex flex-col items-end gap-0.5">
            <Money wei={amount} size="sm" className="font-semibold" />
            {action ? <span className="text-foreground text-xs font-semibold">{action}</span> : null}
          </span>
        </div>
        {/* desktop */}
        <div className={cn("hidden items-center gap-2 py-3 @2xl:grid", TABLE_COLS)}>
          <span className="text-muted-foreground tabular text-xs">{id}</span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-semibold">{title}</span>
            <span className="text-muted-foreground truncate text-xs">{sub}</span>
          </span>
          <StateChip state={state} />
          <Money wei={amount} size="sm" className="text-right font-semibold" />
          <span className="text-muted-foreground pl-4 text-[13px]">{next}</span>
          {action ? (
            <span className="text-foreground flex items-center gap-1 justify-self-end text-[13px] font-semibold whitespace-nowrap">
              {action} <ArrowRight aria-hidden className="size-3.5" />
            </span>
          ) : (
            <span />
          )}
        </div>
      </Link>
    </motion.li>
  );
}

function EmptyClaims({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="space-y-4 py-10 text-center">
        <p className="text-muted-foreground text-sm">{text}</p>
        <Button asChild>
          <Link href="/claims/new/">Get reimbursed now</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

const TABS = [
  { value: "open", label: "Open" },
  { value: "settled", label: "Closed out" },
  { value: "all", label: "All" },
] as const;

/** The claims table/list with the design's Open, Settled, and All tabs. Shared by Home, My claims, and Guaranties. */
function ClaimsSection({ rows, emptyText }: { rows: Row[]; emptyText: string }) {
  const now = useNowSeconds();
  const [tab, setTab] = useState<"open" | "settled" | "all">("all");
  if (rows.length === 0) return <EmptyClaims text={emptyText} />;
  const filtered = tab === "all" ? rows : rows.filter((r) => OPEN_STATES.includes(r.state) === (tab === "open"));
  return (
    <section className="bg-card @container flex flex-col rounded-2xl p-5 sm:p-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Reimbursements</h2>
        <Segmented id="claims" label="Show" options={TABS} value={tab} onChange={setTab} />
      </div>
      <div className={cn("text-muted-foreground hidden gap-2 border-b border-divider px-1 py-2.5 text-xs font-medium @2xl:grid", TABLE_COLS)}>
        <span>ID</span>
        <span>Reimbursement</span>
        <span>Status</span>
        <span className="text-right">Amount</span>
        <span className="pl-4">Next</span>
        <span />
      </div>
      <ul data-testid="claim-list" className="divide-divider divide-y">
        {filtered.length === 0 ? <li className="text-muted-foreground py-8 text-center text-sm">Nothing here yet.</li> : null}
        {filtered.map((row, i) => (
          <ClaimRow key={row.claim.id} row={row} now={now} index={i} />
        ))}
      </ul>
    </section>
  );
}

function TabFigure({ label, value, active, onSelect }: { label: string; value: bigint; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "flex flex-col items-start gap-0.5 border-b-2 pb-2.5 text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-on-ink/40",
        active ? "border-on-ink text-on-ink" : "text-on-ink/60 hover:text-on-ink/85 border-transparent",
      )}
    >
      <span className="eyebrow">{label}</span>
      <span className="text-[15px] font-semibold">{usd(value)}</span>
    </button>
  );
}

type Figure = "due" | "ready" | "settled";

const DOLLARS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const dollars = (n: number) => DOLLARS.format(n);

const claimCount = (n: number) => `${n} ${n === 1 ? "reimbursement" : "reimbursements"}`;

function GuarantyCard({ row, className }: { row: Row; className?: string }) {
  const amount = usd(BigInt(row.claim.requestedAmount));
  return (
    <Link href={`/claim/?id=${row.claim.id}`} className={cn("flex flex-col", className)}>
      <GradientPanel tone="gold" className="flex flex-1 flex-col justify-between gap-3 p-5">
        <span className="eyebrow text-highlight">Sign-off request</span>
        <span className="text-[15px] leading-snug font-semibold">
          {row.claim.description ? `A guaranty for ${amount}: ${row.claim.description}` : `A guaranty for ${amount}`}
        </span>
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          Review and sign <ArrowRight className="size-3.5" />
        </span>
      </GradientPanel>
    </Link>
  );
}

function HomeView({ rows, orgName }: { rows: Row[]; orgName: string | null }) {
  const [figure, setFigure] = useState<Figure>("due");
  if (rows.length === 0) return <EmptyClaims text="No reimbursements yet." />;
  const mine = rows.filter((r) => r.role === "claimant");
  const dueRows = mine.filter((r) => r.state === "Funded" || r.state === "GuarantorCalled");
  const due = dueRows.reduce((sum, r) => sum + amountFor(r), 0n);
  const readyRows = mine.filter((r) => r.state === "Approved");
  const ready = readyRows.reduce((sum, r) => sum + amountFor(r), 0n);
  const year = new Date().getFullYear();
  const settledRows = mine.filter((r) => (r.state === "Settled" || r.state === "Recovered") && new Date(r.claim.updatedAt).getFullYear() === year);
  const settledThisYear = settledRows.reduce((sum, r) => sum + amountFor(r), 0n);
  const shown = {
    due: { value: due, caption: `From ${claimCount(dueRows.length)}. Send it when ASUC pays you.` },
    ready: { value: ready, caption: `From ${claimCount(readyRows.length)}, approved and ready to collect.` },
    settled: { value: settledThisYear, caption: `From ${claimCount(settledRows.length)} closed out in ${year}.` },
  }[figure];
  const funded = mine.find((r) => r.state === "Funded");
  const settleHref = funded ? `/claim/?id=${funded.claim.id}` : null;
  const cardRow = mine.find((r) => r.state === "Funded") ?? mine.find((r) => r.state === "Approved") ?? mine.find((r) => r.state === "Submitted") ?? mine.find((r) => r.state === "Draft");
  const guarantyRow = rows.find((r) => r.role === "guarantor" && r.claim.packetHash && !r.claim.guarantySigned);

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <GradientPanel tone="panel" className="flex flex-col gap-5 p-6 lg:h-[300px]">
          <div className="flex gap-6 border-b border-on-ink/15">
            <TabFigure label="To send Frax" value={due} active={figure === "due"} onSelect={() => setFigure("due")} />
            <TabFigure label="Ready to collect" value={ready} active={figure === "ready"} onSelect={() => setFigure("ready")} />
            <TabFigure label="Closed out this year" value={settledThisYear} active={figure === "settled"} onSelect={() => setFigure("settled")} />
          </div>
          <div className="flex flex-col gap-1.5" aria-live="polite">
            <span className="money-type text-5xl sm:text-[64px]">
              <CountUp value={Number(shown.value / 10n ** 16n) / 100} format={dollars} duration={0.6} />
            </span>
            <p className="text-on-ink/80 text-sm">{shown.caption}</p>
          </div>
          {/* only what applies right now; "Get reimbursed now" is already top right, and reporting ASUC lives on the reimbursement */}
          <div className="mt-auto flex flex-wrap gap-2">
            {settleHref ? (
              <Button asChild variant="light" size="sm">
                <Link href={settleHref}>Send to Frax</Link>
              </Button>
            ) : null}
            <Button asChild variant={settleHref ? "glass" : "light"} size="sm">
              <Link href="/claims/?view=cash-out">Cash out</Link>
            </Button>
          </div>
        </GradientPanel>
        {guarantyRow ? <GuarantyCard row={guarantyRow} className="lg:hidden" /> : null}
        <ClaimsSection rows={rows} emptyText="No reimbursements yet." />
      </div>
      {cardRow || guarantyRow ? (
        <aside className="hidden w-[364px] shrink-0 flex-col gap-5 lg:flex">
          {cardRow ? (
            <section className="flex flex-col items-center gap-3.5">
              <h2 className="text-muted-foreground w-full text-sm font-medium">Latest reimbursement</h2>
              <ClaimCard
                claimId={cardNumber(cardRow.onchain && cardRow.onchain.state !== "None" ? cardRow.onchain.id : cardRow.claim.onchainClaimId)}
                amount={usd(amountFor(cardRow))}
                state={STATE_LABEL[cardRow.state]}
                org={orgName ?? "Your org"}
                tone={CARD_TONE[cardRow.state]}
              />
            </section>
          ) : null}
          {guarantyRow ? <GuarantyCard row={guarantyRow} className="hidden lg:flex" /> : null}
        </aside>
      ) : null}
    </div>
  );
}

function cashOutReminder(rows: Row[]): string | null {
  const funded = rows.filter((r) => r.role === "claimant" && r.state === "Funded" && r.onchain && r.onchain.state !== "None");
  if (funded.length === 0) return null;
  const total = funded.reduce((sum, r) => sum + amountFor(r), 0n);
  if (funded.length === 1) {
    const only = funded[0];
    return only ? `When ASUC pays you for ${idFor(only)}, you still send ${usd(total)} to Frax.` : null;
  }
  return `When ASUC pays you, you still send ${usd(total)} total to Frax.`;
}

function CashOutView({ rows }: { rows: Row[] }) {
  return (
    <Card className="max-w-2xl">
      <CardContent>
        <CashOut reminder={cashOutReminder(rows)} />
      </CardContent>
    </Card>
  );
}

function ClaimsView({ me }: { me: MeResponse }) {
  const view = useSearchParams().get("view");
  const rows = useClaimRows(me);
  const orgs = useOrgs();
  const firstName = (me.profile?.displayName ?? "").trim().split(/\s+/)[0] || "there";
  const orgName = resolveOrgName(rows.data ?? [], orgs.data);
  const title = view === "claims" ? "My reimbursements" : view === "guaranties" ? "Sign-offs" : view === "cash-out" ? "Cash out" : `Hi, ${firstName}`;
  const crumb = view ? undefined : crumbFor(me, orgName);

  return (
    <div>
      <Topbar title={title} crumb={crumb} />
      {rows.isPending ? (
        <Skeleton className="h-96 w-full rounded-3xl" />
      ) : rows.isError ? (
        <ErrorNotice>{friendlyError(rows.error)}</ErrorNotice>
      ) : view === "cash-out" ? (
        <CashOutView rows={rows.data} />
      ) : view === "guaranties" ? (
        <ClaimsSection rows={rows.data.filter((r) => r.role === "guarantor")} emptyText="No sign-offs yet." />
      ) : view === "claims" ? (
        <ClaimsSection rows={rows.data} emptyText="No reimbursements yet." />
      ) : (
        <HomeView rows={rows.data} orgName={orgName} />
      )}
    </div>
  );
}

export default function ClaimsPage() {
  return (
    <AccountGate reason="Sign in to see your reimbursements and sign-offs.">
      {(me) => (
        <Suspense fallback={<Skeleton className="h-96 w-full rounded-3xl" />}>
          <ClaimsView me={me} />
        </Suspense>
      )}
    </AccountGate>
  );
}
