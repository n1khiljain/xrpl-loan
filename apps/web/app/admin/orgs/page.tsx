"use client";

import { claimRegistryAbi, orgRegistryAbi } from "@app/abi";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { type Address, encodeFunctionData, isAddress } from "viem";
import { AdminShell } from "@/components/admin/admin-shell";
import { GradientPanel } from "@/components/app/gradient-panel";
import { ErrorNotice } from "@/components/app/notice";
import { SafeAction } from "@/components/app/safe-action";
import { StatusText, kycTone } from "@/components/admin/status-text";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useCall, useOrgs } from "@/hooks/use-api";
import { roleSafe, useHoldsRole } from "@/hooks/use-roles";
import { chainReader } from "@/lib/chain";
import { config, deployedContracts } from "@/lib/config";
import { parseUsd, shortAddress, usd } from "@/lib/format";
import type { PersonView } from "@/lib/types";

function useOrgRegistry() {
  return useQuery({
    queryKey: ["org-registry"],
    queryFn: async () => {
      const reader = chainReader();
      if (!reader) return null;
      const [orgs, { events }] = await Promise.all([reader.getOrgExposure(), reader.getEvents({ fromBlock: BigInt(config.deployed.block ?? 0) })]);
      const officers = new Map<string, Map<string, boolean>>();
      for (const e of events) {
        if (e.contract !== "OrgRegistry" || e.name !== "OfficerSet") continue;
        const byOrg = officers.get(e.orgId.toString()) ?? new Map<string, boolean>();
        byOrg.set(String(e.args.officer).toLowerCase(), e.args.active === true);
        officers.set(e.orgId.toString(), byOrg);
      }
      return orgs.map((o) => ({
        ...o,
        officers: [...(officers.get(o.orgId.toString()) ?? new Map()).entries()].filter(([, active]) => active).map(([w]) => w as `0x${string}`),
      }));
    },
    refetchInterval: 10_000,
  });
}

function initials(name: string | null | undefined): string | null {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") : null;
}

type SafeProps = { safeAddress: Address | null; directSender: boolean };

/** One org's own cap (U-69). An empty field or 0 puts the org back on the default `perOrgCap`. */
function OrgCap({ org, registry, common }: { org: { orgId: bigint; name: string; cap: bigint; customCap: boolean }; registry: Address; common: SafeProps }) {
  const [value, setValue] = useState("");
  const cap = value.trim() === "" ? 0n : parseUsd(value);
  const id = `org-cap-${org.orgId}`;
  return (
    <div className="flex flex-col gap-2" data-testid="org-cap-editor">
      <Label htmlFor={id}>Org cap ($)</Label>
      <p className="text-muted-foreground text-xs">Empty or 0 puts this org back on the default cap.</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Input id={id} inputMode="decimal" className="sm:max-w-[200px]" value={value} onChange={(e) => setValue(e.target.value)} />
        <SafeAction
          txs={cap === null ? [] : [{ to: registry, value: 0n, label: "Set org cap", data: encodeFunctionData({ abi: claimRegistryAbi, functionName: "setOrgCap", args: [org.orgId, cap] }) }]}
          name={cap === 0n ? `Put ${org.name} on the default cap` : `Set ${org.name} cap to ${cap === null ? "" : usd(cap)}`}
          description="setOrgCap"
          disabled={cap === null || (cap === 0n && !org.customCap)}
          {...common}
        />
      </div>
    </div>
  );
}

