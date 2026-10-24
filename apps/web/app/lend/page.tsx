"use client";

import { receivablesPoolAbi } from "@app/abi";
import { CLAIM_STATES, type ClaimView, type OrgExposure, type PoolStats, refreshClaims } from "@app/adapters";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type ComponentProps, type ReactNode, Suspense, useState } from "react";
import { erc20Abi } from "viem";
import { GradientPanel } from "@/components/app/gradient-panel";
import { ErrorNotice, InfoNotice } from "@/components/app/notice";
import { type DisplayState, STATE_LABEL } from "@/components/app/state-chip";
import { Topbar } from "@/components/app/topbar";
import { cardNumber } from "@/components/brand/claim-card";
import { CountUp, EASE } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { contractCall, useSendCalls } from "@/hooks/use-tx";
import { chainReader, publicClient } from "@/lib/chain";
import { deployedContracts, params } from "@/lib/config";
import { dateFromSeconds, parseUsd, usd } from "@/lib/format";
import { useSession } from "@/lib/session/context";
import { cn } from "@/lib/utils";

/** A number on the dark panel: a quiet label over the value, no box around it (U-75). */
function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-on-ink/60 text-xs font-medium">{label}</span>
      <span className="tabular text-on-ink text-lg font-semibold sm:text-xl" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

/** A thin bar that fills to `pct` once, the first time it scrolls into view. */
function FillBar({ pct, className, barClassName }: { pct: number; className?: string; barClassName?: string }) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full", className)}>
      <motion.div
        className={cn("h-full rounded-full", barClassName)}
        initial={{ width: 0 }}
        whileInView={{ width: `${pct}%` }}
        viewport={{ once: true, amount: 0.8 }}
        transition={{ duration: 0.9, ease: EASE, delay: 0.15 }}
      />
    </div>
  );
}

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const toDollars = (wei: bigint) => Number(wei / 10n ** 16n) / 100;

/** "BB" from "Blockchain at Berkeley", for orgs with no logo mark on file. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") : "?";
}

/** Pool totals and whether deposits are allowlisted: all the deposit page needs, in one multicall per poll. */
function usePoolStats() {
  return useQuery({
    queryKey: ["pool", "stats"],
    queryFn: async () => {
      const reader = chainReader();
      const deployed = deployedContracts();
      if (!reader || !deployed) return null;
      const [stats, allowlistOn] = await Promise.all([
        reader.getPoolStats(),
        publicClient.readContract({ address: deployed.pool, abi: receivablesPoolAbi, functionName: "allowlistEnabled" }),
      ]);
      return { stats, allowlistOn };
    },
    refetchInterval: 10_000,
  });
}

type PoolClaims = { exposure: OrgExposure[]; claims: ClaimView[] };
const POOL_CLAIMS = ["pool", "claims"] as const;

/** Claims by state, funded claims per org, and the newest purchases, from every claim the pool has seen. */
function summarize(data: PoolClaims | null) {
  if (!data) return null;
  const byState = new Map<string, { count: number; amount: bigint }>();
  const funded = new Map<string, number>();
  for (const c of data.claims) {
    const row = byState.get(c.state) ?? { count: 0, amount: 0n };
    byState.set(c.state, { count: row.count + 1, amount: row.amount + (c.purchasePrice || c.requestedAmount) });
    if (c.state === "Funded" || c.state === "GuarantorCalled") {
      const key = c.orgId.toString();
      funded.set(key, (funded.get(key) ?? 0) + 1);
    }
  }
  // "recent purchases" and the org exposure list are the only pieces of the design's chart/activity feed with
  // real timestamps behind them (purchasedAt, purchasePrice): no settle or deposit timestamps come back from
  // the ChainReader, so those event types, and the "outstanding, last 6 weeks" line chart, are left out rather
  // than invented.
  const recent = data.claims
    .filter((c) => c.purchasedAt > 0)
    .sort((a, b) => b.purchasedAt - a.purchasedAt)
    .slice(0, 6);
  return { exposure: data.exposure, byState, funded, recent };
}

type PoolSummary = NonNullable<ReturnType<typeof summarize>>;

