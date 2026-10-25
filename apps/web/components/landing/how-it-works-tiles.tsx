"use client";

import { CircleCheck, type LucideIcon, Receipt, ShieldCheck, Wallet } from "lucide-react";
import { useInView, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { StateChip } from "@/components/app/state-chip";
import { Timeline } from "@/components/app/timeline";
import { ReceivableCard } from "@/components/brand/receivable-card";
import { LiquidPill } from "@/components/landing/liquid-pill";
import { ASSET, params } from "@/lib/config";
import { amountDue, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
 * The earlier take on How it works, kept to switch back to: swap HowItWorks for HowItWorksTiles in app/page.tsx.
 *
 * How it works as four tiles, after smallest.ai's case-study row: the heading on the left, the tiles in a row on the
 * right. The spotlighted step's tile opens wide and the rest fold to a narrow strip; every few seconds the next tile
 * opens and squeezes the one before it closed. A click (or focus) opens a tile and restarts the clock from there.
 * Each tile sits on the product frame's grey field and dots, and the open one shows its step on the liquid glass pill
 * and a piece of the real app.
 */

const STEP_MS = 7000;

// the same sample loan as the sections above, inside the per-loan cap
const SAMPLE = 2_400_000_000n;

/** The verification checklist from onboarding, part way through. */
export function VerifyPreview() {
  return (
    <div className="bg-surface border-border shadow-float w-full max-w-sm rounded-2xl border p-5">
      <Timeline
        steps={[
          { label: "Account created", detail: "maya@northwind.co", status: "done" },
          { label: "Verify your email", detail: "Verified", status: "done" },
          { label: "Reviewer approval", detail: "Usually within a day", status: "current" },
          { label: "Get your first loan", detail: "Or sign off for a teammate", status: "upcoming" },
        ]}
      />
    </div>
  );
}

/** The amount and payment reference from the first step of a loan request. */
export function PaymentPreview() {
  return (
    <div className="bg-surface border-border shadow-float flex w-full max-w-sm flex-col gap-4 rounded-2xl border p-5">
      <div className="space-y-2">
        <span className="text-sm font-semibold">Amount of the payment</span>
        <div className="border-input flex h-14 items-center gap-1 rounded-full border px-5">
          <span className="money-type text-muted-foreground text-2xl">$</span>
          <span className="money-type text-2xl">2,400.00</span>
        </div>
      </div>
      <div className="space-y-2">
        <span className="text-sm font-semibold">Payment reference</span>
        <div className="border-input flex h-11 items-center rounded-full border px-5 text-sm font-medium">INV-20418</div>
      </div>
    </div>
  );
}

/** The loan card, paid out. */
export function LoanPreview() {
  return <ReceivableCard receivableId="0014" amount={usd(SAMPLE)} state="PAID" org="Northwind Supply" tone="deep" scale={0.72} className="-rotate-6" />;
}

/** What's due, then the loan closed out. */
export function RepayPreview() {
  const due = amountDue(SAMPLE, params.feeBps, params.overdueWindowSeconds);
  return (
    <div className="bg-surface border-border shadow-float flex w-full max-w-sm flex-col overflow-hidden rounded-2xl border text-sm">
      <div className="flex items-end justify-between gap-4 p-5">
        <span className="text-muted-foreground">You pay back, at most</span>
        <span className="money-type text-2xl">{usd(due)}</span>
      </div>
      <div className="border-divider flex items-center justify-between gap-4 border-t px-5 py-4">
        <StateChip state="Settled" />
        <span className="text-muted-foreground">Paid back in {ASSET}</span>
      </div>
    </div>
  );
}

const STEPS: { title: string; detail: string; icon: LucideIcon; preview: ReactNode }[] = [
  {
    title: "Get verified",
    detail: "Sign in with your email, then a reviewer approves you once. Approval earns you an XRPL credential.",
    icon: ShieldCheck,
    preview: <VerifyPreview />,
  },
  {
    title: "Name the payment",
    detail: "Add the payment reference and documents, and choose someone at your business to approve the loan.",
    icon: Receipt,
    preview: <PaymentPreview />,
  },
  {
    title: "Get the loan",
    detail: `After a reviewer approves it, press one button to get ${ASSET} in your wallet.`,
    icon: Wallet,
    preview: <LoanPreview />,
  },
  {
    title: "Pay it back with interest",
    detail: "Pay the loan back with interest by the end of its horizon. Then it's closed out.",
    icon: CircleCheck,
    preview: <RepayPreview />,
  },
];

export function HowItWorksTiles() {
  const [current, setCurrent] = useState(0);
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });

  // advance while the tiles are on screen; choosing a tile restarts the clock from it
  useEffect(() => {
    if (reduced || !inView) return;
    const t = setTimeout(() => setCurrent((c) => (c + 1) % STEPS.length), STEP_MS);
    return () => clearTimeout(t);
  }, [current, reduced, inView]);

  return (
    <section id="how" className="bg-surface w-full scroll-mt-24">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-10 px-4 pb-16 sm:px-6 lg:flex-row lg:items-center lg:gap-16 lg:px-10 lg:pb-28">
        <div className="flex flex-col gap-5 lg:w-[30%] lg:shrink-0">
          <h2 className="display-type max-w-[14ch] text-[clamp(2rem,4vw,3.25rem)]">How it works</h2>
          <p className="text-muted-foreground max-w-md text-base leading-relaxed sm:text-lg">
            Verify once. After that, each loan takes three steps, and every payout and repayment settles on the XRP Ledger.
          </p>
        </div>

        <div ref={ref} className="flex h-[860px] w-full min-w-0 flex-col gap-3 sm:h-[760px] lg:h-[560px] lg:flex-1 lg:flex-row">
          {STEPS.map((step, i) => {
            const open = i === current;
            const Icon = step.icon;
            return (
              <button
                key={step.title}
                type="button"
                aria-expanded={open}
                aria-label={`Step ${i + 1}: ${step.title}`}
                onClick={() => setCurrent(i)}
                onFocus={() => setCurrent(i)}
                className={cn(
                  "bg-grad-showcase border-border relative isolate flex min-h-0 min-w-0 flex-col overflow-hidden border text-left",
                  "transition-[flex-grow] duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
                  open ? "grow-[7]" : "grow cursor-pointer",
                )}
                style={{ flexBasis: 0 }}
              >
                <span aria-hidden className="showcase-dots pointer-events-none absolute inset-0 -z-10" />

                {/* the folded strip: icon and number, with the title running up the strip on desktop */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-0 flex items-center gap-4 p-5 transition-opacity duration-300 lg:flex-col lg:items-start lg:justify-between lg:p-6",
                    open ? "pointer-events-none opacity-0" : "opacity-100 delay-300",
                  )}
                >
                  <Icon className="text-muted-foreground size-5 shrink-0" strokeWidth={1.8} />
                  <span className="text-foreground font-display font-normal text-lg leading-tight lg:rotate-180 lg:text-xl lg:[writing-mode:vertical-rl]">{step.title}</span>
                  <span className="text-muted-foreground ml-auto text-sm font-semibold tabular-nums lg:ml-0">{i + 1}</span>
                </span>

                {/* the open tile: step, preview, then the title and detail along the bottom */}
                <span
                  aria-hidden={!open}
                  className={cn(
                    "flex h-full min-w-[min(100%,420px)] flex-col p-5 transition-opacity duration-500 sm:p-7 lg:p-8",
                    open ? "opacity-100 delay-200" : "pointer-events-none opacity-0",
                  )}
                >
                  <LiquidPill padding="7px 14px" className="self-start">
                    <span className="flex items-center gap-2 text-sm font-medium whitespace-nowrap">
                      <Icon className="size-4" strokeWidth={1.8} />
                      Step {i + 1}
                    </span>
                  </LiquidPill>
                  <span aria-hidden className="flex min-h-0 flex-1 items-center justify-center py-6">
                    {step.preview}
                  </span>
                  <span className="font-display font-normal text-foreground text-[clamp(1.625rem,2.4vw,2.25rem)] leading-[1.12] tracking-[-0.02em]">{step.title}</span>
                  <span className="text-muted-foreground mt-3 max-w-[46ch] text-base leading-relaxed sm:text-lg">{step.detail}</span>
                </span>

                {/* how long until the next tile opens */}
                {open && !reduced ? (
                  <span aria-hidden className="bg-divider absolute inset-x-0 bottom-0 h-0.5">
                    <span key={`${current}-${inView}`} className={cn("bg-foreground block h-full origin-left", inView ? "step-progress" : "scale-x-0")} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
