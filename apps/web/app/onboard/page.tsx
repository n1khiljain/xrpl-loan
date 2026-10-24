"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { AccountGate } from "@/components/app/account-gate";
import { GradientPanel } from "@/components/app/gradient-panel";
import { ErrorNotice } from "@/components/app/notice";
import { Topbar } from "@/components/app/topbar";
import { WalletCopy } from "@/components/app/wallet-copy";
import { Swap } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { useCall } from "@/hooks/use-api";
import { dropsToXrp } from "@app/adapters";
import { ASSET } from "@/lib/config";
import { friendlyError } from "@/lib/errors";
import { usd } from "@/lib/format";
import { useSession } from "@/lib/session/context";
import { cn } from "@/lib/utils";
import type { KycStatus, MeResponse, OffchainReceivable, WalletView } from "@/lib/types";

function statusText(me: MeResponse): { label: string; detail: string } {
  const status = me.profile?.kycStatus ?? "not_started";
  if (status === "approved") return { label: "Approved", detail: "You're verified. You can expedite a payment or sign off for a teammate." };
  if (status === "rejected") return { label: "Rejected", detail: "A reviewer couldn't verify you. Reply to the email we sent, or contact the team." };
  if (status === "pending") return { label: "Pending", detail: "Your email is verified. A reviewer approves you next, usually within a day." };
  return { label: "Not started", detail: "Verify your email to start. Press the button above while signed in with it." };
}

/** A dot and a plain label, like the receivable states. */
const KYC_DOT: Record<KycStatus, string> = {
  not_started: "bg-muted-foreground",
  pending: "bg-warning",
  approved: "bg-success",
  rejected: "bg-danger",
};

type ChecklistStep = { label: string; detail: string; done: boolean };

/** The getting-started checklist from real account state: no step here is guessed. */
function checklistSteps(me: MeResponse, kycApproved: boolean, receivables: OffchainReceivable[]): ChecklistStep[] {
  const wallet = me.profile?.wallet;
  const mine = receivables.filter((c) => c.recipientWallet === wallet);
  // getting one past a draft, or signing off for someone as an org officer, is the first one
  const first = mine.some((c) => c.status !== "Draft") || receivables.some((c) => c.guarantorWallet === wallet && c.guarantySigned);
  return [
    { label: "Account created", detail: me.profile?.email ?? "Your account is set up", done: true },
    { label: "Verify your email", detail: me.profile?.emailVerified ? (me.profile.email ?? "Verified") : "Sign in with your email or Google", done: Boolean(me.profile?.emailVerified) },
    { label: "Reviewer approval", detail: kycApproved ? "You're approved" : "Usually within a day", done: kycApproved },
    { label: "Expedite your first payment", detail: first ? "You're all set" : "An invoice, a card settlement, or a reimbursement", done: first },
  ];
}

function GettingStarted({ me, kycApproved }: { me: MeResponse; kycApproved: boolean }) {
  const call = useCall();
  // the same list and cache the sidebar's sign-off count uses
  const receivables = useQuery({ queryKey: ["receivables", "mine", "raw"], queryFn: () => call<{ receivables: OffchainReceivable[] }>("receivables"), staleTime: 30_000 });
  const steps = checklistSteps(me, kycApproved, receivables.data?.receivables ?? []);
  const current = steps.findIndex((s) => !s.done);
  return (
    <GradientPanel tone="panel" className="hidden w-[340px] shrink-0 p-7 lg:block">
      <div className="relative flex flex-col gap-7">
        <h2 className="display-type text-[24px] leading-tight">A few steps, then you&apos;re set</h2>
        <ol className="flex flex-col gap-5">
          {steps.map((step, i) => (
            <li key={step.label} className="flex items-start gap-3.5">
              {/* keyed by done, so a step that finishes while you're here pops its tick in */}
              <motion.span
                key={`${step.label}-${step.done}`}
                initial={step.done ? { scale: 0.4, opacity: 0 } : false}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 420, damping: 22, delay: i * 0.08 }}
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold",
                  step.done ? "bg-on-ink text-ink" : i === current ? "border-on-ink text-on-ink border-2" : "border-on-ink/25 text-on-ink/55 border",
                )}
              >
                {step.done ? <Check aria-label="Done" className="size-3.5" strokeWidth={3} /> : i + 1}
              </motion.span>
              <span className="flex flex-col gap-0.5">
                <span className={cn("text-[15px] font-semibold", !step.done && i !== current && "text-on-ink/70")}>{step.label}</span>
                <span className="text-on-ink/60 text-[13px]">{step.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </GradientPanel>
  );
}