/**
 * What the pool's claims add up to. A poll re-reads only claims that can still change, carrying final ones over
 * from the last poll (refreshClaims, I-6). A poll that finds nothing new leaves `data` the same object (react-query
 * structural sharing), so `summarize` doesn't rerun and nothing re-renders.
 */
function usePoolClaims() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: POOL_CLAIMS,
    queryFn: async (): Promise<PoolClaims | null> => {
      const reader = chainReader();
      if (!reader) return null;
      const previous = queryClient.getQueryData<PoolClaims | null>(POOL_CLAIMS)?.claims ?? [];
      const [exposure, claims] = await Promise.all([reader.getOrgExposure(), refreshClaims(reader, previous)]);
      return { exposure, claims };
    },
    select: summarize,
    refetchInterval: 10_000,
  });
}

function usePosition() {
  const session = useSession();
  const deployed = deployedContracts();
  const me = session.address;
  return useQuery({
    queryKey: ["lender", me],
    enabled: Boolean(me && deployed),
    queryFn: async () => {
      const pool = { address: deployed!.pool, abi: receivablesPoolAbi } as const;
      const [allowed, allowlistOn, shares, maxWithdraw, balance, maxDeposit, depositCap] = await Promise.all([
        publicClient.readContract({ ...pool, functionName: "isLenderAllowed", args: [me!] }),
        publicClient.readContract({ ...pool, functionName: "allowlistEnabled" }),
        publicClient.readContract({ ...pool, functionName: "balanceOf", args: [me!] }),
        publicClient.readContract({ ...pool, functionName: "maxWithdraw", args: [me!] }),
        publicClient.readContract({ address: deployed!.frxUSD, abi: erc20Abi, functionName: "balanceOf", args: [me!] }),
        publicClient.readContract({ ...pool, functionName: "maxDeposit", args: [me!] }),
        publicClient.readContract({ ...pool, functionName: "depositCap" }),
      ]);
      const value = await publicClient.readContract({ ...pool, functionName: "convertToAssets", args: [shares] });
      return { allowed: allowed || !allowlistOn, allowlistOn: Boolean(allowlistOn), shares, value, maxWithdraw, balance, maxDeposit, depositCap };
    },
    refetchInterval: 10_000,
  });
}

function usePreviewShares(kind: Kind, assets: bigint | null) {
  const deployed = deployedContracts();
  return useQuery({
    queryKey: ["preview-shares", kind, assets?.toString()],
    enabled: Boolean(deployed && assets && assets > 0n),
    queryFn: () =>
      publicClient.readContract({
        address: deployed!.pool,
        abi: receivablesPoolAbi,
        functionName: kind === "deposit" ? "previewDeposit" : "previewWithdraw",
        args: [assets as bigint],
      }),
  });
}

type Kind = "deposit" | "withdraw";
const KINDS: readonly Kind[] = ["deposit", "withdraw"];

const ACTIONS: Record<Kind, { label: string; sending: string; overTitle: string; over: (limit: string) => string }> = {
  deposit: { label: "Deposit", sending: "Depositing...", overTitle: "Over the deposit cap", over: (limit) => `The pool can take ${limit} more right now.` },
  withdraw: {
    label: "Withdraw",
    sending: "Withdrawing...",
    overTitle: "Over what's withdrawable",
    over: (limit) => `Only ${limit} is available to withdraw right now.`,
  },
};

/**
 * The amounts, limits, and contract calls behind both the compact card on the pool page and the full deposit
 * page, so the two can't disagree about what's allowed.
 */
