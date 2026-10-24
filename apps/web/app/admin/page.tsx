"use client";

import { type ReceivableView, receivableViewFromJson } from "@app/adapters";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { ReceiptLink } from "@/components/admin/receipt-link";
import { StaffAction } from "@/components/admin/staff-action";
import { StatusText, kycTone } from "@/components/admin/status-text";
import { ErrorNotice, InfoNotice } from "@/components/app/notice";
import { GradientPanel } from "@/components/app/gradient-panel";
import { Money } from "@/components/app/money";
import { StateChip } from "@/components/app/state-chip";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCall, useOrgs } from "@/hooks/use-api";
import { useNowSeconds } from "@/hooks/use-now";
import { REJECT_REASONS } from "@/lib/admin";
import { config } from "@/lib/config";
import { parseUsd, shortAddress, unitsToInput, usd } from "@/lib/format";
import type { ReceivableWithDocuments, OffchainReceivable, PersonView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { RECEIVABLE_TYPES } from "@/lib/receivable-types";

type QueueItem = { ledger: ReceivableView; receivable: OffchainReceivable };
type Exposure = { orgId: number; name: string; outstanding: bigint; cap: bigint };

const OUTSTANDING = new Set(["Funded", "GuarantorCalled", "WrittenOff"]);

function useQueue() {
  const call = useCall();
  const orgs = useOrgs();
  return useQuery({
    queryKey: ["admin-queue", orgs.data?.length],
    enabled: orgs.isSuccess,
    queryFn: async () => {
      const { receivables } = await call<{ receivables: OffchainReceivable[] }>("receivables", { query: { scope: "all" } });
      const items: QueueItem[] = receivables
        .filter((c) => c.status === "Submitted" && c.ledger)
        .map((receivable) => ({ receivable, ledger: receivableViewFromJson(receivable.ledger!) }))
        .sort((a, b) => a.ledger.submittedAt - b.ledger.submittedAt);
      const cap = BigInt(config.params.perOrgCap);
      const exposure: Exposure[] = (orgs.data ?? []).map((o) => ({
        orgId: o.id,
        name: o.name,
        cap,
        outstanding: receivables
          .filter((c) => c.orgId === o.id && OUTSTANDING.has(c.status) && c.ledger)
          .reduce((sum, c) => sum + BigInt(c.ledger!.amountRemaining), 0n),
      }));
      const wallets = [...new Set(items.flatMap((i) => [i.receivable.recipientWallet, i.receivable.guarantorWallet].filter(Boolean)))] as string[];
      const people = wallets.length
        ? (await call<{ people: PersonView[] }>("directory", { query: { view: "people", wallets: wallets.join(",") } })).people
        : [];
      return { items, exposure, people: new Map(people.map((p) => [p.wallet, p])) };
    },
    refetchInterval: 10_000,
  });
}

/** How long ago a unix timestamp was, for the queue's compact list. */
function timeAgo(seconds: number, now: number): string {
  const diff = Math.max(0, now - seconds);
  if (diff < 60) return "just now";
  if (diff < 3_600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.round(diff / 3_600)}h ago`;
  return `${Math.round(diff / 86_400)}d ago`;
}

function Kyc({ person, role }: { person: PersonView | undefined; role: string }) {
  const status = person?.kycStatus ?? "not_started";
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <span className="text-muted-foreground">
        {role} KYC <span className="text-foreground font-semibold">{person?.displayName ?? "No name"}</span>
      </span>
      <StatusText tone={kycTone(status)} data-testid={`kyc-${role.toLowerCase()}`}>
        KYC {status.replace("_", " ")}
      </StatusText>
    </div>
  );
}

function ReviewCard({
  item,
  exposure,
  people,
  highlighted,
}: {
  item: QueueItem;
  exposure: Exposure | undefined;
  people: Map<string, PersonView>;
  highlighted: boolean;
}) {
  const call = useCall();
  const { ledger, receivable } = item;
  const [amount, setAmount] = useState(unitsToInput(ledger.requestedAmount));
  const [reason, setReason] = useState<string>("MISSING_RECEIPTS");
  const docs = useQuery({
    queryKey: ["receivable", receivable.id],
    queryFn: () => call<ReceivableWithDocuments>("receivables", { query: { id: receivable.id } }),
  });
  const approveUnits = parseUsd(amount);
  const overCap = exposure && approveUnits ? exposure.outstanding + approveUnits > exposure.cap : false;
  const seller = people.get(receivable.recipientWallet);
  const guarantor = receivable.guarantorWallet ? people.get(receivable.guarantorWallet) : undefined;
  const documents = docs.data?.documents ?? [];
  // the seller, and the officer when there is one, need verification before the receivable is funded
  const kycReady = seller?.kycStatus === "approved" && (!receivable.guarantorWallet || guarantor?.kycStatus === "approved");
  const number = ledger.id.toString();

  return (
    <Card
      id={`review-${number}`}
      data-testid={`review-${number}`}
      className={cn("scroll-mt-24 gap-0 overflow-hidden p-0 transition-shadow", highlighted && "ring-2 ring-foreground/50 ring-offset-2 ring-offset-background")}
    >
      <GradientPanel tone="panel" className="flex flex-col gap-2 rounded-none p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-on-ink/70 truncate text-[13px]">
              {RECEIVABLE_TYPES[receivable.type].short} {number} · {receivable.payerName}{exposure ? ` · ${exposure.name}` : ""}
              {seller?.displayName ? ` · ${seller.displayName}` : ""}
            </span>
            <Money units={ledger.requestedAmount} size="lg" />
            {receivable.description ? <p className="text-on-ink/80 max-w-md text-sm leading-snug">{receivable.description}</p> : null}
          </div>
          <StateChip state="Submitted" className="text-on-ink shrink-0" />
        </div>
      </GradientPanel>
      <CardContent className="flex flex-col gap-5 pt-5">
        {documents.length ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {documents.map((d, i) => (
              <ReceiptLink key={d.id} documentId={d.id} index={i} />
            ))}
          </div>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="bg-surface-muted flex flex-col gap-2.5 rounded-md p-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{RECEIVABLE_TYPES[receivable.type].referenceLabel}</span>
              <span className="font-semibold">{receivable.reference}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Face value</span>
              <span className="tabular font-semibold">{usd(ledger.faceValue)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Borrower wallet</span>
              <span className="font-mono text-xs">{shortAddress(receivable.recipientWallet)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Packet</span>
              <span className="font-mono text-xs">{ledger.packetHash.slice(0, 10)}…</span>
            </div>
          </div>
          <div className="border-border divide-divider flex flex-col divide-y rounded-md border px-4">
            <Kyc person={seller} role="Borrower" />
            {receivable.guarantorWallet ? (
              <>
                <Kyc person={guarantor} role="Approver" />
                <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="text-muted-foreground">Approver sign-off</span>
                  <StatusText tone={receivable.guarantySigned ? "success" : "warning"}>{receivable.guarantySigned ? "Signed" : "Not signed"}</StatusText>
                </div>
              </>
            ) : null}
            <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="text-muted-foreground">Payer pays by</span>
              <span className="font-semibold">{new Date(`${receivable.dueDate}T12:00:00`).toLocaleDateString("en-US", { dateStyle: "medium" })}</span>
            </div>
            {exposure ? (
              <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="text-muted-foreground">Business exposure</span>
                <span className="tabular font-semibold">
                  {usd(exposure.outstanding)} of {usd(exposure.cap)}
                </span>
              </div>
            ) : null}
          </div>
        </div>
        {!kycReady ? (
          <InfoNotice title="Waiting on verification">The borrower{receivable.guarantorWallet ? " and the approver" : ""} need to be verified before this can be approved.</InfoNotice>
        ) : null}
        {overCap ? <InfoNotice title="This would go over the business's cap">Funding will fail until others are closed out.</InfoNotice> : null}
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-2.5">
            <Label htmlFor={`amount-${number}`}>Approve for ($)</Label>
            <Input id={`amount-${number}`} inputMode="decimal" className="tabular" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <StaffAction
              label={`Approve ${approveUnits ? usd(approveUnits) : ""}`}
              body={approveUnits ? { action: "approve", receivableId: receivable.id, amount: approveUnits.toString() } : null}
              disabled={!kycReady}
              testId={`approve-${number}`}
            />
          </div>
          <div className="space-y-2.5">
            <Label>Reject with a reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger aria-label="Reject reason" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REJECT_REASONS.map((r) => (
                  <SelectItem key={r.code} value={r.code}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <StaffAction label="Reject" variant="outline" body={{ action: "reject", receivableId: receivable.id, reason }} testId={`reject-${number}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Every submitted receivable renders as a full review card in a scrollable column, with a compact list above (desktop:
 * to the side) for jumping between them.
 */
function Queue() {
  const queue = useQueue();
  const now = useNowSeconds();
  const [selected, setSelected] = useState<string | null>(null);

  if (queue.isPending) return <Skeleton className="h-48 w-full rounded-3xl" />;
  if (queue.isError) return <ErrorNotice>We couldn&apos;t load the queue. Try again in a minute.</ErrorNotice>;
  if (queue.data.items.length === 0) return <InfoNotice title="Nothing to review" />;

  const { items, exposure, people } = queue.data;
  const activeId = selected ?? items[0]?.ledger.id.toString() ?? null;

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      <nav aria-label="Waiting for review" className="bg-card shadow-card flex shrink-0 flex-col gap-1 rounded-3xl p-3 lg:sticky lg:top-6 lg:w-80">
        <span className="eyebrow text-muted-foreground px-2.5 pt-1.5 pb-2">Submitted {items.length}</span>
        {items.map(({ ledger, receivable }) => {
          const id = ledger.id.toString();
          const on = id === activeId;
          const org = receivable.payerName;
          return (
            <a
              key={id}
              href={`#review-${id}`}
              onClick={() => setSelected(id)}
              className={cn("flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm", on ? "border-foreground bg-surface" : "border-transparent hover:bg-surface-muted")}
            >
              <span className="bg-surface-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-sm font-mono text-[11px]">#{id}</span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-bold">{org}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {timeAgo(ledger.submittedAt, now)} · {receivable.reference}
                </span>
              </span>
              <span className="tabular shrink-0 text-sm font-bold">{usd(ledger.requestedAmount)}</span>
            </a>
          );
        })}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {items.map((item) => (
          <ReviewCard
            key={item.receivable.id}
            item={item}
            exposure={exposure.find((e) => e.orgId === item.receivable.orgId)}
            people={people}
            highlighted={item.ledger.id.toString() === activeId}
          />
        ))}
      </div>
    </div>
  );
}

export default function ReviewQueuePage() {
  return <AdminShell title="Review queue">{() => <Queue />}</AdminShell>;
}
