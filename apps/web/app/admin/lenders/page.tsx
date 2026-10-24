"use client";

import { receivablesPoolAbi } from "@app/abi";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { encodeFunctionData, isAddress } from "viem";
import { AdminShell } from "@/components/admin/admin-shell";
import { GradientPanel } from "@/components/app/gradient-panel";
import { ErrorNotice } from "@/components/app/notice";
import { SafeAction } from "@/components/app/safe-action";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { roleSafe, useHoldsRole } from "@/hooks/use-roles";
import { publicClient } from "@/lib/chain";
import { config, deployedContracts } from "@/lib/config";
import { shortAddress, usd } from "@/lib/format";

function useLenders() {
  const deployed = deployedContracts();
  return useQuery({
    queryKey: ["lenders"],
    enabled: Boolean(deployed),
    queryFn: async () => {
      const pool = { address: deployed!.pool, abi: receivablesPoolAbi } as const;
      const [events, enabled, cap, totalAssets] = await Promise.all([
        publicClient.getContractEvents({ ...pool, eventName: "LenderAllowedSet", fromBlock: BigInt(config.deployed.block ?? 0) }),
        publicClient.readContract({ ...pool, functionName: "allowlistEnabled" }),
        publicClient.readContract({ ...pool, functionName: "depositCap" }),
        publicClient.readContract({ ...pool, functionName: "totalAssets" }),
      ]);
      const allowed = new Map<string, boolean>();
      for (const e of events) if (e.args.lender) allowed.set(e.args.lender.toLowerCase(), e.args.allowed === true);
      const addresses = [...allowed.entries()].filter(([, a]) => a).map(([l]) => l as `0x${string}`);
      const deposits = await Promise.all(addresses.map((address) => publicClient.readContract({ ...pool, functionName: "maxWithdraw", args: [address] })));
      return { lenders: addresses.map((address, i) => ({ address, deposited: deposits[i]! })), enabled, cap, totalAssets };
    },
    refetchInterval: 10_000,
  });
}

function Lenders() {
  const deployed = deployedContracts();
  const holds = useHoldsRole("admin");
  const lenders = useLenders();
  const [lender, setLender] = useState("");
  if (!deployed || lenders.isPending) return <Skeleton className="h-48 w-full rounded-3xl" />;
  if (lenders.isError) return <ErrorNotice>We couldn&apos;t read the allowlist.</ErrorNotice>;
  const common = { safeAddress: roleSafe("admin"), directSender: holds.data === true };
  const set = (address: `0x${string}`, allowed: boolean) => [
    { to: deployed.pool, value: 0n, label: allowed ? "Allow lender" : "Remove lender", data: encodeFunctionData({ abi: receivablesPoolAbi, functionName: "setLenderAllowed", args: [address, allowed] }) },
  ];
  const full = lenders.data.cap > 0n && lenders.data.totalAssets >= lenders.data.cap;
  const pct = lenders.data.cap > 0n ? Math.min(100, Number((lenders.data.totalAssets * 100n) / lenders.data.cap)) : 0;

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <GradientPanel tone="panel" className="flex flex-col gap-3 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-on-ink/70 text-xs font-medium">Deposits vs cap</span>
            <span className="text-on-ink/70 text-[13px]">Allowlist {lenders.data.enabled ? "on" : "off"}</span>
          </div>
          <div className="flex items-baseline gap-3">
            <span className="money-type text-5xl">{usd(lenders.data.totalAssets)}</span>
            <span className="text-on-ink/70 text-lg">of {usd(lenders.data.cap)}</span>
          </div>
          <div className="bg-on-ink/20 h-2 rounded-full">
            <div className="bg-on-ink h-2 rounded-full" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-on-ink/75 text-[13px]">
            {full ? "The pool is full. Raise the deposit cap in Parameters before adding new lenders." : "Deposit cap can be changed on the Parameters page."}
          </p>
        </GradientPanel>
        <Card>
          <CardHeader>
            <CardTitle>Allowlisted lenders</CardTitle>
          </CardHeader>
          <CardContent>
            {lenders.data.lenders.length === 0 ? (
              <p className="text-muted-foreground text-sm">No lenders allowed yet.</p>
            ) : (
              <ul className="border-border divide-divider divide-y rounded-md border" data-testid="lender-list">
                {lenders.data.lenders.map((l) => (
                  <li key={l.address} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-mono text-xs font-semibold" title={l.address}>
                        {shortAddress(l.address)}
                      </span>
                      <span className="tabular text-sm font-semibold">{usd(l.deposited)}</span>
                    </span>
                    <SafeAction txs={set(l.address, false)} name="Remove lender" description="setLenderAllowed false" {...common} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      <Card className="lg:w-96 lg:shrink-0">
        <CardHeader>
          <CardTitle>Add a lender</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="space-y-2">
            <Label htmlFor="lender">Wallet or Safe address</Label>
            <Input id="lender" className="font-mono" placeholder="0x…" value={lender} onChange={(e) => setLender(e.target.value)} />
          </div>
          <p className="text-muted-foreground text-xs">During the pilot only Frax lends. Third-party lenders wait on Frax&apos;s answer about LP verification.</p>
          <SafeAction txs={isAddress(lender) ? set(lender, true) : []} name="Allow lender" description="setLenderAllowed" disabled={!isAddress(lender)} {...common} />
        </CardContent>
      </Card>
    </div>
  );
}

export default function LendersPage() {
  return <AdminShell title="Lenders">{() => <Lenders />}</AdminShell>;
}
