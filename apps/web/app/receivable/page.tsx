"use client";

import type { ReceivableView } from "@app/adapters";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AccountGate } from "@/components/app/account-gate";
import { ErrorNotice } from "@/components/app/notice";
import { CARD_MOMENT, CARD_TONE, STATE_LABEL, type DisplayState } from "@/components/app/state-chip";
import { Timeline } from "@/components/app/timeline";
import { Topbar } from "@/components/app/topbar";
import { cardNumber } from "@/components/brand/receivable-card";
import { LiveReceivableCard } from "@/components/brand/live-receivable-card";
import { SellerActions, PageSection, StatePanel } from "@/components/receivable/seller-actions";
import { Swap } from "@/components/motion";
import { SettlePanel } from "@/components/receivable/settle-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useReceivableRecord } from "@/hooks/use-receivable";
import { displayState, timeline } from "@/lib/receivable-record";
import { friendlyError } from "@/lib/errors";
import { dollars, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MeResponse, OffchainReceivable } from "@/lib/types";
import { RECEIVABLE_TYPES } from "@/lib/receivable-types";

const TITLES: Partial<Record<DisplayState, string>> = {
  Draft: "Your loan",
  Submitted: "In review",
  Approved: "Approved",
  Funded: "You got the loan",
  GuarantorCalled: "Approver asked to cover",
  WrittenOff: "Written off",
  Settled: "Closed out",
  Recovered: "Closed out",
  Rejected: "Not approved",
  Cancelled: "Cancelled",
};

/** The amount this receivable's card and hero lead with: what's left once purchased, what was approved, else what was asked for. */
function headlineAmount(receivable: OffchainReceivable, onchain: ReceivableView | null): bigint {
  if (!onchain) return BigInt(receivable.requestedAmount);
  // a closed-out card shows what it was for, not the $0.00 left
  if (onchain.state === "Settled" || onchain.state === "Recovered") return onchain.amountDue;
  if (onchain.purchasedAt > 0) return onchain.amountRemaining;
  if (onchain.state === "Approved") return onchain.approvedAmount;
  return onchain.requestedAmount;
}

/** The guarantor's own view of the receivable: what they owe, or that nothing is owed yet (SYSTEM_DESIGN 6.2). */
function GuarantorPanel({ receivable, onchain, state }: { receivable: OffchainReceivable; onchain: ReceivableView | null; state: DisplayState }) {
  if (state === "GuarantorCalled" || state === "WrittenOff") {
    if (!onchain) return null;
    return (
      <div className="flex flex-col gap-10">
        <StatePanel lead={`Cover the ${usd(onchain.amountRemaining)} that's left.`} description="You signed off, so you cover what's left." />
        <PageSection title="Pay it back">
          <SettlePanel receivableId={receivable.id} onchain={onchain} who="approver" live={false} />
        </PageSection>
      </div>
    );
  }
  if (state === "Draft" && !receivable.guarantySigned) {
    return <StatePanel lead="This is waiting on your sign-off." description="Check your email for the link to sign off on this." />;
  }
  if (state === "Settled" || state === "Recovered") {
    return <StatePanel lead="Closed out. Nothing for you to cover." description="The loan was paid back to the vault in full." />;
  }
  return <StatePanel lead="Nothing for you to cover right now." description="We'll email you if that changes." />;
}

/** The facts of the loan as a plain list, so the page reads top to bottom. */
function Details({ receivable, onchain, receipts }: { receivable: OffchainReceivable; onchain: ReceivableView | null; receipts: number }) {
  const approved = onchain && onchain.approvedAmount > 0n ? onchain.approvedAmount : null;
  // each number once: the request, then what was approved (or asked for, before approval)
  const rows: Array<[string, string]> = [
    ["What it's for", receivable.description ?? "No description"],
    ["Kind", RECEIVABLE_TYPES[receivable.type].label],
    ["Owed by", receivable.payerName],
    [RECEIVABLE_TYPES[receivable.type].referenceLabel, receivable.reference],
    ["Payer pays by", new Date(`${receivable.dueDate}T12:00:00`).toLocaleDateString("en-US", { dateStyle: "medium" })],
    ["Amount owed", usd(BigInt(receivable.faceValue))],
    approved !== null ? ["Approved for", usd(approved)] : ["Asked for", usd(BigInt(receivable.requestedAmount))],
  ];
  rows.push(["Documents", `${receipts} ${receipts === 1 ? "file" : "files"}`]);
  return (
    <PageSection title="Details">
      <dl className="divide-divider divide-y text-sm" data-testid="receivable-details">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-6 py-2.5">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </PageSection>
  );
}