function Orgs() {
  const deployed = deployedContracts();
  const holds = useHoldsRole("admin");
  const registry = useOrgRegistry();
  const directory = useOrgs();
  const call = useCall();
  const [name, setName] = useState("");
  const [officerOrg, setOfficerOrg] = useState("");
  const [officer, setOfficer] = useState("");

  const wallets = [...new Set((registry.data ?? []).flatMap((o) => o.officers))];
  const kyc = useQuery({
    queryKey: ["org-officer-kyc", wallets.join(",")],
    enabled: wallets.length > 0,
    queryFn: async () => (await call<{ people: PersonView[] }>("directory", { query: { view: "people", wallets: wallets.join(",") } })).people,
  });
  const peopleByWallet = new Map((kyc.data ?? []).map((p) => [p.wallet.toLowerCase(), p]));

  if (!deployed || registry.isPending) return <Skeleton className="h-48 w-full rounded-3xl" />;
  if (registry.isError || !registry.data) return <ErrorNotice>We couldn&apos;t read the org registry.</ErrorNotice>;
  const tx = (label: string, data: `0x${string}`) => [{ to: deployed.orgRegistry, value: 0n, label, data }];
  const common = { safeAddress: roleSafe("admin"), directSender: holds.data === true };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Add an org</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Label htmlFor="org-name">Name</Label>
            <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} />
            <SafeAction
              txs={tx("Add org", encodeFunctionData({ abi: orgRegistryAbi, functionName: "addOrg", args: [name.trim()] }))}
              name={`Add org ${name}`}
              description="addOrg"
              disabled={!name.trim()}
              {...common}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Add an officer</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="officer-org">Org number</Label>
                <Input id="officer-org" inputMode="numeric" value={officerOrg} onChange={(e) => setOfficerOrg(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="officer-wallet">Officer wallet</Label>
                <Input id="officer-wallet" className="font-mono" value={officer} onChange={(e) => setOfficer(e.target.value)} />
              </div>
            </div>
            <SafeAction
              txs={
                /^[0-9]+$/.test(officerOrg) && isAddress(officer)
                  ? tx("Set officer", encodeFunctionData({ abi: orgRegistryAbi, functionName: "setOfficer", args: [BigInt(officerOrg), officer, true] }))
                  : []
              }
              name={`Add officer to org ${officerOrg}`}
              description="setOfficer"
              disabled={!/^[0-9]+$/.test(officerOrg) || !isAddress(officer)}
              {...common}
            />
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        {registry.data.map((o) => {
          const dirOrg = directory.data?.find((d) => d.id === Number(o.orgId));
          return (
            <Card key={o.orgId.toString()} data-testid={`org-${o.orgId}`} className="gap-0 overflow-hidden p-0">
              <GradientPanel tone="panel" className="flex flex-col gap-4 rounded-none p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-lg font-semibold">{o.name}</span>
                    <span className="text-on-ink/75 text-[13px]">
                      Org #{o.orgId.toString()} · {o.officers.length} officer{o.officers.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <span className={o.active ? "text-on-ink/70 text-[13px]" : "text-danger text-[13px] font-semibold"}>{o.active ? "Active" : "Inactive"}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-on-ink/60 text-xs font-medium">Outstanding</span>
                  <span className="tabular text-xl font-semibold" data-testid="org-cap">
                    {usd(o.outstanding)} of {usd(o.cap)}
                  </span>
                  <span className="text-on-ink/60 text-xs">{o.customCap ? "Custom cap for this org" : "Default cap"}</span>
                </div>
              </GradientPanel>
              <CardContent className="flex flex-col gap-3 pt-5">
                <h3 className="text-[15px] font-semibold">Officers</h3>
                {o.officers.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No officers yet.</p>
                ) : (
                  <ul className="border-border divide-divider divide-y rounded-md border">
                    {o.officers.map((w) => {
                      const dirOfficer = dirOrg?.officers.find((of) => of.wallet.toLowerCase() === w.toLowerCase());
                      const person = peopleByWallet.get(w.toLowerCase());
                      const status = person?.kycStatus ?? "not_started";
                      return (
                        <li key={w} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
                          <span className="bg-surface-muted text-foreground flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                            {initials(dirOfficer?.displayName) ?? w.slice(2, 4).toUpperCase()}
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="truncate text-sm font-semibold">{dirOfficer?.displayName ?? shortAddress(w)}</span>
                            <span className="text-muted-foreground truncate text-xs">
                              {dirOfficer?.title ? `${dirOfficer.title} · ` : ""}
                              <span className="font-mono">{shortAddress(w)}</span>
                            </span>
                          </span>
                          {person ? <StatusText tone={kycTone(status)}>KYC {status.replace("_", " ")}</StatusText> : null}
                          <SafeAction
                            txs={tx("Remove officer", encodeFunctionData({ abi: orgRegistryAbi, functionName: "setOfficer", args: [o.orgId, w, false] }))}
                            name={`Remove officer ${shortAddress(w)}`}
                            description="setOfficer false"
                            {...common}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
                <OrgCap org={o} registry={deployed.claimRegistry} common={common} />
                <h3 className="mt-2 text-[15px] font-bold">{o.active ? "Deactivate this org" : "Activate this org"}</h3>
                <SafeAction
                  txs={tx(o.active ? "Deactivate org" : "Activate org", encodeFunctionData({ abi: orgRegistryAbi, functionName: "setOrgActive", args: [o.orgId, !o.active] }))}
                  name={`${o.active ? "Deactivate" : "Activate"} ${o.name}`}
                  description="setOrgActive"
                  {...common}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default function OrgsPage() {
  return <AdminShell title="Orgs and officers">{() => <Orgs />}</AdminShell>;
}
