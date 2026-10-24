"use client";

import { claimRegistryAbi } from "@app/abi";
import type { ClaimView } from "@app/adapters";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Copy } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { CtaLabel } from "@/components/app/cta";
import { Disclosure } from "@/components/app/disclosure";
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
import { contractCall, useSendCalls } from "@/hooks/use-tx";
import { publicClient } from "@/lib/chain";
import { config, deployedContracts, onTestnet } from "@/lib/config";
import { friendlyError } from "@/lib/errors";
import { dateFromSeconds, daysFrom, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { InviteCreated, OffchainClaim } from "@/lib/types";
import { CashOut } from "./cash-out";
import { SettlePanel } from "./settle-panel";

/**
 * Where a reimbursement stands, as a plain part of the page: one sentence that leads, a quieter line under it, then the
 * action. No box and no repeated big amount, since the card beside it already shows the number (U-75). Shared between
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

function SubmitClaim({ claim }: { claim: OffchainClaim }) {
  const deployed = deployedContracts();
  const tx = useSendCalls();
  const now = useNowSeconds();
  const nonce = useQuery({
    queryKey: ["guaranty-nonce", claim.guarantorWallet],
    enabled: Boolean(deployed && claim.guarantorWallet),
    queryFn: () =>
      publicClient.readContract({ address: deployed!.claimRegistry, abi: claimRegistryAbi, functionName: "nonces", args: [claim.guarantorWallet!] }),
  });
  const stale = nonce.data !== undefined && claim.guarantyNonce !== null && nonce.data.toString() !== claim.guarantyNonce;
  const expired = claim.guarantyDeadline !== null && claim.guarantyDeadline < now;

  if (stale || expired) {
    return (
      <div className="space-y-3">
        <InfoNotice title="Your officer needs to sign off again">
          {expired ? "Their signature expired." : "They signed off on another reimbursement since yours."} Send them the link again.
        </InfoNotice>
        <ResendInvite claim={claim} />
      </div>
    );
  }

  async function submit() {
    if (!deployed || !claim.packetHash || !claim.guarantorWallet || !claim.guarantySignature || !claim.guarantyDeadline) return;
    await tx.send(
      [
        contractCall({
          address: deployed.claimRegistry,
          abi: claimRegistryAbi,
          functionName: "submitClaim",
          args: [
            {
              orgId: BigInt(claim.orgId),
              recipientType: claim.recipientType === "member" ? 0 : 1,
              guarantor: claim.guarantorWallet,
              faceValue: BigInt(claim.faceValue),
              requestedAmount: BigInt(claim.requestedAmount),
              packetHash: claim.packetHash,
            },
            BigInt(claim.guarantyDeadline),
            claim.guarantySignature,
          ],
        }),
      ],
      ["Sending it for review"],
    );
  }

  return (
    <div className="space-y-3">
      <Button size="lg" onClick={() => void submit()} disabled={tx.status === "sending"} data-testid="submit-claim">
        {tx.status === "sending" ? "Sending..." : "Submit for review"}
      </Button>
      {tx.error ? <ErrorNotice>{tx.error}</ErrorNotice> : null}
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
    mutationFn: () => call("report-outcome", { method: "POST", body: { claimId: claim.id, outcome, note: note.trim() || undefined } }),
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
            No. {cardNumber(onchain.id)} · {usd(onchain.amountRemaining)} to send
          </p>
          <DialogTitle>What did ASUC do?</DialogTitle>
          <DialogDescription>We&apos;ll let a reviewer know. Send Frax whatever ASUC did pay you.</DialogDescription>
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
            <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">You send Frax what you got. Your officer covers the rest.</p>
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

function SimulatePayout({ claim }: { claim: OffchainClaim }) {
  const call = useCall();
  const queryClient = useQueryClient();
  const payout = useMutation({
    mutationFn: () => call<{ minted: string }>("simulate-payout", { method: "POST", body: { claimId: claim.id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["balance"] }),
  });
  if (!onTestnet || !config.features.simulateAsucPayout) return null;
  return (
    <div className="space-y-2">
      {/* a quiet test tool, not a warning: a dot says it's testnet only (U-75) */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-muted-foreground flex items-center gap-2 text-[13px]">
          <span aria-hidden className="bg-warning size-1.5 rounded-full" />
          Testnet only
        </span>
        <Button variant="outline" size="sm" onClick={() => payout.mutate()} disabled={payout.isPending} data-testid="simulate-payout" className="w-full sm:w-auto">
          {payout.isPending ? "Simulating..." : "Simulate ASUC paying you"}
        </Button>
      </div>
      {payout.data ? <p className="text-muted-foreground text-sm">Testnet: ASUC payout simulated. {usd(payout.data.minted)} added to your wallet.</p> : null}
      {payout.isError ? <ErrorNotice>{friendlyError(payout.error)}</ErrorNotice> : null}
    </div>
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
const dollars = (n: number) => USD.format(n);

/** Right after `purchaseClaim` succeeds in this session: a check pops in and the amount counts up, then Continue. */
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
        <CountUp value={Number(onchain.amountRemaining / 10n ** 16n) / 100} format={dollars} /> is in your wallet
      </h2>
      <p className="text-muted-foreground max-w-lg text-[15px] leading-relaxed">
        When ASUC pays you, come back and send {usd(onchain.amountRemaining)} to Frax by {dateFromSeconds(onchain.dueAt)}.
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
  const deployed = deployedContracts();
  const tx = useSendCalls();
  const now = useNowSeconds();
  const state = onchain && onchain.state !== "None" ? onchain.state : claim.status;
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
  if (!onchain || !deployed) return <p className="text-muted-foreground text-sm">Loading the latest status...</p>;

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
            disabled={tx.status === "sending"}
            onClick={() =>
              void tx.send([contractCall({ address: deployed.claimRegistry, abi: claimRegistryAbi, functionName: "cancelClaim", args: [onchain.id] })], ["Cancelling"])
            }
            data-testid="cancel-claim"
          >
            Cancel this request
          </Button>
        </div>
        {tx.error ? <ErrorNotice>{tx.error}</ErrorNotice> : null}
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
        <div>
          <Button
            size="lg"
            className="pr-2"
            disabled={tx.status === "sending"}
            onClick={async () => {
              const ok = await tx.send([contractCall({ address: deployed.claimRegistry, abi: claimRegistryAbi, functionName: "purchaseClaim", args: [onchain.id] })], ["Getting paid"]);
              if (ok) setJustFunded(true);
            }}
            data-testid="get-paid"
          >
            <CtaLabel>{tx.status === "sending" ? "Paying you..." : `Get paid ${usd(onchain.approvedAmount)}`}</CtaLabel>
          </Button>
        </div>
        {tx.error ? <ErrorNotice>{tx.error}</ErrorNotice> : null}
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
          <StatePanel lead={`Send ${usd(onchain.amountRemaining)} to Frax when ASUC pays you.`} description={`By ${dateFromSeconds(onchain.dueAt)}.`}>
            <ProgressBar paid={onchain.amountPaid} due={onchain.amountDue} />
          </StatePanel>
        )}
        <PageSection title="Send to Frax">
          <SimulatePayout claim={claim} />
          <SettlePanel onchain={onchain} />
        </PageSection>
        <div className="border-divider divide-divider flex flex-col divide-y border-t [&>*]:py-4">
          <Disclosure label="Cash out to your bank" hint="Move what's in your wallet to your bank through FraxNet" testId="open-cash-out">
            <CashOut />
          </Disclosure>
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
        <PageSection title="Send to Frax">
          <SettlePanel onchain={onchain} />
        </PageSection>
      </div>
    );
  }
  if (state === "Settled" || state === "Recovered") {
    return <StatePanel lead="All closed out. Thank you." description={`${usd(onchain.amountDue)} was sent to Frax, so nothing's left.`} />;
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
