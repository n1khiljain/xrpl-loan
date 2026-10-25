"use client";

import { type ReceivableView, receivableViewFromJson } from "@app/adapters";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { StaffAction } from "@/components/admin/staff-action";
import { ErrorNotice, InfoNotice } from "@/components/app/notice";
import { Money } from "@/components/app/money";
import { StateChip } from "@/components/app/state-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCall } from "@/hooks/use-api";
import { useNowSeconds } from "@/hooks/use-now";
import { CALL_REASONS, type CallReasonValue } from "@/lib/admin";
import { friendlyError } from "@/lib/errors";
import { dateFromSeconds, dateTimeFromSeconds, shortAddress } from "@/lib/format";
import type { OffchainReceivable } from "@/lib/types";

type Exception = { onchain: ReceivableView; offchain: OffchainReceivable; why: string; suggested: CallReasonValue };

function useExceptions() {
  const call = useCall();
  return useQuery({
    queryKey: ["exceptions"],
    queryFn: async () => {
      const now = Math.floor(Date.now() / 1000);
      const { receivables } = await call<{ receivables: OffchainReceivable[] }>("receivables", { query: { scope: "all" } });
      const out: Exception[] = [];
      for (const c of receivables) {
        if (!c.ledger || (c.status !== "Funded" && c.status !== "GuarantorCalled")) continue;
        const onchain = receivableViewFromJson(c.ledger);
        if (c.status === "GuarantorCalled") {
          out.push({ onchain, offchain: c, why: now >= onchain.writeOffEligibleAt ? "Grace period over" : `Grace period ends ${dateFromSeconds(onchain.writeOffEligibleAt)}`, suggested: "overdue" });
        } else if (c.payerOutcome !== "none") {
          out.push({
            onchain,
            offchain: c,
            why: c.payerOutcome === "rejected" ? `Borrower reported ${c.payerName} rejected it` : `Borrower reported ${c.payerName} paid less`,
            suggested: c.payerOutcome === "rejected" ? "payer_rejected" : "partial_shortfall",
          });
        } else if (onchain.dueAt > 0 && now >= onchain.dueAt) {
          out.push({ onchain, offchain: c, why: `Overdue since ${dateTimeFromSeconds(onchain.dueAt)}`, suggested: "overdue" });
        }
      }
      return out;
    },
    refetchInterval: 10_000,
  });
}
/**
 * Missed payments on the ledger. Past the due date, mark the loan impaired (and clear that if the borrower catches
 * up); past the grace period too, default it, which writes it off and draws on the series's first-loss cover. The
 * ledger checks the timing again, so a button pressed too early just says when it can be done.
 */
function MissedPayment({ item, now }: { item: Exception; now: number }) {
  const call = useCall();
  const queryClient = useQueryClient();
  const manage = useMutation({
    mutationFn: (action: "impair" | "unimpair" | "default") => call("loans", { method: "POST", body: { action, receivableId: item.offchain.id } }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  if (!item.offchain.loanId) return null;
  const late = item.onchain.dueAt > 0 && now > item.onchain.dueAt;
  const impaired = Boolean(item.offchain.impairedAt);
  return (
    <div className="border-divider flex flex-col gap-2 border-t pt-3" data-testid="missed-payment">
      <span className="text-muted-foreground text-xs font-medium">
        Missed payment on the ledger{impaired ? " · marked impaired" : late ? " · payment is late" : ` · due ${dateTimeFromSeconds(item.onchain.dueAt)}`}
      </span>
      <div className="flex flex-wrap gap-2">
        {impaired ? (
          <Button size="sm" variant="outline" disabled={manage.isPending} onClick={() => manage.mutate("unimpair")}>
            Clear impairment
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={manage.isPending || !late} onClick={() => manage.mutate("impair")} data-testid="impair-loan">
            Mark payment missed
          </Button>
        )}
        <Button size="sm" variant="destructive" disabled={manage.isPending || !late} onClick={() => manage.mutate("default")} data-testid="default-loan">
          Default the loan
        </Button>
      </div>
      {manage.isError ? <ErrorNotice>{friendlyError(manage.error)}</ErrorNotice> : null}
    </div>
  );
}

/** A quick-scan reason chip, derived from the same fields `why` is built from. */
function tagFor(item: Exception): { label: string; variant: "danger" | "warning" } {
  if (item.offchain.impairedAt) return { label: "Payment missed", variant: "danger" };
  if (item.onchain.state === "GuarantorCalled") return { label: "Approver asked to cover", variant: "danger" };
  if (item.offchain?.payerOutcome === "rejected") return { label: "Payer rejected", variant: "danger" };
  if (item.offchain?.payerOutcome === "short_paid") return { label: "Paid less", variant: "warning" };
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
            <span className="font-mono text-xs text-muted-foreground">
              {shortAddress(onchain.recipient)}
              {onchain.guarantor ? ` · approver ${shortAddress(onchain.guarantor)}` : ` · ${item.offchain.payerName}`}
            </span>
          </div>
          <Money units={onchain.amountRemaining} size="sm" className="tabular shrink-0" />
        </div>
        <p className="text-sm">{item.why}</p>
        {item.offchain.payerOutcomeNote ? <p className="text-muted-foreground text-sm">&ldquo;{item.offchain.payerOutcomeNote}&rdquo;</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          {!called && onchain.guarantor ? (
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
          {called || onchain.guarantor ? <StaffAction
            label={called ? "Write off" : "Ask approver to cover"}
            body={called ? { action: "write-off", receivableId: item.offchain.id } : { action: "call-guarantor", receivableId: item.offchain.id, reason }}
            disabled={called && now < onchain.writeOffEligibleAt}
          /> : null}
        </div>
        <MissedPayment item={item} now={now} />
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
        The payer rejected it or paid less: call the approver any time. Overdue: only after the loan passes its due date. Write off: once the approver&apos;s grace period ends. Mark a payment missed once the due date passes; default the loan after the ledger&apos;s grace period too.
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
