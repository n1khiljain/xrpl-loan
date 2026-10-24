"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, ExternalLink } from "lucide-react";
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
import { type ConnectState, useFraxnetConnect } from "@/hooks/use-fraxnet-connect";
import { config } from "@/lib/config";
import { friendlyError } from "@/lib/errors";
import { useSession } from "@/lib/session/context";
import { cn } from "@/lib/utils";
import type { KycStatus, KycStatusResponse, MeResponse, OffchainClaim } from "@/lib/types";

/** What the status means right now, from the stored status and, when connected, why FraxNet says so (U-77). */
function statusText(kyc: KycStatusResponse | undefined, fallback: KycStatus): { label: string; detail: string } {
  const status = kyc?.status ?? fallback;
  const account = kyc?.fraxnet;
  if (status === "approved") {
    return {
      label: "Approved",
      detail:
        kyc?.source === "manual" && !account
          ? "Frax staff verified you. You can get reimbursed now or sign off for a teammate."
          : "You're verified. You can get reimbursed now or sign off for a teammate.",
    };
  }
  if (status === "rejected") return { label: "Rejected", detail: "FraxNet couldn't verify you. Contact FraxNet support, then check again." };
  if (status === "pending") {
    if (account?.reason === "business_org") {
      return { label: "Pending", detail: "That FraxNet account is a business. Reconnect with your personal FraxNet account." };
    }
    return { label: "Pending", detail: "FraxNet hasn't verified you yet. Once you've finished verifying on FraxNet, press Check again." };
  }
  return { label: "Not started", detail: "Connect your FraxNet account to start. New to FraxNet? You can make an account in the tab that opens." };
}

/** A dot and a plain label, like the reimbursement states (U-75). */
const KYC_DOT: Record<KycStatus, string> = {
  not_started: "bg-muted-foreground",
  pending: "bg-warning",
  approved: "bg-success",
  rejected: "bg-danger",
};

type ChecklistStep = { label: string; detail: string; done: boolean };

/** The getting-started checklist from real account state: no step here is guessed. */
function checklistSteps(me: MeResponse, kycApproved: boolean, claims: OffchainClaim[]): ChecklistStep[] {
  const wallet = me.profile?.wallet;
  const mine = claims.filter((c) => c.recipientWallet === wallet);
  const orgNames = me.officerOrgs.map((o) => o.name).join(", ");
  // making a reimbursement means picking your org; getting one past a draft, or signing off for someone, is the first one
  const inOrg = me.officerOrgs.length > 0 || mine.length > 0;
  const first = mine.some((c) => c.status !== "Draft") || claims.some((c) => c.guarantorWallet === wallet && c.guarantySigned);
  return [
    { label: "Account created", detail: me.profile?.email ?? "Your account is set up", done: true },
    { label: "Verify with FraxNet", detail: "Connect your FraxNet account", done: kycApproved },
    { label: "Join your org", detail: orgNames || (inOrg ? "You're reimbursing for your org" : "An admin adds you as a member or officer"), done: inOrg },
    { label: "Get your first reimbursement", detail: first ? "You're all set" : "Or sign off for a teammate", done: first },
  ];
}

