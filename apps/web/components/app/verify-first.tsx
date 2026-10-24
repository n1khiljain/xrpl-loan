"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useFraxnetConnect } from "@/hooks/use-fraxnet-connect";
import { friendlyError } from "@/lib/errors";
import type { KycStatus } from "@/lib/types";
import { GradientPanel } from "./gradient-panel";
import { ErrorNotice } from "./notice";
import { WalletCopy } from "./wallet-copy";

const WHAT: Record<"member" | "officer", string> = {
  member: "Frax pays reimbursements only to people verified on FraxNet. Connect your FraxNet account in a new tab, and this page unlocks when you're done.",
  officer: "Officers who sign off need to be verified on FraxNet too, since you'd cover what's left if ASUC never pays. Connect your FraxNet account in a new tab, and this page unlocks when you're done.",
};

/**
 * Stands in for a screen that needs a verified person (U-24, U-77). FraxNet opens in a new tab and this page unlocks
 * when it connects, so a member who opened "Get reimbursed now" or an officer who opened a sign-off link stays put.
 */
export function VerifyFirst({ status, role, wallet }: { status: KycStatus; role: "member" | "officer"; wallet?: string }) {
  const connect = useFraxnetConnect();
  const waiting = status === "pending";
  const inTab = connect.state === "waiting";

  return (
    <div className="flex max-w-2xl flex-col gap-4" data-testid="verify-first">
      <GradientPanel tone="frax" className="flex flex-col gap-4 p-6 sm:p-7">
        <span className="flex items-center gap-2.5 text-[13px] text-on-ink/75">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/frax-logo-on-dark.png" alt="Frax" className="h-4 w-auto" />
          FraxNet identity
        </span>
        <h2 className="display-type text-[26px] sm:text-[30px]">
          {waiting ? "FraxNet is still verifying you" : inTab ? "Finish in the FraxNet tab" : "Verify with FraxNet first"}
        </h2>
        <p className="text-on-ink/82 max-w-lg text-sm leading-relaxed sm:text-[15px]">
          {waiting
            ? "Finish verifying on net.frax.com. Once FraxNet approves you, check again on Verification."
            : inTab
              ? "Sign in or make your account in the FraxNet tab, then allow this app to see it. This page unlocks by itself."
              : WHAT[role]}
        </p>
        <div className="flex flex-col gap-2.5 pt-1 sm:flex-row">
          {waiting ? (
            <Button asChild variant="light" size="lg">
              <Link href="/onboard/">Go to Verification</Link>
            </Button>
          ) : (
            <Button
              variant={inTab ? "glass" : "light"}
              size="lg"
              disabled={connect.state === "opening"}
              data-testid="verify-first-connect"
              onClick={connect.start}
            >
              {connect.state === "opening" ? "Opening FraxNet..." : inTab ? "Open the FraxNet tab again" : "Connect FraxNet"}
              {connect.state === "idle" ? <ExternalLink className="size-4" /> : null}
            </Button>
          )}
        </div>
      </GradientPanel>
      {connect.error ? <ErrorNotice>{friendlyError(connect.error)}</ErrorNotice> : null}
      {inTab && wallet ? <WalletCopy wallet={wallet} className="bg-card rounded-2xl p-5" /> : null}
    </div>
  );
}