function useDepositWithdraw() {
  const session = useSession();
  const deployed = deployedContracts();
  const tx = useSendCalls();
  const position = usePosition();
  const [amounts, setAmounts] = useState<Record<Kind, string>>({ deposit: "", withdraw: "" });
  const [pending, setPending] = useState<Kind | null>(null);

  const wei = (kind: Kind) => parseUsd(amounts[kind]);
  const limit = (kind: Kind) => (position.data ? (kind === "deposit" ? position.data.maxDeposit : position.data.maxWithdraw) : 0n);
  const over = (kind: Kind) => {
    const amount = wei(kind);
    return Boolean(position.data && amount && amount > limit(kind));
  };
  const sending = (kind: Kind) => tx.status === "sending" && pending === kind;
  const blocked = (kind: Kind) => !position.data || !wei(kind) || over(kind) || tx.status === "sending" || (kind === "deposit" && !position.data.allowed);
  const setAmount = (kind: Kind, value: string) => setAmounts((a) => ({ ...a, [kind]: value }));

  async function submit(kind: Kind) {
    const amount = wei(kind);
    const me = session.address;
    if (!amount || !me || !deployed || blocked(kind)) return;
    setPending(kind);
    const hashes =
      kind === "deposit"
        ? await tx.send(
            [
              contractCall({ address: deployed.frxUSD, abi: erc20Abi, functionName: "approve", args: [deployed.pool, amount] }),
              contractCall({ address: deployed.pool, abi: receivablesPoolAbi, functionName: "deposit", args: [amount, me] }),
            ],
            ["Allowing the deposit", "Depositing"],
          )
        : await tx.send([contractCall({ address: deployed.pool, abi: receivablesPoolAbi, functionName: "withdraw", args: [amount, me, me] })], ["Withdrawing"]);
    setPending(null);
    // a failed send keeps the amount, so trying again doesn't mean typing it again
    if (hashes) setAmount(kind, "");
  }

  return { session, deployed, tx, position, amounts, setAmount, wei, limit, over, sending, blocked, submit };
}

type LenderForm = ReturnType<typeof useDepositWithdraw>;
type Position = NonNullable<LenderForm["position"]["data"]>;

/** Connect a wallet, a placeholder while it loads, or the form once this wallet's position is in. */
function WithPosition({ form, connect, loading, children }: { form: LenderForm; connect: ReactNode; loading: ReactNode; children: (position: Position) => ReactNode }) {
  if (!form.session.address) return <>{form.session.status === "signed-out" ? connect : loading}</>;
  if (!form.deployed || !form.position.data) return <>{loading}</>;
  return <>{children(form.position.data)}</>;
}

/** The Deposit or Withdraw button. e2e/lender.spec.ts finds it by this testid. */
function SubmitButton({ form, kind, ...button }: { form: LenderForm; kind: Kind } & Pick<ComponentProps<typeof Button>, "variant" | "size" | "className">) {
  return (
    <Button {...button} onClick={() => void form.submit(kind)} disabled={form.blocked(kind)} data-testid={kind}>
      {form.sending(kind) ? ACTIONS[kind].sending : ACTIONS[kind].label}
    </Button>
  );
}

/** Why an amount can't go yet: the wallet isn't allowlisted, or the amount is over the cap or what's withdrawable. */
function BlockedNotices({ form, kinds, position }: { form: LenderForm; kinds: readonly Kind[]; position: Position }) {
  return (
    <>
      {!position.allowed ? <InfoNotice title="This wallet isn't on the lender allowlist">Ask the admin to add it before depositing.</InfoNotice> : null}
      {kinds
        .filter((kind) => form.over(kind))
        .map((kind) => (
          <ErrorNotice key={kind} title={ACTIONS[kind].overTitle}>
            {ACTIONS[kind].over(usd(form.limit(kind)))}
          </ErrorNotice>
        ))}
    </>
  );
}

/** The step a transaction is on, or why it failed. */
function TxFeedback({ form, onInk = false }: { form: LenderForm; onInk?: boolean }) {
  return (
    <>
      {form.tx.status === "sending" ? <p className={cn("text-xs", onInk ? "text-on-ink/80" : "text-muted-foreground")}>{form.tx.step ?? "Sending..."}</p> : null}
      {form.tx.error ? <ErrorNotice>{form.tx.error}</ErrorNotice> : null}
    </>
  );
}