function Hero({ me, onVerify, verifying }: { me: MeResponse; onVerify: () => void; verifying: boolean }) {
  const status = me.profile?.kycStatus ?? "not_started";
  const emailVerified = Boolean(me.profile?.emailVerified);
  const title = status === "approved" ? "You're verified" : emailVerified ? "Waiting on a reviewer" : "Verify your email";
  const body =
    status === "approved"
      ? "A reviewer approved you. That approval issues the credential this account needs to use the vault."
      : emailVerified
        ? "Your email is verified. A reviewer checks who you are next and approves you, usually within a day."
        : "Sign-in already proved your email to Privy. Press below to share that proof with this app, so a reviewer can approve you.";
  return (
    <GradientPanel tone="ledger" className="flex flex-col gap-4 p-6 sm:p-7">
      <span className="text-on-ink/75 text-[13px]">Identity</span>
      <h1 className="display-type text-[28px] sm:text-[36px]">{title}</h1>
      <p className="text-on-ink/82 max-w-lg text-sm leading-relaxed sm:text-[15px]">{body}</p>
      {!emailVerified ? (
        <div className="pt-1">
          <Button variant="light" size="lg" onClick={onVerify} disabled={verifying} data-testid="verify-email">
            {verifying ? "Checking..." : "Verify my email"}
          </Button>
        </div>
      ) : null}
    </GradientPanel>
  );
}

function Wallet({ me }: { me: MeResponse }) {
  const call = useCall();
  const wallet = useQuery({ queryKey: ["wallet", me.profile?.wallet], queryFn: () => call<WalletView>("wallet"), refetchInterval: 10_000 });
  if (!me.profile) return null;
  return (
    <div className="bg-card flex flex-col gap-4 rounded-2xl p-5 sm:p-6" data-testid="wallet-card">
      <WalletCopy wallet={me.profile.wallet} />
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="bg-surface-muted flex flex-col gap-0.5 rounded-xl p-3">
          <span className="text-muted-foreground text-xs">XRP for fees and reserves</span>
          <span className="tabular font-semibold" data-testid="xrp-balance">
            {wallet.data ? (wallet.data.exists ? `${dropsToXrp(wallet.data.xrpDrops)} XRP` : "Funding...") : "..."}
          </span>
        </div>
        <div className="bg-surface-muted flex flex-col gap-0.5 rounded-xl p-3">
          <span className="text-muted-foreground text-xs">{ASSET}</span>
          <span className="tabular font-semibold">{wallet.data?.assetUnits ? usd(wallet.data.assetUnits) : "No trust line yet"}</span>
        </div>
      </div>
      {wallet.data?.transactions.length ? (
        <ul className="divide-divider flex flex-col divide-y text-sm">
          {wallet.data.transactions.map((t) => (
            <li key={t.txHash} className="flex items-center justify-between gap-3 py-2">
              <span>{t.purpose.replace(/_/g, " ")}</span>
              <a href={t.explorerUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground font-mono text-xs underline underline-offset-2">
                {t.txHash.slice(0, 10)}…
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {wallet.isError ? <ErrorNotice>{friendlyError(wallet.error)}</ErrorNotice> : null}
    </div>
  );
}

function Verify({ me }: { me: MeResponse }) {
  const call = useCall();
  const session = useSession();
  const queryClient = useQueryClient();
  const verify = useMutation({
    mutationFn: async () => {
      const identityToken = await session.getIdentityToken();
      if (!identityToken) throw new Error("Sign-in didn't share an identity token. Sign out and back in, then try again.");
      await call<MeResponse>("me", { method: "POST", body: { identityToken } });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });
  const current: KycStatus = me.profile?.kycStatus ?? "not_started";
  const text = statusText(me);

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      <GettingStarted me={me} kycApproved={current === "approved"} />
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <Hero me={me} onVerify={() => verify.mutate()} verifying={verify.isPending} />
        {verify.isError ? <ErrorNotice>{friendlyError(verify.error)}</ErrorNotice> : null}

        <div className="bg-card flex flex-col rounded-2xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3 pb-4">
            <span className="text-muted-foreground text-sm">Email</span>
            <span className="min-w-0 truncate text-sm font-medium" data-testid="email-status">
              {me.profile?.email ?? "None"} {me.profile?.emailVerified ? "(verified)" : "(not verified)"}
            </span>
          </div>
          <div className="border-divider flex items-center justify-between border-t pt-4">
            <span className="text-muted-foreground text-sm">Status</span>
            <span data-testid="kyc-status" data-status={current} className="text-sm font-medium">
              <Swap id={current} className="inline-flex items-center gap-1.5">
                <span aria-hidden className={cn("size-1.5 rounded-full", KYC_DOT[current])} />
                {text.label}
              </Swap>
            </span>
          </div>
          <p className="text-muted-foreground pt-3 text-sm">{text.detail}</p>
        </div>

        <Wallet me={me} />

        <Button asChild size="lg" variant={current === "approved" ? "default" : "outline"} className="self-start">
          <Link href="/receivables/new/">Expedite a payment</Link>
        </Button>
      </div>
    </div>
  );
}

export default function OnboardPage() {
  return (
    <AccountGate reason="Use your email. We make a wallet for you, so there's nothing to install.">
      {(me) => (
        <>
          <Topbar title="Verification" crumb="Getting started" />
          <Verify me={me} />
        </>
      )}
    </AccountGate>
  );
}
