"use client";

import { claimRegistryAbi } from "@app/abi";
import type { ClaimView } from "@app/adapters";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { encodeFunctionData } from "viem";
import { AdminShell } from "@/components/admin/admin-shell";
import { ErrorNotice, InfoNotice } from "@/components/app/notice";
import { Money } from "@/components/app/money";
import { SafeAction } from "@/components/app/safe-action";
import { StateChip } from "@/components/app/state-chip";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCall } from "@/hooks/use-api";
import { useNowSeconds } from "@/hooks/use-now";
import { roleSafe, useHoldsRole } from "@/hooks/use-roles";
import { CALL_REASONS } from "@/lib/admin";
import { chainReader } from "@/lib/chain";
import { deployedContracts } from "@/lib/config";
import { dateFromSeconds, shortAddress, usd } from "@/lib/format";
import type { OffchainClaim } from "@/lib/types";

type Exception = { onchain: ClaimView; offchain: OffchainClaim | null; why: string; suggested: number };

function useExceptions() {
  const call = useCall();
  return useQuery({
    queryKey: ["exceptions"],
    queryFn: async () => {
      const reader = chainReader();
      if (!reader) return [];
      const now = Math.floor(Date.now() / 1000);
      const [onchain, { claims: reported }] = await Promise.all([
        reader.listClaims({ states: ["Funded", "GuarantorCalled"] }),
        call<{ claims: OffchainClaim[] }>("claims", { query: { scope: "reported" } }),
      ]);
      const reportedByHash = new Map(reported.filter((c) => c.packetHash).map((c) => [c.packetHash!.toLowerCase(), c]));
      const out: Exception[] = [];
      for (const c of onchain) {
        const report = reportedByHash.get(c.packetHash.toLowerCase()) ?? null;
        if (c.state === "GuarantorCalled") {
          out.push({ onchain: c, offchain: report, why: now >= c.writeOffEligibleAt ? "Grace period over" : `Grace period ends ${dateFromSeconds(c.writeOffEligibleAt)}`, suggested: 0 });
        } else if (report) {
          out.push({
            onchain: c,
            offchain: report,
            why: report.asucOutcome === "rejected" ? "Member reported ASUC rejected it" : "Member reported ASUC paid less",
            suggested: report.asucOutcome === "rejected" ? 1 : 2,
          });
        } else if (now >= c.dueAt) {
          out.push({ onchain: c, offchain: null, why: `Overdue since ${dateFromSeconds(c.dueAt)}`, suggested: 3 });
        }
      }
      return out;
    },
    refetchInterval: 10_000,
  });
}

/** A quick-scan reason chip, derived from the same fields `why` is built from. */
function tagFor(item: Exception): { label: string; variant: "danger" | "warning" } {
  if (item.onchain.state === "GuarantorCalled") return { label: "Officer asked to cover", variant: "danger" };
  if (item.offchain?.asucOutcome === "rejected") return { label: "ASUC rejected", variant: "danger" };
  if (item.offchain?.asucOutcome === "short_paid") return { label: "Paid less", variant: "warning" };
  return { label: "Overdue", variant: "danger" };
}

function ExceptionCard({ item }: { item: Exception }) {
  const deployed = deployedContracts();
  const holds = useHoldsRole("attester");
  const [reason, setReason] = useState(String(item.suggested || 1));
  const now = useNowSeconds();
  const { onchain } = item;
  if (!deployed) return null;
  const called = onchain.state === "GuarantorCalled";
  const tag = tagFor(item);
  const tx = called
    ? [{ to: deployed.claimRegistry, value: 0n, label: "Write off", data: encodeFunctionData({ abi: claimRegistryAbi, functionName: "writeOff", args: [onchain.id] }) }]
    : [
        {
          to: deployed.claimRegistry,
          value: 0n,
          label: "Ask officer to cover",
          data: encodeFunctionData({ abi: claimRegistryAbi, functionName: "callGuarantor", args: [onchain.id, Number(reason)] }),
        },
      ];
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
            <span className="font-mono text-xs text-muted-foreground">{shortAddress(onchain.recipient)} · officer {shortAddress(onchain.guarantor)}</span>
          </div>
          <Money wei={onchain.amountRemaining} size="sm" className="tabular shrink-0" />
        </div>
        <p className="text-sm">{item.why}</p>
        {item.offchain?.asucOutcomeNote ? <p className="text-muted-foreground text-sm">&ldquo;{item.offchain.asucOutcomeNote}&rdquo;</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          {!called ? (
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger aria-label="Call reason" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CALL_REASONS.map((r) => (
                  <SelectItem key={r.value} value={String(r.value)} disabled={r.value === 3 && now < onchain.dueAt}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <SafeAction
            txs={tx}
            name={called ? `Write off reimbursement ${onchain.id}` : `Ask officer to cover reimbursement ${onchain.id}`}
            description={called ? `writeOff(${onchain.id})` : `callGuarantor(${onchain.id}, ${reason})`}
            safeAddress={roleSafe("attester")}
            directSender={holds.data === true}
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
        ASUC rejected or paid less: call the guarantor any time. Overdue: only after the claim passes its due date. Write off: once the guarantor&apos;s grace period ends.
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
