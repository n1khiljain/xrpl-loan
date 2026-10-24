"use client";

import { type ClaimView, claimViewFromJson } from "@app/adapters";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { StaffAction } from "@/components/admin/staff-action";
import { ErrorNotice, InfoNotice } from "@/components/app/notice";
import { Money } from "@/components/app/money";
import { StateChip } from "@/components/app/state-chip";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCall } from "@/hooks/use-api";
import { useNowSeconds } from "@/hooks/use-now";
import { CALL_REASONS, type CallReasonValue } from "@/lib/admin";
import { dateFromSeconds, shortAddress } from "@/lib/format";
import type { OffchainClaim } from "@/lib/types";

type Exception = { onchain: ClaimView; offchain: OffchainClaim; why: string; suggested: CallReasonValue };

function useExceptions() {
  const call = useCall();
  return useQuery({
    queryKey: ["exceptions"],
    queryFn: async () => {
      const now = Math.floor(Date.now() / 1000);
      const { claims } = await call<{ claims: OffchainClaim[] }>("claims", { query: { scope: "all" } });
      const out: Exception[] = [];
      for (const c of claims) {
        if (!c.ledger || (c.status !== "Funded" && c.status !== "GuarantorCalled")) continue;
        const onchain = claimViewFromJson(c.ledger);
        if (c.status === "GuarantorCalled") {
          out.push({ onchain, offchain: c, why: now >= onchain.writeOffEligibleAt ? "Grace period over" : `Grace period ends ${dateFromSeconds(onchain.writeOffEligibleAt)}`, suggested: "overdue" });
        } else if (c.asucOutcome !== "none") {
          out.push({
            onchain,
            offchain: c,
            why: c.asucOutcome === "rejected" ? "Borrower reported the payer rejected it" : "Borrower reported the payer paid less",
            suggested: c.asucOutcome === "rejected" ? "asuc_rejected" : "partial_shortfall",
          });
        } else if (onchain.dueAt > 0 && now >= onchain.dueAt) {
          out.push({ onchain, offchain: c, why: `Overdue since ${dateFromSeconds(onchain.dueAt)}`, suggested: "overdue" });
        }
      }
      return out;
    },
    refetchInterval: 10_000,
  });
}
/** A quick-scan reason chip, derived from the same fields `why` is built from. */
function tagFor(item: Exception): { label: string; variant: "danger" | "warning" } {
  if (item.onchain.state === "GuarantorCalled") return { label: "Approver asked to cover", variant: "danger" };
  if (item.offchain?.asucOutcome === "rejected") return { label: "Payer rejected", variant: "danger" };
  if (item.offchain?.asucOutcome === "short_paid") return { label: "Paid less", variant: "warning" };
  return { label: "Overdue", variant: "danger" };
}

function ExceptionCard({ item }: { item: Exception }) {
  const [reason, setReason] = useState<CallReasonValue>(item.suggested);
  const now = useNowSeconds();
  const { onchain } = item;
  const called = onchain.state === "GuarantorCalled";
  const tag = tagFor(item);
  return (
    <Card data-testid={`exception-${onchain.id}`} className="gap-3.5">
      <CardContent className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-muted-foreground font-mono text-xs">#{onchain.id.toString()}</span>
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant={tag.variant}>{tag.label}</Badge>
              <StateChip state={onchain.state as "Funded" | "GuarantorCalled"} />
            </span>
            <span className="font-mono text-xs text-muted-foreground">{shortAddress(onchain.recipient)} · approver {shortAddress(onchain.guarantor)}</span>
          </div>
          <Money units={onchain.amountRemaining} size="sm" className="tabular shrink-0" />
        </div>
        <p className="text-sm">{item.why}</p>
        {item.offchain.asucOutcomeNote ? <p className="text-muted-foreground text-sm">&ldquo;{item.offchain.asucOutcomeNote}&rdquo;</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          {!called ? (
            <Select value={reason} onValueChange={(v) => setReason(v as CallReasonValue)}>
              <SelectTrigger aria-label="Call reason" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CALL_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value} disabled={r.value === "overdue" && now < onchain.dueAt}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <StaffAction
            label={called ? "Write off" : "Ask approver to cover"}
            body={called ? { action: "write-off", claimId: item.offchain.id } : { action: "call-guarantor", claimId: item.offchain.id, reason }}
            disabled={called && now < onchain.writeOffEligibleAt}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Exceptions() {
  const list = useExceptions();
  if (list.isPending) return <Skeleton className="h-48 w-full rounded-3xl" />;
  if (list.isError) return <ErrorNotice>We couldn&apos;t load exceptions. Try again in a minute.</ErrorNotice>;
  if (list.data.length === 0) return <InfoNotice title="No exceptions" />;
  return (
    <div className="flex flex-col gap-5">
      <div className="bg-info-soft text-info rounded-md px-4 py-3 text-[13px] font-semibold">
        The payer rejected it or paid less: call the approver any time. Overdue: only after the loan passes its due date. Write off: once the approver&apos;s grace period ends.
      </div>
      <div className="flex flex-col gap-4">
        {list.data.map((item) => (
          <ExceptionCard key={item.onchain.id.toString()} item={item} />
        ))}
      </div>
    </div>
  );
}

export default function ExceptionsPage() {
  return <AdminShell title="Exceptions">{() => <Exceptions />}</AdminShell>;
}