/** The timeline under the card on desktop, or at the end of the page on a phone. */
function Progress({ receivable, onchain, className }: { receivable: OffchainReceivable; onchain: ReceivableView | null; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      <h2 className="text-lg font-semibold">Progress</h2>
      <Timeline steps={timeline(receivable, onchain)} />
    </section>
  );
}

function ReceivableDetail({ me }: { me: MeResponse }) {
  const id = useSearchParams().get("id");
  const { offchain, onchain } = useReceivableRecord(id);
  if (!id) return <ErrorNotice title="Nothing picked">Open one from your list.</ErrorNotice>;
  if (offchain.isPending) return <Skeleton className="h-64 w-full" />;
  if (offchain.isError) return <ErrorNotice title="We couldn't open this">{friendlyError(offchain.error)}</ErrorNotice>;

  const { receivable, documents } = offchain.data;
  const state = displayState(receivable, onchain);
  const wallet = me.profile?.wallet;
  const isSeller = receivable.recipientWallet === wallet;
  const isGuarantor = receivable.guarantorWallet === wallet;
  const cardId = receivable.number;
  const calledAsGuarantor = isGuarantor && (state === "GuarantorCalled" || state === "WrittenOff");
  const title = calledAsGuarantor ? "You're asked to cover this" : (TITLES[state] ?? "Loan");
  const fromSignOffs = isGuarantor && !isSeller;
  const crumb = `No. ${cardNumber(cardId)}`;
  const back = fromSignOffs ? { href: "/receivables/?view=guaranties", label: "Sign-offs" } : { href: "/receivables/?view=receivables", label: "My loans" };

  return (
    <>
      <Topbar title={title} crumb={crumb} back={back} />
      {/* one page, read top to bottom: where it stands and what to do, then the details. The card and progress sit to
          the right on desktop; on a phone the card comes first and progress last. */}
      {/* one white sheet for the whole page, not a box per part */}
      <div className="bg-card grid grid-cols-1 gap-10 rounded-3xl p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-x-16 lg:p-10">
        <aside className="flex flex-col items-center gap-10 lg:col-start-2 lg:row-start-1 lg:items-stretch">
          {/* the card tilts out and the new one tilts in when the state moves, like the landing's walkthrough */}
          <div className="flex justify-center">
            <Swap id={state}>
              <LiveReceivableCard
                receivableId={cardNumber(cardId)}
                amount={usd(headlineAmount(receivable, onchain))}
                amountValue={dollars(headlineAmount(receivable, onchain))}
                state={STATE_LABEL[state]}
                org={receivable.payerName}
                kind={RECEIVABLE_TYPES[receivable.type].short}
                tone={CARD_TONE[state]}
                moment={CARD_MOMENT[state]}
                scale={0.9}
              />
            </Swap>
          </div>
          <Progress receivable={receivable} onchain={onchain} className="hidden lg:flex" />
        </aside>
        <div className="flex max-w-2xl min-w-0 flex-col gap-10 lg:col-start-1 lg:row-start-1">
          <div className="min-w-0" data-testid="receivable-action" data-state={state}>
            {isSeller ? (
              <SellerActions receivable={receivable} onchain={onchain} />
            ) : isGuarantor ? (
              <GuarantorPanel receivable={receivable} onchain={onchain} state={state} />
            ) : (
              <StatePanel lead={`${STATE_LABEL[state]}.`} description="You can see this as an approver at the business." />
            )}
          </div>
          <Details receivable={receivable} onchain={onchain} receipts={documents.length} />
          {/* on a phone progress comes last, after the details */}
          <Progress receivable={receivable} onchain={onchain} className="border-divider border-t pt-8 lg:hidden" />
        </div>
      </div>
    </>
  );
}

export default function ReceivablePage() {
  return (
    <AccountGate reason="Sign in to see this loan.">
      {(me) => (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <ReceivableDetail me={me} />
        </Suspense>
      )}
    </AccountGate>
  );
}
