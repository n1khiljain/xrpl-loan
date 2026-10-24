"use client";

import type { ClaimView } from "@app/adapters";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AccountGate } from "@/components/app/account-gate";
import { ErrorNotice } from "@/components/app/notice";
import { CARD_MOMENT, CARD_TONE, STATE_LABEL, type DisplayState } from "@/components/app/state-chip";
import { Timeline } from "@/components/app/timeline";
import { Topbar } from "@/components/app/topbar";
import { cardNumber } from "@/components/brand/claim-card";
import { LiveClaimCard } from "@/components/brand/live-claim-card";
import { ClaimantActions, PageSection, StatePanel } from "@/components/claim/claimant-actions";
import { Swap } from "@/components/motion";
import { SettlePanel } from "@/components/claim/settle-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrgs } from "@/hooks/use-api";
import { useClaimRecord } from "@/hooks/use-claim";
import { displayState, timeline } from "@/lib/claim-record";
import { friendlyError } from "@/lib/errors";
import { dollars, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MeResponse, OffchainClaim } from "@/lib/types";

const TITLES: Partial<Record<DisplayState, string>> = {
  Draft: "Your reimbursement",
  Submitted: "In review",
  Approved: "Approved",
  Funded: "You got paid",
  GuarantorCalled: "Officer asked to cover",
  WrittenOff: "Written off",
  Settled: "Closed out",
  Recovered: "Closed out",
  Rejected: "Not approved",
  Cancelled: "Cancelled",
};

/** The amount this claim's card and hero lead with: what's left once purchased, what was approved, else what was asked for. */
function headlineAmount(claim: OffchainClaim, onchain: ClaimView | null): bigint {
  if (!onchain) return BigInt(claim.requestedAmount);
  // a closed-out card shows what it was for, not the $0.00 left
  if (onchain.state === "Settled" || onchain.state === "Recovered") return onchain.amountDue;
  if (onchain.purchasedAt > 0) return onchain.amountRemaining;
  if (onchain.state === "Approved") return onchain.approvedAmount;
  return onchain.requestedAmount;
}

/** The guarantor's own view of the claim: what they owe, or that nothing is owed yet (SYSTEM_DESIGN 6.2). */
function GuarantorPanel({ claim, onchain, state }: { claim: OffchainClaim; onchain: ClaimView | null; state: DisplayState }) {
  if (state === "GuarantorCalled" || state === "WrittenOff") {
    if (!onchain) return null;
    return (
      <div className="flex flex-col gap-10">
        <StatePanel lead={`Cover the ${usd(onchain.amountRemaining)} that's left.`} description="You signed off, so you cover what's left." />
        <PageSection title="Send it back">
          <SettlePanel onchain={onchain} />
        </PageSection>
      </div>
    );
  }
  if (state === "Draft" && !claim.guarantySigned) {
    return <StatePanel lead="This is waiting on your sign-off." description="Check your email for the link to sign off on this." />;
  }
  if (state === "Settled" || state === "Recovered") {
    return <StatePanel lead="Closed out. Nothing for you to cover." description="The reimbursement went back to the vault in full." />;
  }
  return <StatePanel lead="Nothing for you to cover right now." description="We'll email you if that changes." />;
}

/** The facts of the reimbursement as a plain list, so the page reads top to bottom. */
function Details({ claim, onchain, receipts }: { claim: OffchainClaim; onchain: ClaimView | null; receipts: number }) {
  const approved = onchain && onchain.approvedAmount > 0n ? onchain.approvedAmount : null;
  // each number once: the request, then what was approved (or asked for, before approval)
  const rows: Array<[string, string]> = [
    ["What it was for", claim.description ?? "No description"],
    ["CalLink request", claim.callinkPrNumber],
    ["Amount on the request", usd(BigInt(claim.faceValue))],
    approved !== null ? ["Approved for", usd(approved)] : ["Asked for", usd(BigInt(claim.requestedAmount))],
  ];
  if (claim.recipientType === "org_treasurer") rows.push(["Who paid", "The org"]);
  rows.push(["Receipts", `${receipts} ${receipts === 1 ? "file" : "files"}`]);
  return (
    <PageSection title="Details">
      <dl className="divide-divider divide-y text-sm" data-testid="claim-details">
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
function Progress({ claim, onchain, className }: { claim: OffchainClaim; onchain: ClaimView | null; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      <h2 className="text-lg font-semibold">Progress</h2>
      <Timeline steps={timeline(claim, onchain)} />
    </section>
  );
}

function ClaimDetail({ me }: { me: MeResponse }) {
  const id = useSearchParams().get("id");
  const { offchain, onchain } = useClaimRecord(id);
  const orgs = useOrgs();
  if (!id) return <ErrorNotice title="Nothing picked">Open one from your list.</ErrorNotice>;
  if (offchain.isPending) return <Skeleton className="h-64 w-full" />;
  if (offchain.isError) return <ErrorNotice title="We couldn't open this">{friendlyError(offchain.error)}</ErrorNotice>;

  const { claim, documents } = offchain.data;
  const state = displayState(claim, onchain);
  const wallet = me.profile?.wallet;
  const isClaimant = claim.recipientWallet === wallet;
  const isGuarantor = claim.guarantorWallet === wallet;
  const orgName = orgs.data?.find((o) => o.id === claim.orgId)?.name ?? "";
  const cardId = claim.number;
  const calledAsGuarantor = isGuarantor && (state === "GuarantorCalled" || state === "WrittenOff");
  const title = calledAsGuarantor ? "You're asked to cover this" : (TITLES[state] ?? "Reimbursement");
  const fromSignOffs = isGuarantor && !isClaimant;
  const crumb = `No. ${cardNumber(cardId)}`;
  const back = fromSignOffs ? { href: "/claims/?view=guaranties", label: "Sign-offs" } : { href: "/claims/?view=claims", label: "My reimbursements" };

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
              <LiveClaimCard
                claimId={cardNumber(cardId)}
                amount={usd(headlineAmount(claim, onchain))}
                amountValue={dollars(headlineAmount(claim, onchain))}
                state={STATE_LABEL[state]}
                org={orgName}
                tone={CARD_TONE[state]}
                moment={CARD_MOMENT[state]}
                scale={0.9}
              />
            </Swap>
          </div>
          <Progress claim={claim} onchain={onchain} className="hidden lg:flex" />
        </aside>
        <div className="flex max-w-2xl min-w-0 flex-col gap-10 lg:col-start-1 lg:row-start-1">
          <div className="min-w-0" data-testid="claim-action" data-state={state}>
            {isClaimant ? (
              <ClaimantActions claim={claim} onchain={onchain} />
            ) : isGuarantor ? (
              <GuarantorPanel claim={claim} onchain={onchain} state={state} />
            ) : (
              <StatePanel lead={`${STATE_LABEL[state]}.`} description="You can see this as an officer of the org." />
            )}
          </div>
          <Details claim={claim} onchain={onchain} receipts={documents.length} />
          {/* on a phone progress comes last, after the details */}
          <Progress claim={claim} onchain={onchain} className="border-divider border-t pt-8 lg:hidden" />
        </div>
      </div>
    </>
  );
}

export default function ClaimPage() {
  return (
    <AccountGate reason="Sign in to see this reimbursement.">
      {(me) => (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <ClaimDetail me={me} />
        </Suspense>
      )}
    </AccountGate>
  );
}
