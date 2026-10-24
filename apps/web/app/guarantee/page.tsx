"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useSignTypedData } from "wagmi";
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
import { config, deployedContracts } from "@/lib/config";
import { friendlyError } from "@/lib/errors";
import { dateTime, shortAddress, usd } from "@/lib/format";
import { GUARANTY_TTL_SECONDS, guarantyTypedData } from "@/lib/guaranty";
import { useSession } from "@/lib/session/context";
import type { InviteView } from "@/lib/types";

const BACK = { href: "/claims/?view=guaranties", label: "Sign-offs" };

function Guarantee() {
  const invite = useSearchParams().get("invite");
  const call = useCall();
  const queryClient = useQueryClient();
  const session = useSession();
  const { signTypedDataAsync } = useSignTypedData();
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
      const nonce = data?.typedData?.message.nonce;
      const deployed = deployedContracts();
      if (!data || !nonce || !data.claim.packetHash || !session.address || !deployed) throw new Error("This can't be signed right now.");
      // built here from config and the claim on screen, never taken from the server (E-3a)
      const typed = guarantyTypedData({
        chainId: config.chainId,
        registry: deployed.claimRegistry,
        guarantor: session.address,
        claim: { ...data.claim, packetHash: data.claim.packetHash },
        nonce: BigInt(nonce),
        deadline: BigInt(Math.floor(Date.now() / 1000) + GUARANTY_TTL_SECONDS),
      });
      const signature = await signTypedDataAsync(typed);
      await call("guaranty", {
        method: "POST",
        body: { claimId: data.claim.id, signature, nonce: typed.message.nonce.toString(), deadline: typed.message.deadline.toString(), invite },
      });
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
  const name = claim.claimantName ?? "A member of your org";
  const org = claim.orgName ?? "Your org";
  const signed = view.data.signed || sign.isSuccess;

  return (
    <div className="space-y-6 lg:space-y-8">
      <Topbar title="Sign-off request" crumb={claim.orgName ?? undefined} back={BACK} />
      <div className="flex flex-col gap-5 lg:flex-row lg:items-stretch lg:gap-6">
        {/* The ask, and the claim as a card. Once signed, the words and the card swap to say so (U-75). */}
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
                ? `${name} can send it for review now. You'll only hear from us if ASUC never pays.`
                : `Frax pays ${name} now instead of waiting on ASUC. You vouch that ASUC will pay. If ASUC never does, you cover what's left.`}
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
            <h2 className="text-lg font-semibold">The reimbursement</h2>
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
              <span className="text-muted-foreground">Requested by</span>
              <span className="text-right font-semibold">{name}</span>
              <span className="text-muted-foreground">Paid to wallet</span>
              <span className="tabular text-right font-semibold" title={claim.recipientWallet}>
                {shortAddress(claim.recipientWallet)}
              </span>
              <span className="text-muted-foreground">Purchase request amount</span>
              <span className="tabular text-right font-semibold">{usd(claim.faceValue)}</span>
              <span className="text-muted-foreground">CalLink request</span>
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
              If ASUC never pays this, you pay Frax whatever is left.
            </p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Signing costs nothing and isn&apos;t a payment. We&apos;ll email you if you&apos;re ever asked to cover it, and you pay in frxUSD.
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
                  <Link href={`/claim/?id=${claim.id}`}>See the reimbursement</Link>
                </Button>
              </motion.div>
            ) : (
              <>
                <div className="flex flex-col gap-3 sm:flex-row">
                  {/* flex-1 only in a row: in the phone column a zero flex-basis collapses the button's height */}
                  <Button size="lg" className="sm:flex-1" onClick={() => sign.mutate()} disabled={sign.isPending || !view.data.typedData} data-testid="sign-guaranty">
                    {sign.isPending ? "Signing..." : "Sign off"}
                  </Button>
                  <Button variant="secondary" size="lg" asChild>
                    <Link href="/claims/">Decline</Link>
                  </Button>
                </div>
                <span className="text-muted-foreground text-center text-xs">A signature, not a payment. Nothing moves unless ASUC doesn&apos;t pay.</span>
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
            <VerifyFirst status={me.profile?.kycStatus ?? "not_started"} role="officer" wallet={me.profile?.wallet} />
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
