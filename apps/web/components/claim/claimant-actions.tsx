"use client";

import type { ClaimView } from "@app/adapters";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Copy } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { CtaLabel } from "@/components/app/cta";
import { ErrorNotice, InfoNotice } from "@/components/app/notice";
import { cardNumber } from "@/components/brand/claim-card";
import { CountUp, EASE } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useCall } from "@/hooks/use-api";
import { useNowSeconds } from "@/hooks/use-now";
import { ASSET, ledgerReady } from "@/lib/config";
import { friendlyError } from "@/lib/errors";
import { dateFromSeconds, daysFrom, dollars, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { InviteCreated, OffchainClaim } from "@/lib/types";
import { SettlePanel } from "./settle-panel";

/**
 * Where a reimbursement stands, as a plain part of the page: one sentence that leads, a quieter line under it, then the
 * action. No box and no repeated big amount, since the card beside it already shows the number. Shared between
 * the claimant and guarantor views.
 */
export function StatePanel({ lead, description, children }: { lead: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 className="display-type max-w-xl text-2xl leading-snug sm:text-[28px]">{lead}</h2>
        {description ? <p className="text-muted-foreground max-w-xl text-[15px] leading-relaxed">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** A titled part of the page under a thin rule, instead of another card. */
export function PageSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("border-divider flex flex-col gap-4 border-t pt-8", className)}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function ResendInvite({ claim }: { claim: OffchainClaim }) {
  const call = useCall();
  const invite = useMutation({ mutationFn: () => call<InviteCreated>("guarantor-invite", { method: "POST", body: { claimId: claim.id } }) });
  return (
    <div className="space-y-3">
      <Button variant="outline" onClick={() => invite.mutate()} disabled={invite.isPending}>
        {invite.isPending ? "Sending..." : "Send the link again"}
      </Button>
      {invite.data ? (
        <div className="space-y-2">
          <p className="text-sm">{invite.data.emailed ? "We emailed your officer. " : ""}You can also send them this link:</p>
          <div className="border-border bg-surface-muted flex items-center gap-2 rounded-sm border p-2">
            <code className="min-w-0 flex-1 truncate text-xs" data-testid="invite-link">
              {invite.data.inviteUrl}
            </code>
            <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard?.writeText(invite.data.inviteUrl)}>
              <Copy /> Copy
            </Button>
          </div>
        </div>
      ) : null}
      {invite.isError ? <ErrorNotice>{friendlyError(invite.error)}</ErrorNotice> : null}
    </div>
  );
}

/** A claim step for the claimant (submit, cancel), sent to `claim-actions`. */
function useClaimAction(claim: OffchainClaim) {
  const call = useCall();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: "submit" | "cancel") => call("claim-actions", { method: "POST", body: { action, claimId: claim.id } }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

function SubmitClaim({ claim }: { claim: OffchainClaim }) {
  const action = useClaimAction(claim);
  return (
    <div className="space-y-3">
      <Button size="lg" onClick={() => action.mutate("submit")} disabled={action.isPending} data-testid="submit-claim">
        {action.isPending ? "Sending..." : "Submit for review"}
      </Button>
      {action.isError ? <ErrorNotice>{friendlyError(action.error)}</ErrorNotice> : null}
    </div>
  );
}

function ReportOutcome({ claim, onchain }: { claim: OffchainClaim; onchain: ClaimView }) {
  const call = useCall();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<"rejected" | "short_paid">("rejected");
  const [note, setNote] = useState("");
  const report = useMutation({
    mutationFn: () =>
      call("claim-actions", { method: "POST", body: { action: "report-outcome", claimId: claim.id, outcome, note: note.trim() || undefined } }),
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["claim", claim.id] });
    },
  });
  if (claim.asucOutcome !== "none") {
    return (
      <InfoNotice title={claim.asucOutcome === "rejected" ? "You reported ASUC rejected this" : "You reported ASUC paid less"}>
        A reviewer will follow up. Your guarantor may be asked to pay what&apos;s left.
      </InfoNotice>
    );
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" data-testid="report-outcome" className="group flex w-full items-center justify-between gap-3 py-1 text-left">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-foreground text-[15px] font-semibold">Report an ASUC problem</span>
            <span className="text-muted-foreground text-xs">If ASUC rejected it or paid you less</span>
          </span>
          <span aria-hidden className="text-muted-foreground group-hover:text-foreground flex size-8 shrink-0 items-center justify-center transition-colors">
            <ChevronRight className="size-4" />
          </span>
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <p className="text-muted-foreground text-xs font-medium">
            No. {cardNumber(onchain.id)} · {usd(onchain.amountRemaining)} left
          </p>
          <DialogTitle>What did ASUC do?</DialogTitle>
          <DialogDescription>We&apos;ll let a reviewer know. Send the vault whatever ASUC did pay you.</DialogDescription>
        </DialogHeader>
        <RadioGroup value={outcome} onValueChange={(v) => setOutcome(v as "rejected" | "short_paid")} className="grid gap-3 sm:grid-cols-2">
          <div className={cn("rounded-lg border p-4", outcome === "rejected" ? "border-foreground bg-surface-muted" : "border-border")}>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="rejected" id="o-rejected" />
              <Label htmlFor="o-rejected" className="text-sm font-semibold">
                ASUC rejected it
              </Label>
            </div>
            <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">Nothing to send. Your officer covers it.</p>
          </div>
          <div className={cn("rounded-lg border p-4", outcome === "short_paid" ? "border-foreground bg-surface-muted" : "border-border")}>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="short_paid" id="o-short" />
              <Label htmlFor="o-short" className="text-sm font-semibold">
                ASUC paid less than I asked
              </Label>
            </div>
            <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">You send the vault what you got. Your officer covers the rest.</p>
          </div>
        </RadioGroup>
        <div className="space-y-2">
          <Label htmlFor="o-note">Anything the reviewer should know (optional)</Label>
          <Textarea id="o-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </div>
        {report.isError ? <ErrorNotice>{friendlyError(report.error)}</ErrorNotice> : null}
        <DialogFooter>
          <Button onClick={() => report.mutate()} disabled={report.isPending} data-testid="send-report">
            {report.isPending ? "Sending..." : "Send report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProgressBar({ paid, due }: { paid: bigint; due: bigint }) {
  const pct = due > 0n ? Math.min(100, Number((paid * 10_000n) / due) / 100) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="bg-border h-1.5 rounded-full">
        <motion.div
          className="bg-foreground h-1.5 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.9, ease: EASE, delay: 0.2 }}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        {usd(paid)} sent of {usd(due)}
      </p>
    </div>
  );
}

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const formatDollars = (n: number) => USD.format(n);

/** Right after funding succeeds in this session: a check pops in and the amount counts up, then Continue. */
function PaidCelebration({ onchain, onContinue }: { onchain: ClaimView; onContinue: () => void }) {
  return (
    <section className="flex flex-col gap-4">
      <motion.span
        className="bg-foreground text-background flex size-12 items-center justify-center rounded-full"
        initial={{ scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 22 }}
      >
        <Check className="size-5" strokeWidth={2.8} />
      </motion.span>
      <h2 className="display-type text-3xl sm:text-4xl">
        <CountUp value={dollars(onchain.amountRemaining)} format={formatDollars} /> is in your wallet
      </h2>
      <p className="text-muted-foreground max-w-lg text-[15px] leading-relaxed">
        When ASUC pays you, send {usd(onchain.amountRemaining)} back to the vault by {dateFromSeconds(onchain.dueAt)}.
      </p>
      <div>
        <Button size="lg" className="pr-2" onClick={onContinue}>
          <CtaLabel>Continue</CtaLabel>
        </Button>
      </div>
    </section>
  );
}

/** The one action that fits the claim's state, for the person who sold it (SYSTEM_DESIGN 6.2). */
export function ClaimantActions({ claim, onchain }: { claim: OffchainClaim; onchain: ClaimView | null }) {
  const action = useClaimAction(claim);
  const now = useNowSeconds();
  const state = claim.status;
  const [justFunded, setJustFunded] = useState(false);

  const requested = usd(BigInt(claim.requestedAmount));
  if (state === "Draft") {
    if (!claim.packetHash) {
      return (
        <StatePanel lead={`Finish your request to get ${requested} now.`} description="Add your receipts and pick an officer to sign off.">
          <div>
            <Button asChild size="lg">
              <Link href={`/claims/new/?id=${claim.id}`}>Finish your request</Link>
            </Button>
          </div>
        </StatePanel>
      );
    }
    if (!claim.guarantySigned) {
      return (
        <StatePanel lead="Waiting for your officer to sign off." description={`Once they do, you can send it for review and get ${requested}.`}>
          <ResendInvite claim={claim} />
        </StatePanel>
      );
    }
    return (
      <StatePanel lead="Your officer signed off. Send it for review." description={`Reviewers check your receipts and CalLink request before you get ${requested}.`}>
        <SubmitClaim claim={claim} />
      </StatePanel>
    );
  }
  if (!onchain) return <p className="text-muted-foreground text-sm">Loading the latest status...</p>;

  if (state === "Submitted") {
    return (
      <StatePanel
        lead="B@B underwriters are checking your receipts and CalLink request."
        description="Most are reviewed within a day, and we'll email you when it's approved."
      >
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={action.isPending}
            onClick={() => action.mutate("cancel")}
            data-testid="cancel-claim"
          >
            Cancel this request
          </Button>
        </div>
        {action.isError ? <ErrorNotice>{friendlyError(action.error)}</ErrorNotice> : null}
      </StatePanel>
    );
  }
  if (state === "Approved") {
    const days = daysFrom(onchain.approvalExpiresAt, now * 1000);
    return (
      <StatePanel
        lead={`You're approved for ${usd(onchain.approvedAmount)}.`}
        description={`Collect it by ${dateFromSeconds(onchain.approvalExpiresAt)}. ${days} ${days === 1 ? "day" : "days"} left.`}
      >
        {/* funding is an XLS-66 loan from the vault; it switches on once the ledger setup has run */}
        <div className="flex flex-col gap-3">
          <Button size="lg" className="pr-2 self-start" disabled data-testid="get-paid">
            <CtaLabel>{`Get paid ${usd(onchain.approvedAmount)} in ${ASSET}`}</CtaLabel>
          </Button>
          <InfoNotice title={ledgerReady ? "Funding is coming soon" : "The lending vault isn't set up yet"}>
            Payouts come from the XRPL lending vault. You&apos;ll be able to collect here once it&apos;s live.
          </InfoNotice>
        </div>
        <div>
          <Button variant="outline" size="sm" disabled={action.isPending} onClick={() => action.mutate("cancel")} data-testid="cancel-claim">
            Cancel this request
          </Button>
        </div>
      </StatePanel>
    );
  }
  if (state === "Funded") {
    return (
      <div className="flex flex-col gap-10">
        {/* right after getting paid the celebration takes the lead's place; Continue brings it back */}
        {justFunded ? (
          <PaidCelebration onchain={onchain} onContinue={() => setJustFunded(false)} />
        ) : (
          <StatePanel lead={`Send ${usd(onchain.amountRemaining)} back to the vault when ASUC pays you.`} description={`By ${dateFromSeconds(onchain.dueAt)}.`}>
            <ProgressBar paid={onchain.amountPaid} due={onchain.amountDue} />
          </StatePanel>
        )}
        <PageSection title="Send it back">
          <SettlePanel onchain={onchain} />
        </PageSection>
        <div className="border-divider divide-divider flex flex-col divide-y border-t [&>*]:py-4">
          <ReportOutcome claim={claim} onchain={onchain} />
        </div>
      </div>
    );
  }
  if (state === "GuarantorCalled" || state === "WrittenOff") {
    return (
      <div className="flex flex-col gap-10">
        <StatePanel
          lead={state === "GuarantorCalled" ? "Your officer was asked to cover what's left." : "This was written off."}
          description={`You can still send the ${usd(onchain.amountRemaining)} yourself.`}
        />
        <PageSection title="Send it back">
          <SettlePanel onchain={onchain} />
        </PageSection>
      </div>
    );
  }
  if (state === "Settled" || state === "Recovered") {
    return <StatePanel lead="All closed out. Thank you." description={`${usd(onchain.amountDue)} went back to the vault, so nothing's left.`} />;
  }
  return (
    <StatePanel
      lead={state === "Rejected" ? "This wasn't approved." : "You cancelled this request."}
      description="Nothing was paid, so there's nothing to send."
    >
      <div>
        <Button asChild size="lg">
          <Link href="/claims/new/">Start a new one</Link>
        </Button>
      </div>
    </StatePanel>
  );
}
