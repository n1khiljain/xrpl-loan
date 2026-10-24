"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AccountGate } from "@/components/app/account-gate";
import { VerifyFirst } from "@/components/app/verify-first";
import { GradientPanel } from "@/components/app/gradient-panel";
import { ErrorNotice } from "@/components/app/notice";
import { Topbar } from "@/components/app/topbar";
import { cardNumber } from "@/components/brand/claim-card";
import { LiveClaimCard } from "@/components/brand/live-claim-card";
import { EASE, Swap } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCall } from "@/hooks/use-api";
import { ApiError } from "@/lib/api";
import { ASSET } from "@/lib/config";
import { friendlyError } from "@/lib/errors";
import { dateTime, shortAddress, usd } from "@/lib/format";
import type { InviteView } from "@/lib/types";

const BACK = { href: "/claims/?view=guaranties", label: "Sign-offs" };

function Guarantee() {
  const invite = useSearchParams().get("invite");
  const call = useCall();
  const queryClient = useQueryClient();
  const view = useQuery({
    queryKey: ["invite", invite],
    enabled: Boolean(invite),
    queryFn: () => call<InviteView>("guarantor-invite", { query: { invite: invite as string } }),
    retry: false,
    // a used invite answers 410, so don't ask again once this page has it
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const sign = useMutation({
    mutationFn: async () => {
      const data = view.data;
      if (!data?.signable || !data.claim.packetHash) throw new Error("This can't be signed off right now.");
      // the sign-off names the packet hash shown here, so it can't land on a claim that changed since
      await call("guaranty", { method: "POST", body: { claimId: data.claim.id, packetHash: data.claim.packetHash, invite } });
    },
    // the claim lists behind the sidebar's sign-off count, which drops by one. Not the invite: it's used now.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["claims"] }),
  });

  if (!invite) {
    return (
      <div className="space-y-6">
        <Topbar title="Sign-off request" back={BACK} />
        <ErrorNotice title="This link is incomplete">Open the link from your email again.</ErrorNotice>
      </div>
    );
  }
  if (view.isPending) {
    return (
      <div className="space-y-6">
        <Topbar title="Sign-off request" back={BACK} />
        <Skeleton className="h-64 w-full rounded-3xl" />
      </div>
    );
  }
  if (view.isError) {
    const code = view.error instanceof ApiError ? view.error.code : "";
    const message =
      code === "wrong_guarantor"
        ? "This link is for someone else's account. Sign in with the email the link was sent to."
        : code === "expired"
          ? "This link expired. Ask the person who sent it to send a new one."
          : code === "used"
            ? "You already signed off with this link. It's on your Sign-offs list."
            : friendlyError(view.error);
    return (
      <div className="space-y-6">
        <Topbar title="Sign-off request" back={BACK} />
        <ErrorNotice title="We couldn't open this sign-off">{message}</ErrorNotice>
      </div>
    );
  }

  const { claim } = view.data;
  const name = claim.claimantName ?? "Someone at your business";
  const org = claim.orgName ?? "Your business";
  const signed = view.data.signed || sign.isSuccess;

  return (
    <div className="space-y-6 lg:space-y-8">
      <Topbar title="Sign-off request" crumb={claim.orgName ?? undefined} back={BACK} />
      <div className="flex flex-col gap-5 lg:flex-row lg:items-stretch lg:gap-6">
        {/* The ask, and the claim as a card. Once signed, the words and the card swap to say so. */}
        <GradientPanel
          tone="gold"
          className="-mx-4 flex shrink-0 flex-col gap-6 p-6 sm:-mx-6 sm:p-7 lg:mx-0 lg:w-[380px] lg:p-8"
        >
          <span className="text-on-ink/70 text-[13px]" data-testid="expires">
            {signed ? `Signed for ${org}` : `Expires ${dateTime(view.data.expiresAt)}`}
          </span>
          <Swap id={signed ? "signed" : "ask"} className="flex flex-col gap-3">
            <h1 className="display-type max-w-xs text-[28px] lg:text-[36px]">
              {signed ? `You signed off on ${usd(claim.requestedAmount)}` : `${name} is asking you to sign off on ${usd(claim.requestedAmount)}`}
            </h1>
            <p className="text-on-ink/80 max-w-sm text-[15px] leading-relaxed">
              {signed
                ? `${name} can send it for review now. You'll only hear from us if the payment never arrives.`
                : `The lending vault pays ${name} now instead of waiting on the payment. You confirm it will arrive. If it never does, you cover what's left.`}
            </p>
          </Swap>
          <div className="flex justify-center pt-2 lg:mt-auto lg:pt-0">
            <Swap id={signed ? "signed" : "ask"} className="-rotate-6">
              {[
                { scale: 0.62, className: "lg:hidden" },
                { scale: 0.82, className: "hidden lg:block" },
              ].map((size) => (
                <LiveClaimCard
                  key={size.scale}
                  claimId={cardNumber(null)}
                  amount={usd(claim.requestedAmount)}
                  state={signed ? "SIGNED OFF" : "NEEDS YOU"}
                  org={org}
                  tone="frost"
                  moment={signed ? "approved" : null}
                  scale={size.scale}
                  className={size.className}
                />
              ))}
            </Swap>
          </div>
        </GradientPanel>

        {/* The claim, the obligation, and the sign action */}
        <section className="bg-card flex flex-1 flex-col gap-6 rounded-2xl p-5 sm:p-6">
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">The loan</h2>
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
              <span className="text-muted-foreground">Requested by</span>
              <span className="text-right font-semibold">{name}</span>
              <span className="text-muted-foreground">Paid to wallet</span>
              <span className="tabular text-right font-semibold" title={claim.recipientWallet}>
                {shortAddress(claim.recipientWallet)}
              </span>
              <span className="text-muted-foreground">Purchase request amount</span>
              <span className="tabular text-right font-semibold">{usd(claim.faceValue)}</span>
              <span className="text-muted-foreground">Payment reference</span>
              <span className="text-right font-semibold">{claim.callinkPrNumber}</span>
              <span className="text-muted-foreground">Receipts</span>
              <span className="text-right font-semibold">{claim.documentCount}</span>
              <span className="text-muted-foreground">What it was for</span>
              <span className="text-right font-semibold">{claim.description ?? "No description"}</span>
            </div>
          </div>

          <div className="border-border flex flex-col gap-2 rounded-xl border p-4 sm:p-5">
            <span className="text-muted-foreground text-xs font-medium">What you&apos;re agreeing to</span>
            <p className="text-[15px] leading-relaxed font-semibold" data-testid="obligation">
              If the payment never arrives, you pay the vault whatever is left, including interest.
            </p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Signing off costs nothing and isn&apos;t a payment. We&apos;ll email you if you&apos;re ever asked to cover it, and you&apos;d pay in {ASSET}.
            </p>
          </div>

          <div className="mt-auto flex flex-col gap-3">
            {signed ? (
              <motion.div
                className="flex flex-col gap-4"
                data-testid="signed"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
              >
                <div className="flex items-center gap-3">
                  <motion.span
                    className="bg-foreground text-background flex size-10 shrink-0 items-center justify-center rounded-full"
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 420, damping: 22, delay: 0.1 }}
                  >
                    <Check aria-hidden className="size-5" strokeWidth={2.6} />
                  </motion.span>
                  <p className="font-semibold">Signed off. {name} can now send it for review.</p>
                </div>
                <Button variant="secondary" size="lg" asChild>
                  <Link href={`/claim/?id=${claim.id}`}>See the loan</Link>
                </Button>
              </motion.div>
            ) : (
              <>
                <div className="flex flex-col gap-3 sm:flex-row">
                  {/* flex-1 only in a row: in the phone column a zero flex-basis collapses the button's height */}
                  <Button size="lg" className="sm:flex-1" onClick={() => sign.mutate()} disabled={sign.isPending || !view.data.signable} data-testid="sign-guaranty">
                    {sign.isPending ? "Signing..." : "Sign off"}
                  </Button>
                  <Button variant="secondary" size="lg" asChild>
                    <Link href="/claims/">Decline</Link>
                  </Button>
                </div>
                <span className="text-muted-foreground text-center text-xs">A sign-off, not a payment. Nothing moves unless the payment never arrives.</span>
              </>
            )}
            {sign.isError ? <ErrorNotice>{friendlyError(sign.error)}</ErrorNotice> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function GuaranteePage() {
  return (
    <AccountGate reason="Sign in with the email this link was sent to.">
      {(me) =>
        me.profile?.kycStatus !== "approved" ? (
          <div className="space-y-6">
            <Topbar title="Sign-off request" back={BACK} />
            <VerifyFirst status={me.profile?.kycStatus ?? "not_started"} role="officer" />
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="space-y-6">
                <Topbar title="Sign-off request" back={BACK} />
                <Skeleton className="h-64 w-full rounded-3xl" />
              </div>
            }
          >
            <Guarantee />
          </Suspense>
        )
      }
    </AccountGate>
  );
}
