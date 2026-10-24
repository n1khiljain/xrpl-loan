"use client";

import { claimRegistryAbi } from "@app/abi";
import type { ClaimView, OrgExposure } from "@app/adapters";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { encodeFunctionData, stringToHex } from "viem";
import { AdminShell } from "@/components/admin/admin-shell";
import { ReceiptLink } from "@/components/admin/receipt-link";
import { ErrorNotice, InfoNotice } from "@/components/app/notice";
import { GradientPanel } from "@/components/app/gradient-panel";
import { Money } from "@/components/app/money";
import { SafeAction } from "@/components/app/safe-action";
import { StateChip } from "@/components/app/state-chip";
import { StatusText, kycTone } from "@/components/admin/status-text";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCall } from "@/hooks/use-api";
import { useNowSeconds } from "@/hooks/use-now";
import { roleSafe, useHoldsRole } from "@/hooks/use-roles";
import { chainReader } from "@/lib/chain";
import { deployedContracts } from "@/lib/config";
import { parseUsd, shortAddress, usd, weiToInput } from "@/lib/format";
import { REJECT_REASONS } from "@/lib/admin";
import type { ClaimWithDocuments, OffchainClaim, PersonView } from "@/lib/types";
import { cn } from "@/lib/utils";

type QueueItem = { onchain: ClaimView; offchain: OffchainClaim | null };