function GettingStarted({ me, kycApproved }: { me: MeResponse; kycApproved: boolean }) {
  const call = useCall();
  // the same list and cache the sidebar's sign-off count uses
  const claims = useQuery({ queryKey: ["claims", "mine", "raw"], queryFn: () => call<{ claims: OffchainClaim[] }>("claims"), staleTime: 30_000 });
  const steps = checklistSteps(me, kycApproved, claims.data?.claims ?? []);
  const current = steps.findIndex((s) => !s.done);
  return (
    <GradientPanel tone="panel" className="hidden w-[340px] shrink-0 p-7 lg:block">
      <div className="relative flex flex-col gap-7">
        <h2 className="display-type text-[24px] leading-tight">Two minutes, then you&apos;re set</h2>
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

function Hero({ kyc, connect, onConnect, onCheck, checking }: {
  kyc: KycStatusResponse | undefined;
  connect: ConnectState;
  onConnect: () => void;
  onCheck: () => void;
  checking: boolean;
}) {
  const account = kyc?.fraxnet ?? null;
  const verifyUrl = kyc?.verifyUrl ?? config.fraxnet.appUrl;
  const verified = kyc?.status === "approved";
  const reconnect = account?.needsReconnect === true || account?.reason === "business_org";

  const waiting = connect === "waiting";
  let title = "Connect your FraxNet account";
  let body =
    "FraxNet opens in a new tab. Sign in, or make an account and verify your identity there, then let this app see it. Frax checks your ID, so this app never sees it.";
  if (waiting) {
    title = "Finish in the FraxNet tab";
    body = "Sign in or make your account in the FraxNet tab, then allow this app to see it. This page updates by itself when you're done.";
  } else if (account?.needsReconnect) {
    title = "Reconnect FraxNet";
    body = "Your FraxNet sign-in ran out, so we can't check your verification. Connect again to pick up where you left off.";
  } else if (account && verified) {
    title = "FraxNet connected";
    body = "Your FraxNet account is connected and verified. We check it again each time you open this page.";
  } else if (account && !reconnect) {
    title = "One last step";
    body = account.walletAdded
      ? "Your FraxNet account is connected and your wallet is already added to it. Now verify your identity on FraxNet, which takes about 10 minutes, then check again here."
      : "Your FraxNet account is connected. Now verify your identity on FraxNet, which takes about 10 minutes, then check again here.";
  }
  const verifyNext = account !== null && !verified && !reconnect && !waiting;

  return (
    <GradientPanel tone="frax" className="flex flex-col gap-4 p-6 sm:p-7">
      <span className="flex items-center gap-2.5 text-[13px] text-on-ink/75">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/frax-logo-on-dark.png" alt="Frax" className="h-4 w-auto" />
        FraxNet identity
      </span>
      <h1 className="display-type text-[28px] sm:text-[36px]">{title}</h1>
      <p className="text-on-ink/82 max-w-lg text-sm leading-relaxed sm:text-[15px]">{body}</p>
      <div className="flex flex-col gap-2.5 pt-1 sm:flex-row">
        {verifyNext ? (
          <>
            <Button asChild variant="light" size="lg">
              <a href={verifyUrl} target="_blank" rel="noopener noreferrer" data-testid="verify-fraxnet">
                Verify your identity on FraxNet <ExternalLink className="size-4" />
              </a>
            </Button>
            <Button variant="glass" size="lg" onClick={onCheck} disabled={checking} data-testid="check-status">
              {checking ? "Checking..." : "Check again"}
            </Button>
          </>
        ) : !account || reconnect || waiting ? (
          <Button
            variant={waiting ? "glass" : "light"}
            size="lg"
            onClick={onConnect}
            disabled={connect === "opening"}
            data-testid="connect-fraxnet"
          >
            {connect === "opening" ? "Opening FraxNet..." : waiting ? "Open the FraxNet tab again" : reconnect ? "Reconnect FraxNet" : "Connect FraxNet"}
            {connect === "idle" ? <ExternalLink className="size-4" /> : null}
          </Button>
        ) : (
          <Button variant="light" size="lg" onClick={onCheck} disabled={checking} data-testid="check-status">
            {checking ? "Checking..." : "Check again"}
          </Button>
        )}
      </div>
    </GradientPanel>
  );
}

function Verify({ me }: { me: MeResponse }) {
  const call = useCall();
  const session = useSession();
  // asks FraxNet again through the stored connection each visit; the server never sends tokens back
  const kyc = useQuery({
    queryKey: ["kyc", session.userId],
    queryFn: () => call<KycStatusResponse>("kyc-status", { method: "POST" }),
    staleTime: 30_000,
  });
  const connect = useFraxnetConnect();
  const current: KycStatus = kyc.data?.status ?? me.profile?.kycStatus ?? "not_started";
  const text = statusText(kyc.data, current);
  const account = kyc.data?.fraxnet ?? null;
  const error = connect.error ?? kyc.error;

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      <GettingStarted me={me} kycApproved={current === "approved"} />
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <Hero
          kyc={kyc.data}
          connect={connect.state}
          onConnect={connect.start}
          onCheck={() => void kyc.refetch()}
          checking={kyc.isFetching}
        />

        {error ? <ErrorNotice>{friendlyError(error)}</ErrorNotice> : null}

        <div className="bg-card flex flex-col rounded-2xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3 pb-4">
            <span className="text-muted-foreground text-sm">FraxNet account</span>
            <span className="min-w-0 truncate text-sm font-medium" data-testid="fraxnet-account">
              {account ? account.orgName || "Connected" : "Not connected"}
            </span>
          </div>
          {account?.walletAdded ? (
            <div className="border-divider flex items-center justify-between gap-3 border-t py-4">
              <span className="text-muted-foreground text-sm">Wallet</span>
              <span className="text-sm font-medium" data-testid="wallet-added">
                Added to FraxNet
              </span>
            </div>
          ) : null}
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
          {kyc.data?.stale ? <p className="text-muted-foreground pt-2 text-xs">FraxNet didn&apos;t answer just now, so this is the last status we saw.</p> : null}
          {current !== "approved" && !account?.walletAdded && me.profile ? (
            <WalletCopy wallet={me.profile.wallet} className="border-divider mt-4 border-t pt-4" />
          ) : null}
        </div>

        <Button asChild size="lg" variant={current === "approved" ? "default" : "outline"} className="self-start">
          <Link href="/claims/new/">Get reimbursed now</Link>
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