/** "Deposit ($)" or "Withdraw ($)" with its button, for the dark card. e2e/lender.spec.ts fills it by this label. */
function CompactAmount({ form, kind, variant }: { form: LenderForm; kind: Kind; variant: "light" | "glass" }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={kind} className="text-on-ink/80 text-xs font-bold">
        {`${ACTIONS[kind].label} ($)`}
      </Label>
      <div className="flex gap-2">
        <Input id={kind} inputMode="decimal" value={form.amounts[kind]} onChange={(e) => form.setAmount(kind, e.target.value)} />
        <SubmitButton form={form} kind={kind} variant={variant} />
      </div>
    </div>
  );
}

/** The design's dark "your position" card, with a compact deposit/withdraw form (DLend's right column). */
function PositionCard() {
  const form = useDepositWithdraw();
  return (
    <GradientPanel tone="aside" className="flex flex-col gap-4 p-5 sm:p-6">
      <span className="eyebrow text-on-ink/60">Your position</span>
      <WithPosition
        form={form}
        loading={<Skeleton className="bg-on-ink/10 h-40 w-full" />}
        connect={
          <Button variant="light" size="lg" className="self-start" onClick={() => form.session.login({ method: "wallet" })}>
            Connect a wallet
          </Button>
        }
      >
        {(position) => (
          <>
            <span className="money-type text-4xl" data-testid="position-value">
              {usd(position.value)}
            </span>
            <div className="grid grid-cols-2 gap-y-2 text-[13px]">
              <span className="text-on-ink/65">Withdrawable now</span>
              <span className="text-right font-semibold">{usd(position.maxWithdraw)}</span>
              <span className="text-on-ink/65">Wallet frxUSD</span>
              <span className="text-right font-semibold" data-testid="wallet-balance">
                {usd(position.balance)}
              </span>
            </div>
            <BlockedNotices form={form} kinds={KINDS} position={position} />
            <div className="flex flex-col gap-3 pt-1">
              <CompactAmount form={form} kind="deposit" variant="light" />
              <CompactAmount form={form} kind="withdraw" variant="glass" />
            </div>
            <TxFeedback form={form} onInk />
          </>
        )}
      </WithPosition>
    </GradientPanel>
  );
}