function useQueue() {
  const call = useCall();
  return useQuery({
    queryKey: ["admin-queue"],
    queryFn: async () => {
      const reader = chainReader();
      if (!reader) return null;
      const [submitted, { claims }, exposure, stats] = await Promise.all([
        reader.listClaims({ states: ["Submitted"] }),
        call<{ claims: OffchainClaim[] }>("claims", { query: { scope: "all" } }),
        reader.getOrgExposure(),
        reader.getPoolStats(),
      ]);
      const byHash = new Map(claims.filter((c) => c.packetHash).map((c) => [c.packetHash!.toLowerCase(), c]));
      const items: QueueItem[] = submitted.map((onchain) => ({ onchain, offchain: byHash.get(onchain.packetHash.toLowerCase()) ?? null }));
      const wallets = [...new Set(items.flatMap((i) => [i.onchain.recipient, i.onchain.guarantor]))];
      const people = wallets.length
        ? (await call<{ people: PersonView[] }>("directory", { query: { view: "people", wallets: wallets.join(",") } })).people
        : [];
      return { items, exposure, idleCash: stats.idleCash, people: new Map(people.map((p) => [p.wallet.toLowerCase(), p])) };
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
  idleCash,
  people,
  highlighted,
}: {
  item: QueueItem;
  exposure: OrgExposure | undefined;
  idleCash: bigint;
  people: Map<string, PersonView>;
  highlighted: boolean;
}) {
  const deployed = deployedContracts();
  const holds = useHoldsRole("underwriter");
  const call = useCall();
  const { onchain, offchain } = item;
  const [amount, setAmount] = useState(weiToInput(onchain.requestedAmount));
  const [reason, setReason] = useState<string>("MISSING_RECEIPTS");
  const docs = useQuery({
    queryKey: ["claim", offchain?.id],
    enabled: Boolean(offchain),
    queryFn: () => call<ClaimWithDocuments>("claims", { query: { id: offchain!.id } }),
  });
  if (!deployed) return null;
  const approveWei = parseUsd(amount);
  const approveTx = approveWei
    ? [{ to: deployed.claimRegistry, value: 0n, label: "Approve claim", data: encodeFunctionData({ abi: claimRegistryAbi, functionName: "approveClaim", args: [onchain.id, approveWei] }) }]
    : [];
  const rejectTx = [
    {
      to: deployed.claimRegistry,
      value: 0n,
      label: "Reject",
      data: encodeFunctionData({ abi: claimRegistryAbi, functionName: "rejectClaim", args: [onchain.id, stringToHex(reason, { size: 32 })] }),
    },
  ];
  const overCap = exposure && approveWei ? exposure.outstanding + approveWei > exposure.cap : false;
  const claimant = people.get(onchain.recipient.toLowerCase());
  const guarantor = people.get(onchain.guarantor.toLowerCase());
  const documents = docs.data?.documents ?? [];
  // the member and the officer both need FraxNet verification before Frax buys the claim (U-24, U-77)
  const kycReady = claimant?.kycStatus === "approved" && guarantor?.kycStatus === "approved";

  return (
    <Card
      id={`review-${onchain.id}`}
      data-testid={`review-${onchain.id}`}
      className={cn("scroll-mt-24 gap-0 overflow-hidden p-0 transition-shadow", highlighted && "ring-2 ring-foreground/50 ring-offset-2 ring-offset-background")}
    >
      <GradientPanel tone="panel" className="flex flex-col gap-2 rounded-none p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-on-ink/70 truncate text-[13px]">
              Reimbursement {onchain.id.toString()} · {exposure?.name ?? `Org ${onchain.orgId}`}
              {claimant?.displayName ? ` · ${claimant.displayName}` : ""}
            </span>
            <Money wei={onchain.requestedAmount} size="lg" />
            {offchain?.description ? <p className="text-on-ink/80 max-w-md text-sm leading-snug">{offchain.description}</p> : null}
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
              <span className="text-muted-foreground">CalLink request</span>
              <span className="font-semibold">{offchain?.callinkPrNumber ?? "not found offchain"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Face value</span>
              <span className="tabular font-semibold">{usd(onchain.faceValue)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Member wallet</span>
              <span className="font-mono text-xs">{shortAddress(onchain.recipient)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Packet</span>
              <span className="font-mono text-xs">{onchain.packetHash.slice(0, 10)}…</span>
            </div>
          </div>
          <div className="border-border divide-divider flex flex-col divide-y rounded-md border px-4">
            <Kyc person={claimant} role="Member" />
            <Kyc person={guarantor} role="Officer" />
            {offchain ? (
              <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="text-muted-foreground">Officer sign-off</span>
                <StatusText tone={offchain.guarantySigned ? "success" : "warning"}>{offchain.guarantySigned ? "Signed" : "Not signed"}</StatusText>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="text-muted-foreground">Org exposure</span>
              <span className="tabular font-semibold">
                {usd(exposure?.outstanding)} of {usd(exposure?.cap)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="text-muted-foreground">Pool idle cash</span>
              <span className="tabular font-semibold">{usd(idleCash)}</span>
            </div>
          </div>
        </div>
        {!kycReady ? (
          <InfoNotice title="Waiting on FraxNet verification">The member and the officer both need to be verified before this can be approved.</InfoNotice>
        ) : null}
        {overCap ? <InfoNotice title="This would go over the org's cap">Getting paid will fail until others are closed out.</InfoNotice> : null}
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-2.5">
            <Label htmlFor={`amount-${onchain.id}`}>Approve for ($)</Label>
            <Input id={`amount-${onchain.id}`} inputMode="decimal" className="tabular" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <SafeAction
              txs={approveTx}
              name={`Approve reimbursement ${onchain.id}`}
              description={`approveClaim(${onchain.id}, ${usd(approveWei)})`}
              safeAddress={roleSafe("underwriter")}
              directSender={holds.data === true}
              disabled={!approveWei || !kycReady}
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
            <SafeAction
              txs={rejectTx}
              name={`Reject reimbursement ${onchain.id}`}
              description={`rejectClaim(${onchain.id}, ${reason})`}
              safeAddress={roleSafe("underwriter")}
              directSender={holds.data === true}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Every submitted claim renders as a full review card in a scrollable column, with a compact list above (desktop:
 * to the side) for jumping between them. That keeps exactly one `review-{id}` element per claim in the DOM at all
 * times, regardless of which one a signer is looking at, which is what the e2e suite and multi-signer review need.
 */
function Queue() {
  const queue = useQueue();
  const now = useNowSeconds();
  const [selected, setSelected] = useState<string | null>(null);

  if (queue.isPending) return <Skeleton className="h-48 w-full rounded-3xl" />;
  if (queue.isError) return <ErrorNotice>We couldn&apos;t load the queue. Try again in a minute.</ErrorNotice>;
  if (!queue.data || queue.data.items.length === 0) return <InfoNotice title="Nothing to review" />;

  const { items, exposure, idleCash, people } = queue.data;
  const activeId = selected ?? items[0]?.onchain.id.toString() ?? null;

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      <nav aria-label="Waiting for review" className="bg-card shadow-card flex shrink-0 flex-col gap-1 rounded-3xl p-3 lg:sticky lg:top-6 lg:w-80">
        <span className="eyebrow text-muted-foreground px-2.5 pt-1.5 pb-2">Submitted {items.length}</span>
        {items.map(({ onchain, offchain }) => {
          const id = onchain.id.toString();
          const on = id === activeId;
          const org = exposure.find((e) => e.orgId === onchain.orgId)?.name ?? `Org ${onchain.orgId}`;
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
                  {timeAgo(onchain.submittedAt, now)}
                  {offchain?.callinkPrNumber ? ` · ${offchain.callinkPrNumber}` : ""}
                </span>
              </span>
              <span className="tabular shrink-0 text-sm font-bold">{usd(onchain.requestedAmount)}</span>
            </a>
          );
        })}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {items.map((item) => (
          <ReviewCard
            key={item.onchain.id.toString()}
            item={item}
            exposure={exposure.find((e) => e.orgId === item.onchain.orgId)}
            idleCash={idleCash}
            people={people}
            highlighted={item.onchain.id.toString() === activeId}
          />
        ))}
      </div>
    </div>
  );
}

export default function ReviewQueuePage() {
  return <AdminShell title="Review queue">{() => <Queue />}</AdminShell>;
}
