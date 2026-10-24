"use client";

import { claimRegistryAbi, receivablesPoolAbi } from "@app/abi";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { encodeFunctionData } from "viem";
import { AdminShell } from "@/components/admin/admin-shell";
import { ErrorNotice } from "@/components/app/notice";
import { SafeAction } from "@/components/app/safe-action";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { roleSafe, useHoldsRole } from "@/hooks/use-roles";
import { publicClient } from "@/lib/chain";
import { deployedContracts } from "@/lib/config";
import { parseUsd, usd, weiToInput } from "@/lib/format";
import { cn } from "@/lib/utils";

type Field = { key: string; label: string; hint: string; kind: "usd" | "bps" | "days" };
const FIELDS: Field[] = [
  { key: "advanceRateBps", label: "Advance rate (bps)", hint: "Share of face value the pool pays", kind: "bps" },
  { key: "feeBps", label: "Fee (bps a year)", hint: "Yearly rate on unpaid principal, accrued every second; free during the pilot", kind: "bps" },
  { key: "perClaimCap", label: "Per-reimbursement cap", hint: "Largest single one", kind: "usd" },
  { key: "perOrgCap", label: "Per-org cap", hint: "Outstanding across one org", kind: "usd" },
  { key: "overdueWindow", label: "Overdue window (days)", hint: "From payout to due date", kind: "days" },
  { key: "approvalExpiry", label: "Approval expiry (days)", hint: "Time to press Get paid", kind: "days" },
  { key: "writeOffGrace", label: "Write-off grace (days)", hint: "After the officer is asked to cover", kind: "days" },
];

type Params = { advanceRateBps: number; feeBps: number; perClaimCap: bigint; perOrgCap: bigint; overdueWindow: number; approvalExpiry: number; writeOffGrace: number };

function show(p: Params, f: Field): string {
  const v = p[f.key as keyof Params];
  if (f.kind === "usd") return usd(v as bigint);
  if (f.kind === "days") return String(Number(v) / 86_400);
  return String(v);
}
function toInput(p: Params, f: Field): string {
  const v = p[f.key as keyof Params];
  return f.kind === "usd" ? weiToInput(v as bigint) : f.kind === "days" ? String(Number(v) / 86_400) : String(v);
}

function Limits() {
  const deployed = deployedContracts();
  const holds = useHoldsRole("admin");
  const current = useQuery({
    queryKey: ["params"],
    enabled: Boolean(deployed),
    queryFn: async () => {
      const [p, cap, allowlist] = await Promise.all([
        publicClient.readContract({ address: deployed!.claimRegistry, abi: claimRegistryAbi, functionName: "params" }),
        publicClient.readContract({ address: deployed!.pool, abi: receivablesPoolAbi, functionName: "depositCap" }),
        publicClient.readContract({ address: deployed!.pool, abi: receivablesPoolAbi, functionName: "allowlistEnabled" }),
      ]);
      return { params: p as Params, cap, allowlist };
    },
  });
  if (!deployed || current.isPending) return <Skeleton className="h-48 w-full rounded-3xl" />;
  if (current.isError) return <ErrorNotice>We couldn&apos;t read the current limits.</ErrorNotice>;
  return <LimitsForm key={JSON.stringify(current.data, (_k, v) => (typeof v === "bigint" ? v.toString() : v))} current={current.data} directSender={holds.data === true} />;
}

function LimitsForm({ current, directSender }: { current: { params: Params; cap: bigint; allowlist: boolean }; directSender: boolean }) {
  const deployed = deployedContracts()!;
  const p = current.params;
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, toInput(p, f)])));
  const [cap, setCap] = useState(() => weiToInput(current.cap));

  const proposed: Params | null = (() => {
    try {
      const num = (k: string) => Number(draft[k]);
      const days = (k: string) => Math.round(Number(draft[k]) * 86_400);
      const perClaimCap = parseUsd(draft.perClaimCap ?? "");
      const perOrgCap = parseUsd(draft.perOrgCap ?? "");
      if (perClaimCap === null || perOrgCap === null) return null;
      const next = {
        advanceRateBps: num("advanceRateBps"),
        feeBps: num("feeBps"),
        perClaimCap,
        perOrgCap,
        overdueWindow: days("overdueWindow"),
        approvalExpiry: days("approvalExpiry"),
        writeOffGrace: days("writeOffGrace"),
      };
      return Object.values(next).every((v) => (typeof v === "number" ? Number.isFinite(v) && v >= 0 : true)) ? next : null;
    } catch {
      return null;
    }
  })();
  const capWei = parseUsd(cap);
  const txs = proposed
    ? [{ to: deployed.claimRegistry, value: 0n, label: "Set limits", data: encodeFunctionData({ abi: claimRegistryAbi, functionName: "setParams", args: [proposed] }) }]
    : [];
  const changedFields = proposed ? FIELDS.filter((f) => show(proposed, f) !== show(p, f)) : [];
  const capChanged = capWei !== null && capWei !== current.cap;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Limits</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FIELDS.map((f) => {
              const changed = proposed ? show(proposed, f) !== show(p, f) : false;
              return (
                <div key={f.key} className={cn("border-border flex flex-col gap-2.5 rounded-md border p-4", changed && "border-info")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-bold">{f.label}</span>
                    {changed ? <Badge variant="info">Changed</Badge> : null}
                  </div>
                  <Label htmlFor={`field-${f.key}`} className="sr-only">
                    Proposed {f.label}
                  </Label>
                  <div className="flex items-center gap-2">
                    <span className={cn("text-muted-foreground shrink-0 text-[13px]", changed && "line-through")}>{show(p, f)}</span>
                    <Input
                      id={`field-${f.key}`}
                      aria-label={`Proposed ${f.label}`}
                      className="tabular h-10 min-w-0 font-bold"
                      value={draft[f.key] ?? ""}
                      onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                    />
                  </div>
                  <span className="text-muted-foreground text-xs">{f.hint}</span>
                </div>
              );
            })}
          </div>
          <p className="text-muted-foreground text-xs">New limits apply to later approvals and purchases. Reimbursements already paid keep their terms.</p>
          {changedFields.length ? (
            <p className="text-info text-sm font-semibold">
              {changedFields.length} change{changedFields.length === 1 ? "" : "s"} ready · {changedFields.map((f) => f.label).join(" · ")}
            </p>
          ) : null}
          <SafeAction txs={txs} name="Set limits" description="setParams" safeAddress={roleSafe("admin")} directSender={directSender} disabled={!proposed} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Pool deposit cap</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className={cn("border-border flex max-w-xs flex-col gap-2.5 rounded-md border p-4", capChanged && "border-info")}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-bold">Total lender deposits</span>
              {capChanged ? <Badge variant="info">Changed</Badge> : null}
            </div>
            <div className="flex items-center gap-2">
              <span className={cn("text-muted-foreground shrink-0 text-[13px]", capChanged && "line-through")}>{usd(current.cap)}</span>
              <Input aria-label="Proposed deposit cap" className="tabular h-10 min-w-0 font-bold" value={cap} onChange={(e) => setCap(e.target.value)} />
            </div>
          </div>
          <SafeAction
            txs={capWei !== null ? [{ to: deployed.pool, value: 0n, label: "Set deposit cap", data: encodeFunctionData({ abi: receivablesPoolAbi, functionName: "setDepositCap", args: [capWei] }) }] : []}
            name="Set deposit cap"
            description="setDepositCap"
            safeAddress={roleSafe("admin")}
            directSender={directSender}
            disabled={capWei === null}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default function ParamsPage() {
  return <AdminShell title="Parameters">{() => <Limits />}</AdminShell>;
}
