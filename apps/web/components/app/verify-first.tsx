"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { KycStatus } from "@/lib/types";
import { GradientPanel } from "./gradient-panel";

const WHAT: Record<"member" | "officer", string> = {
  member: "Only verified people can get reimbursed. Verify your email, then a reviewer approves you. It usually takes less than a day.",
  officer: "Officers who sign off need to be verified too, since you'd cover what's left if the payer never pays.",
};

/** Stands in for a screen that needs a verified person, and points to Verification. */
export function VerifyFirst({ status, role }: { status: KycStatus; role: "member" | "officer" }) {
  const waiting = status === "pending";
  return (
    <div className="flex max-w-2xl flex-col gap-4" data-testid="verify-first">
      <GradientPanel tone="ledger" className="flex flex-col gap-4 p-6 sm:p-7">
        <span className="text-on-ink/75 text-[13px]">Identity</span>
        <h2 className="display-type text-[26px] sm:text-[30px]">
          {waiting ? "A reviewer is checking your details" : status === "rejected" ? "You weren't approved" : "Verify first"}
        </h2>
        <p className="text-on-ink/82 max-w-lg text-sm leading-relaxed sm:text-[15px]">
          {waiting ? "We'll email you once you're approved. You can check where it stands on Verification." : WHAT[role]}
        </p>
        <div className="pt-1">
          <Button asChild variant="light" size="lg">
            <Link href="/onboard/">Go to Verification</Link>
          </Button>
        </div>
      </GradientPanel>
    </div>
  );
}
