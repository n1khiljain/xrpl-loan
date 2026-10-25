"use client";

import { ArrowRight, ChevronRight, FileText, Handshake, House, type LucideIcon, Plus, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { StateChip } from "@/components/app/state-chip";
import { Stepper } from "@/components/app/stepper";
import { Timeline } from "@/components/app/timeline";
import { ClaimCard } from "@/components/brand/claim-card";
import { WizardAside } from "@/components/claim/wizard-aside";
import { PosterMark } from "@/components/landing/poster-card";
import { EASE } from "@/components/motion";
import { buttonVariants } from "@/components/ui/button";
import { ASSET, params } from "@/lib/config";
import { amountDue, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
 * How it works, after Fieldguide's product row: the four steps of a loan as tabs along the top, underlined in spot
 * orange when chosen. Under them a Night panel carries the chosen step's title, a line, a step chip with its dots, and
 * a call to action, then the app at that step in a frame that runs off the bottom edge. On desktop the
 * tabs and panel pin while the page scrolls, moving to the next step every stretch of scroll; the app screen cross-fades to the next. Every screen is built from
 * the app's own components and copy. They're a picture of the app, not the app, so the window is hidden from screen
 * readers; the tabs say what each step is.
 */

// the same sample loan as the feature cards, inside the per-loan cap
const SAMPLE = 2_400_000_000n;
const ORG = "Northwind Supply";
// pinned under the 72px top bar with a little air, and one viewport-ish of scroll per step
const PIN_TOP = 88;
const STEP_VH = 85;

type StepKey = "verify" | "name" | "loan" | "repay";

const NAV: { label: string; icon: LucideIcon }[] = [
  { label: "Home", icon: House },
  { label: "Expedite a payment", icon: Plus },
  { label: "My loans", icon: FileText },
  { label: "Sign-offs", icon: Handshake },
  { label: "Verification", icon: ShieldCheck },
];

/** The app's ink sidebar, with the page in hand highlighted. */
function Sidebar({ active }: { active: string }) {
  return (
    <div className="bg-ink text-on-ink hidden w-56 shrink-0 flex-col px-4 pt-6 md:flex">
      <span className="display-type px-2 text-2xl">Install</span>
      <span className="eyebrow text-on-ink/50 mx-2 mt-7 mb-2.5">Your loans</span>
      <ul className="flex flex-col gap-0.5">
        {NAV.map(({ label, icon: Icon }) => (
          <li
            key={label}
            className={cn("flex h-11 items-center gap-3 rounded-sm px-3 text-sm", label === active ? "bg-on-ink/10 font-semibold" : "text-on-ink/65 font-medium")}
          >
            <Icon className="size-[18px] shrink-0" strokeWidth={1.7} />
            <span className="truncate">{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The crumb row at the top of an app page. */
function PageTop({ trail, title, meta }: { trail?: string; title: string; meta: string }) {
  return (
    <div className="border-divider flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b px-5 py-4 sm:px-8">
      <span className="flex min-w-0 items-center gap-2 text-sm">
        {trail ? (
          <>
            <span className="text-muted-foreground">{trail}</span>
            <ChevronRight className="text-muted-foreground size-4 shrink-0" />
          </>
        ) : null}
        <span className="text-foreground truncate font-semibold">{title}</span>
      </span>
      <span className="text-muted-foreground text-xs">{meta}</span>
    </div>
  );
}

/** Label and value rows, like the app's loan details. */
function Rows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="divide-divider border-divider divide-y border-y text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-6 py-3">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="tabular text-right font-semibold">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Onboarding: the checklist part way through, waiting on a reviewer. */
function VerifyView() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageTop title="Verification" meta="Reviewer approval next" />
      <div className="flex flex-col gap-6 px-5 pt-6 sm:px-8 sm:pt-8 lg:flex-row lg:gap-10">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <p className="display-type text-2xl">Waiting on a reviewer</p>
          <p className="text-muted-foreground max-w-md text-sm">Your email is verified. A reviewer approves you next, usually within a day. Approval earns you an XRPL credential.</p>
          <span className={cn(buttonVariants({ variant: "outline" }), "mt-2 w-fit")}>Check my status</span>
        </div>
        <div className="border-border w-full max-w-sm rounded-2xl border p-5">
          <Timeline
            steps={[
              { label: "Account created", detail: "maya@northwind.co", status: "done" },
              { label: "Verify your email", detail: "Verified", status: "done" },
              { label: "Reviewer approval", detail: "Usually within a day", status: "current" },
              { label: "Join your business", detail: ORG, status: "upcoming" },
              { label: "Get your first loan", detail: "Or sign off for a teammate", status: "upcoming" },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

/** Step one of "Expedite a payment", with the live preview the wizard shows beside it. */
function BorrowView() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageTop trail="My loans" title="Expedite a payment" meta="Step 1 of 4 · Details" />
      <div className="flex min-h-0 flex-1 gap-8 px-5 pt-6 sm:px-8 sm:pt-8">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <Stepper steps={["Details", "Receipts", "Sign-off", "Review"]} current={0} />
          <div className="space-y-1">
            <p className="display-type text-2xl">Which payment do you want to expedite?</p>
            <p className="text-muted-foreground text-sm">Get an upfront loan instead of waiting. You pay it back with interest based on how long it runs.</p>
          </div>
          <p className="flex items-center gap-2.5 text-sm">
            <span className="bg-surface-muted flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">NS</span>
            <span>
              <span className="text-muted-foreground">For </span>
              <span className="font-semibold">{ORG}</span>
            </span>
          </p>
          <div className="space-y-2">
            <span className="text-sm font-semibold">Amount of the payment</span>
            <div className="border-input bg-surface flex h-16 items-center gap-1 rounded-2xl border pr-2.5 pl-4">
              <span className="money-type text-muted-foreground text-3xl">$</span>
              <span className="money-type text-3xl">2,400.00</span>
            </div>
          </div>
          <div className="space-y-2">
            <span className="text-sm font-semibold">Payment reference</span>
            <div className="border-input bg-surface flex h-12 items-center rounded-full border px-5 text-base font-medium">INV-20418</div>
          </div>
          <span className={cn(buttonVariants({ size: "lg" }), "w-fit pr-2")}>
            Continue
            <span className="bg-surface text-foreground ml-2 flex size-10 items-center justify-center rounded-full">
              <ArrowRight className="size-4" strokeWidth={2.2} />
            </span>
          </span>
        </div>
        <WizardAside org={ORG} requestedUnits={SAMPLE} state="DETAILS" className="hidden w-80 2xl:flex" />
      </div>
    </div>
  );
}

/** An approved loan, one button from being paid out. */
function LoanView() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageTop trail="My loans" title="Loan No. 0014" meta="Approved" />
      <div className="flex flex-col gap-8 px-5 pt-6 sm:px-8 sm:pt-8 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <div className="space-y-2">
            <StateChip state="Approved" />
            <p className="display-type text-2xl">Approved for {usd(SAMPLE)}</p>
            <p className="text-muted-foreground text-sm">A reviewer approved your loan. Press the button and the vault sends {ASSET} to your wallet.</p>
          </div>
          <span className={cn(buttonVariants({ size: "lg" }), "w-fit gap-0 pr-2 pl-5")}>
            Get {usd(SAMPLE)} in {ASSET}
            <span className="bg-surface text-foreground ml-5 flex size-10 items-center justify-center rounded-full">
              <ArrowRight className="size-4" strokeWidth={2.2} />
            </span>
          </span>
          <Rows rows={[["Business", ORG], ["Payment reference", "INV-20418"], ["Signed off by", "Priya, finance"]]} />
        </div>
        <ClaimCard claimId="0014" amount={usd(SAMPLE)} state="APPROVED" org={ORG} tone="sky" scale={0.78} className="hidden self-start xl:block" />
      </div>
    </div>
  );
}

/** A paid loan: what's left, by when, and how far along it is. */
function RepayView() {
  const due = amountDue(SAMPLE, params.feeBps, params.overdueWindowSeconds);
  const days = Math.round(params.overdueWindowSeconds / 86_400);
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageTop trail="My loans" title="Loan No. 0014" meta="Paid" />
      <div className="flex flex-col gap-8 px-5 pt-6 sm:px-8 sm:pt-8 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <div className="space-y-2">
            <StateChip state="Funded" />
            <p className="display-type text-2xl">Pay it back with interest</p>
            <p className="text-muted-foreground text-sm">When the payment arrives, pay the vault back in {ASSET}. Then the loan is closed out.</p>
          </div>
          <Rows rows={[["Left to pay back", usd(due)], ["Paid back so far", usd(0n)], ["Pay back by", `${days} days after the payment arrives`]]} />
          <div className="border-border max-w-sm rounded-2xl border p-5">
            <Timeline
              steps={[
                { label: "Sent for review", detail: "Signed off by Priya", status: "done" },
                { label: "Approved", detail: `For ${usd(SAMPLE)}`, status: "done" },
                { label: "You got paid", detail: `${usd(SAMPLE)} ${ASSET}`, status: "done" },
                { label: "Paid back, closed out", status: "current" },
              ]}
            />
          </div>
        </div>
        <ClaimCard claimId="0014" amount={usd(SAMPLE)} state="PAID" org={ORG} tone="deep" scale={0.78} className="hidden self-start xl:block" />
      </div>
    </div>
  );
}

const STEPS: { key: StepKey; tab: string; title: string; detail: string; page: string; cta: { label: string; href: string }; Screen: () => React.ReactNode }[] = [
  {
    key: "verify",
    tab: "Get verified",
    title: "Get verified",
    detail: "Sign in with your email, then a reviewer approves you once. Approval earns you an XRPL credential.",
    page: "Verification",
    cta: { label: "Get started", href: "/onboard/" },
    Screen: VerifyView,
  },
  {
    key: "name",
    tab: "Name the payment",
    title: "Name the payment",
    detail: "Add the payment reference and documents, and choose someone at your business to approve the loan.",
    page: "Expedite a payment",
    cta: { label: "Expedite a payment", href: "/claims/new/" },
    Screen: BorrowView,
  },
  {
    key: "loan",
    tab: "Get the loan",
    title: "Get the loan",
    detail: `After a reviewer approves it, press one button and the vault sends ${ASSET} to your wallet.`,
    page: "My loans",
    cta: { label: "See my loans", href: "/claims/?view=claims" },
    Screen: LoanView,
  },
  {
    key: "repay",
    tab: "Pay it back",
    title: "Pay it back with interest",
    detail: "Pay the loan back with interest by the end of its horizon. Then it's closed out.",
    page: "My loans",
    cta: { label: "See my loans", href: "/claims/?view=claims" },
    Screen: RepayView,
  },
];

export function ProductShowcase() {
  const [at, setAt] = useState(0);
  const step = STEPS[at] ?? STEPS[0]!;
  const pin = useRef<HTMLDivElement>(null);
  // on desktop the tabs and panel pin under the top bar while the page scrolls through the steps, one step per
  // stretch of scroll; on phones, tablets, and under reduced motion they're ordinary tabs
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPinned(wide.matches && !reduced.matches);
    update();
    wide.addEventListener("change", update);
    reduced.addEventListener("change", update);
    return () => {
      wide.removeEventListener("change", update);
      reduced.removeEventListener("change", update);
    };
  }, []);

  /** How far through the pinned stretch the page is, 0 to 1. */
  const progress = () => {
    const el = pin.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const travel = rect.height - window.innerHeight + PIN_TOP;
    return { rect, travel, p: travel > 0 ? Math.min(1, Math.max(0, (PIN_TOP - rect.top) / travel)) : 0 };
  };

  useEffect(() => {
    if (!pinned) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const state = progress();
        if (state) setAt(Math.min(STEPS.length - 1, Math.floor(state.p * STEPS.length)));
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [pinned]);

  /** Choose a step: when pinned, scroll the page to the middle of that step's stretch; otherwise just show it. */
  const go = (i: number) => {
    const state = pinned ? progress() : null;
    if (!state) return setAt(i);
    const target = window.scrollY + state.rect.top - PIN_TOP + ((i + 0.5) / STEPS.length) * state.travel;
    window.scrollTo({ top: target, behavior: "smooth" });
  };
  return (
    <section id="how" aria-labelledby="how-title" className="bg-surface w-full scroll-mt-24">
      <div id="product" className="mx-auto flex w-full max-w-[1440px] scroll-mt-24 flex-col gap-10 px-4 py-16 sm:px-6 lg:gap-16 lg:px-10 lg:py-28">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:gap-12">
          <h2 id="how-title" className="display-type max-w-[16ch] text-[clamp(2rem,4vw,3.25rem)]">
            How it works
          </h2>
          <p className="text-muted-foreground max-w-md text-base leading-relaxed sm:text-lg">
            Verify your identity once. After that, each loan takes three steps. Your wallet is made for you on the XRP
            Ledger, so you don&apos;t need any crypto setup.
          </p>
        </div>

        {/* pinned: a tall stretch of page, one viewport per step, with the tabs and panel stuck under the top bar */}
        <div ref={pin} style={pinned ? { height: `calc(${STEPS.length} * ${STEP_VH}vh)` } : undefined}>
        <div
          className={cn("flex flex-col gap-4", pinned && "sticky")}
          style={pinned ? { top: PIN_TOP, height: `calc(100vh - ${PIN_TOP + 24}px)` } : undefined}
        >
          {/* the steps as tabs along the top, underlined in spot orange when chosen; they scroll sideways on phones */}
          <div role="tablist" aria-label="Steps" className="-mx-4 flex gap-3 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-4 sm:px-0 [&::-webkit-scrollbar]:hidden">
            {STEPS.map((s, i) => {
              const on = i === at;
              return (
                <button
                  key={s.key}
                  type="button"
                  role="tab"
                  id={`how-tab-${s.key}`}
                  aria-selected={on}
                  aria-controls="how-panel"
                  onClick={() => go(i)}
                  className={cn(
                    "shrink-0 border-b-2 pb-3 text-center text-base whitespace-nowrap transition-colors sm:text-lg lg:text-xl",
                    on ? "text-foreground border-[var(--spot)]" : "text-muted-foreground hover:text-foreground border-border",
                  )}
                >
                  {s.tab}
                </button>
              );
            })}
          </div>

          <div id="how-panel" role="tabpanel" aria-labelledby={`how-tab-${step.key}`} className={cn("bg-ink text-on-ink relative isolate overflow-hidden rounded-3xl", pinned && "min-h-0 flex-1")}>
            {/* the title, line, and chip change in place; only the app screen below fades to the next step */}
            <div className={cn("mx-auto flex w-full max-w-[1120px] flex-col px-4 pt-10 sm:px-8 lg:pt-14", pinned && "h-full")}>
              <h3 className="display-type text-[clamp(1.75rem,3vw,2.5rem)]">{step.title}</h3>
              <p className="text-on-ink/75 mt-3 max-w-[52ch] text-lg leading-snug sm:text-xl">{step.detail}</p>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
                {/* the step chip, then a dot per step with the one in hand lit */}
                <span className="flex items-center gap-3">
                  <span className="bg-on-ink/12 flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm">
                    <PosterMark index={at} tone="night" className="mt-0 size-3.5 gap-px" />
                    Step {at + 1}
                  </span>
                  <span aria-hidden className="flex gap-1.5">
                    {STEPS.map((s, i) => (
                      <span key={s.key} className={cn("size-1.5 rounded-full", i === at ? "bg-[var(--spot)]" : "bg-on-ink/25")} />
                    ))}
                  </span>
                </span>
                <Link href={step.cta.href} className={cn(buttonVariants(), "bg-[var(--spot)] text-on-ink hover:bg-[var(--spot)]/90")}>
                  {step.cta.label}
                </Link>
              </div>
              {/* the app at this step, framed, running off the bottom edge. The bezel's corner is the screen's 20px radius
                  plus its 8px of padding, so the two curves stay concentric */}
              <div aria-hidden className={cn("bg-on-ink/10 mt-8 rounded-t-[28px] p-2 pb-0 lg:mt-10", pinned ? "min-h-0 flex-1" : "h-[520px] lg:h-[600px]")}>
                <div className="bg-surface text-foreground relative h-full overflow-hidden rounded-t-2xl">
                  <AnimatePresence initial={false}>
                    <motion.div
                      key={step.key}
                      className="absolute inset-0 flex"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.45, ease: EASE }}
                    >
                      <Sidebar active={step.page} />
                      <step.Screen />
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>
    </section>
  );
}

// the closing still's loans: one paid out, one approved, one in review, so the list shows the states at a glance
const RECENT: { ref: string; units: bigint; state: "Funded" | "Approved" | "Submitted" }[] = [
  { ref: "INV-20418", units: SAMPLE, state: "Funded" },
  { ref: "INV-20431", units: 1_150_000_000n, state: "Approved" },
  { ref: "INV-20447", units: 860_000_000n, state: "Submitted" },
];

/** A calm home screen for the closing still: what's out on loan, and the latest loans in one tidy list. */
function PreviewHome() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageTop title="Home" meta={ORG} />
      <div className="flex flex-col gap-8 px-5 pt-6 sm:px-8 sm:pt-8">
        <div className="flex items-end justify-between gap-6">
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-sm">On loan to you</span>
            <span className="money-type text-4xl">{usd(SAMPLE)}</span>
          </div>
          <span className={cn(buttonVariants({ size: "sm" }), "hidden shrink-0 xl:inline-flex")}>
            <Plus className="size-4" strokeWidth={2.2} />
            Expedite a payment
          </span>
        </div>
        <div className="flex flex-col gap-3">
          <span className="text-sm font-semibold">Recent loans</span>
          <ul className="border-border divide-divider divide-y rounded-2xl border">
            {RECENT.map((loan) => (
              <li key={loan.ref} className="flex items-center justify-between gap-4 px-4 py-4 text-sm whitespace-nowrap sm:px-5">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="bg-surface-muted flex size-8 shrink-0 items-center justify-center rounded-full">
                    <FileText className="size-4" strokeWidth={1.7} />
                  </span>
                  <span className="truncate font-semibold">{loan.ref}</span>
                </span>
                <span className="flex items-center gap-4">
                  <span className="tabular font-semibold">{usd(loan.units)}</span>
                  <StateChip state={loan.state} className="hidden sm:inline-flex" />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** One still of the app, framed in a light bezel, for the page's closing call to action. */
export function AppPreview({ className }: { className?: string }) {
  return (
    // the bezel's corner is the screen's 20px radius plus its 8px of padding, as in the showcase above
    <div aria-hidden className={cn("bg-divider rounded-t-[28px] p-2 pb-0", className)}>
      <div className="bg-surface text-foreground flex h-full overflow-hidden rounded-t-2xl">
        <Sidebar active="Home" />
        <PreviewHome />
      </div>
    </div>
  );
}