function ExposureCard({ pool }: { pool: PoolSummary }) {
  // largest exposure first; orgs with nothing outstanding fold into one line so the list stays about risk
  const exposed = pool.exposure.filter((o) => o.outstanding > 0n).sort((a, b) => (b.outstanding > a.outstanding ? 1 : b.outstanding < a.outstanding ? -1 : 0));
  const idle = pool.exposure.length - exposed.length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Exposure by org</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {pool.exposure.length === 0 ? (
          <p className="text-muted-foreground text-sm">No orgs funded yet.</p>
        ) : exposed.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing outstanding with any org.</p>
        ) : (
          exposed.map((o) => {
            const pct = o.cap > 0n ? Math.min(Number((o.outstanding * 10_000n) / o.cap) / 100, 100) : 0;
            const fundedCount = pool.funded.get(o.orgId.toString()) ?? 0;
            return (
              <div key={o.orgId.toString()} className="border-divider flex flex-col gap-2 border-b pb-4 last:border-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <span className="bg-surface-muted flex size-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">{initials(o.name)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{o.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {fundedCount} funded · cap {usd(o.cap)}
                    </p>
                  </div>
                  <span className="tabular text-sm font-semibold">{usd(o.outstanding)}</span>
                </div>
                <FillBar pct={pct} className="bg-divider" barClassName="bg-foreground" />
              </div>
            );
          })
        )}
        {exposed.length > 0 && idle > 0 ? (
          <p className="text-muted-foreground text-xs">
            {idle} other {idle === 1 ? "org has" : "orgs have"} nothing outstanding.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ClaimsByStateCard({ pool }: { pool: PoolSummary }) {
  const states = CLAIM_STATES.filter((st) => st !== "None" && pool.byState.has(st));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reimbursements by state</CardTitle>
      </CardHeader>
      <CardContent>
        {states.length === 0 ? (
          <p className="text-muted-foreground text-sm">No reimbursements yet.</p>
        ) : (
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            {states.map((st) => (
              <span key={st} className="flex items-baseline gap-2">
                <span className="tabular text-2xl font-semibold">{pool.byState.get(st)?.count}</span>
                <span className="text-sm font-medium">{STATE_LABEL[st as DisplayState]}</span>
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Real-data substitute for the design's "Activity" feed: purchases only, since listClaims has purchasedAt and
 * purchasePrice for every claim but no settle or deposit timestamps to draw the rest of the feed from. */
function RecentPurchasesCard({ pool }: { pool: PoolSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent purchases</CardTitle>
      </CardHeader>
      <CardContent>
        {pool.recent.length === 0 ? (
          <p className="text-muted-foreground text-sm">No purchases yet.</p>
        ) : (
          <ul>
            {pool.recent.map((c) => {
              const org = pool.exposure.find((o) => o.orgId === c.orgId)?.name ?? `Org ${c.orgId}`;
              return (
                <li key={c.id.toString()} className="border-divider flex items-center gap-3 border-b py-2.5 last:border-0">
                  <span className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">Bought reimbursement {cardNumber(c.id)}</p>
                    <p className="text-muted-foreground text-xs">
                      {org} · {dateFromSeconds(c.purchasedAt)}
                    </p>
                  </span>
                  <span className="tabular text-sm font-semibold">-{usd(c.purchasePrice)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PoolHero({ stats: s, allowlistOn }: { stats: PoolStats; allowlistOn: boolean }) {
  const utilization = s.totalAssets > 0n ? Number((s.outstandingPrincipal * 10_000n) / s.totalAssets) / 100 : 0;
  const feePercent = Number(params.feeBps) / 100;
  return (
    <GradientPanel tone="panel" className="-mx-4 flex flex-col gap-6 p-6 sm:-mx-6 sm:p-7 lg:mx-0 lg:p-8">
      <div className="flex flex-col gap-1.5">
        <span className="text-on-ink/70 text-xs font-medium">Total pool assets</span>
        <span className="money-type text-5xl sm:text-6xl" data-testid="total-assets">
          <CountUp value={toDollars(s.totalAssets)} format={(n) => USD.format(n)} />
        </span>
        <span className="text-on-ink/75 text-[13px]">
          {feePercent}% a year fee · {allowlistOn ? "deposits allowlisted" : "deposits open"}
        </span>
      </div>
      {/* how much of the pool is out on reimbursements right now */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between text-[13px]">
          <span className="text-on-ink/70">Utilization</span>
          <span className="tabular font-semibold">{utilization.toFixed(1)}%</span>
        </div>
        <FillBar pct={utilization} className="bg-on-ink/15" barClassName="bg-on-ink" />
      </div>
      <div className="border-on-ink/10 grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-5 sm:grid-cols-4" data-testid="pool-stats">
        <Stat label="Idle cash" value={usd(s.idleCash)} testId="idle-cash" />
        <Stat label="Outstanding" value={usd(s.outstandingPrincipal)} />
        <Stat label="Share price" value={usd(s.sharePrice)} />
        <Stat label="Realized losses" value={usd(s.totalLosses)} />
      </div>
    </GradientPanel>
  );
}

function PoolView() {
  const stats = usePoolStats();
  const claims = usePoolClaims();
  const claimsPlaceholder = claims.isPending ? <Skeleton className="h-64 w-full rounded-3xl" /> : null;
  return (
    <div className="space-y-6">
      <Topbar title="Pool" crumb="Lender" />
      {stats.isError || claims.isError ? <ErrorNotice>We couldn&apos;t read the pool. Try again in a minute.</ErrorNotice> : null}
      {stats.data === null ? <InfoNotice title="The pool isn't deployed on this network yet" /> : null}
      {stats.isPending ? (
        <Skeleton className="h-96 w-full rounded-3xl" />
      ) : stats.data ? (
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <PoolHero stats={stats.data.stats} allowlistOn={stats.data.allowlistOn} />
            {claims.data ? (
              <>
                <ExposureCard pool={claims.data} />
                <ClaimsByStateCard pool={claims.data} />
              </>
            ) : (
              claimsPlaceholder
            )}
          </div>
          <div className="flex flex-col gap-6 lg:w-[360px] lg:shrink-0">
            <PositionCard />
            {claims.data ? <RecentPurchasesCard pool={claims.data} /> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DepositView() {
  const stats = usePoolStats();
  const form = useDepositWithdraw();
  const [mode, setMode] = useState<Kind>("deposit");
  const preview = usePreviewShares(mode, form.wei(mode));

  return (
    <div className="space-y-6">
      <Topbar title="Deposit and withdraw" crumb="Lender" back={{ href: "/lend/", label: "Pool" }} />
      <WithPosition
        form={form}
        loading={<Skeleton className="h-96 w-full rounded-3xl" />}
        connect={
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
              <p className="text-muted-foreground text-sm">Connect a wallet to deposit into the pool.</p>
              <Button size="lg" onClick={() => form.session.login({ method: "wallet" })}>
                Connect a wallet
              </Button>
            </CardContent>
          </Card>
        }
      >
        {(position) => (
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <Card className="min-w-0 flex-1">
              <CardContent className="flex flex-col gap-6">
                <Tabs value={mode} onValueChange={(v) => setMode(v as Kind)}>
                  <TabsList>
                    <TabsTrigger value="deposit">Deposit</TabsTrigger>
                    <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="flex flex-col items-center gap-2 py-4">
                  <Label htmlFor="amount" className="eyebrow text-muted-foreground">
                    Amount in frxUSD
                  </Label>
                  <Input
                    id="amount"
                    inputMode="decimal"
                    placeholder="$0.00"
                    value={form.amounts[mode]}
                    onChange={(e) => form.setAmount(mode, e.target.value)}
                    className="money-type h-auto border-none bg-transparent text-center text-5xl shadow-none focus-visible:ring-0 sm:text-6xl"
                  />
                  <span className="text-muted-foreground text-center text-[13px]">
                    {mode === "deposit"
                      ? `Wallet ${usd(position.balance)} frxUSD · room under cap ${usd(position.maxDeposit)}`
                      : `Withdrawable now ${usd(position.maxWithdraw)}`}
                  </span>
                </div>
                <BlockedNotices form={form} kinds={[mode]} position={position} />
                <div className="mt-auto flex flex-col-reverse justify-end gap-3 sm:flex-row">
                  <Button variant="secondary" size="lg" asChild>
                    <Link href="/lend/">Back to pool</Link>
                  </Button>
                  <SubmitButton form={form} kind={mode} size="lg" />
                </div>
                <TxFeedback form={form} />
              </CardContent>
            </Card>
            <div className="flex flex-col gap-6 lg:w-[340px] lg:shrink-0">
              <Card>
                <CardHeader>
                  <CardTitle>Preview</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
                    <span className="text-muted-foreground">{mode === "deposit" ? "You get" : "You redeem"}</span>
                    <span className="tabular text-right font-semibold">{usd(preview.data).replace("$", "")} shares</span>
                    <span className="text-muted-foreground">Share price</span>
                    <span className="tabular text-right font-semibold">{stats.data ? usd(stats.data.stats.sharePrice) : "..."}</span>
                    <span className="text-muted-foreground">Idle cash available to withdraw</span>
                    <span className="tabular text-right font-semibold">{stats.data ? usd(stats.data.stats.idleCash) : "..."}</span>
                  </div>
                </CardContent>
              </Card>
              <GradientPanel tone="aside" className="flex flex-col gap-3 p-5">
                <span className="eyebrow text-on-ink/60">How the pool works</span>
                <p className="text-on-ink/85 text-sm leading-relaxed">
                  Deposits buy pending ASUC reimbursements. Money comes back as members send over what ASUC pays them, plus a fee that grows
                  the longer it&apos;s out. Withdrawals come from idle cash, so what&apos;s out on reimbursements returns as they close out.
                  Losses from write-offs lower the share price.
                </p>
              </GradientPanel>
            </div>
          </div>
        )}
      </WithPosition>
    </div>
  );
}

function LendContent() {
  const view = useSearchParams().get("view");
  return view === "deposit" ? <DepositView /> : <PoolView />;
}

export default function LendPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-3xl" />}>
      <LendContent />
    </Suspense>
  );
}
