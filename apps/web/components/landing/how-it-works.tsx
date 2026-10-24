"use client";

import { CircleCheck, type LucideIcon, Receipt, ShieldCheck, Wallet } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { EASE } from "@/components/motion";

const STEP_MS = 7000;

const STEPS: { title: string; detail: string; icon: LucideIcon; image: string; height: number; alt: string }[] = [
  {
    title: "Get verified",
    detail: "Sign in with your email, then a reviewer approves you once. Approval earns you an XRPL credential.",
    icon: ShieldCheck,
    image: "/images/landing/step-verify.jpg",
    height: 900,
    alt: "The verification screen",
  },
  {
    title: "Name the payment",
    detail: "Add the payment reference and documents, and choose someone at your business to approve the loan.",
    icon: Receipt,
    image: "/images/landing/step-details.jpg",
    height: 900,
    alt: "The first step of a new loan: which payment and how much",
  },
  {
    title: "Get the loan",
    detail: "After a reviewer approves it, press one button to get RLUSD in your wallet.",
    icon: Wallet,
    image: "/images/landing/step-paid.jpg",
    height: 900,
    alt: "A funded loan, with the amount to pay back",
  },
  {
    title: "Pay it back with interest",
    detail: "Pay the loan back with interest by the end of its horizon. Then it is closed out.",
    icon: CircleCheck,
    image: "/images/landing/step-closed-out.jpg",
    height: 900,
    alt: "A closed out loan",
  },
];

export function HowItWorks() {
  const [current, setCurrent] = useState(0);
  const reduced = useReducedMotion();

  // advance every few seconds; a click restarts the clock from the chosen step
  useEffect(() => {
    if (reduced) return;
    const t = setTimeout(() => setCurrent((c) => (c + 1) % STEPS.length), STEP_MS);
    return () => clearTimeout(t);
  }, [current, reduced]);

  const step = STEPS[current] ?? STEPS[0]!;

  return (
    <section id="how" className="mx-auto flex w-full max-w-[1440px] scroll-mt-24 flex-col items-stretch gap-8 px-4 py-16 sm:px-6 lg:flex-row lg:gap-0 lg:px-8 lg:py-28">
      <div className="flex w-full flex-col gap-8 p-2 sm:p-6 lg:w-[47%] lg:gap-12 lg:p-10">
        <h2 className="display-type text-3xl sm:text-4xl lg:text-5xl xl:text-6xl">
          How it works
        </h2>
        <p className="text-muted-foreground text-base leading-relaxed font-medium lg:text-lg">
          Verify your identity once. After that, each loan takes three steps. Your wallet is made for you on the XRP Ledger, so you don&apos;t need any crypto setup.</p>
        {/* every step's text sits in a slot of the same height, and the old one closes while the new one opens on the
            same curve, so the list (and the page under it) never changes height as the steps advance */}
        <div role="tablist" aria-label="Steps" className="flex flex-col gap-2 [--detail-h:7rem] sm:[--detail-h:5.5rem] lg:pr-10 lg:[--detail-h:6.5rem] xl:[--detail-h:4.75rem]">
          {STEPS.map((s, i) => {
            const active = i === current;
            const Icon = s.icon;
            return (
              <button
                key={s.title}
                type="button"
                role="tab"
                id={`how-tab-${i}`}
                aria-selected={active}
                aria-controls="how-panel"
                onClick={() => setCurrent(i)}
                className={cn(
                  "relative isolate flex flex-col overflow-hidden rounded-2xl text-left transition-colors duration-300",
                  active
                    ? "text-on-ink noise noise-dark shadow-card"
                    : "text-foreground/80 hover:text-foreground [&:hover_svg]:text-foreground",
                )}
              >
                {/* a glassy top highlight on the dark card */}
                {active ? <span aria-hidden className="from-on-ink/10 pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-linear-to-b to-transparent" /> : null}
                <span className="flex items-center gap-4 px-4 py-3.5 lg:px-5 lg:py-4">
                  <Icon aria-hidden className={cn("size-5 shrink-0", active ? "text-on-ink" : "text-muted-foreground")} strokeWidth={1.8} />
                  <span className="flex-1 text-sm font-semibold sm:text-base lg:text-lg">{s.title}</span>
                  <span className={cn("text-sm font-semibold tabular-nums", active ? "text-on-ink/50" : "text-muted-foreground/70")}>{i + 1}</span>
                </span>
                <span
                  aria-hidden={!active}
                  className={cn(
                    "text-on-ink/75 block overflow-hidden px-4 text-sm leading-relaxed font-medium transition-[height,opacity] duration-[350ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none lg:px-5 lg:text-base",
                    active ? "h-(--detail-h) opacity-100" : "h-0 opacity-0",
                  )}
                >
                  <span className="block pb-5 pl-9">{s.detail}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div id="how-panel" role="tabpanel" aria-labelledby={`how-tab-${current}`} className="noise noise-dark text-on-ink relative flex w-full flex-col overflow-hidden rounded-3xl p-6 sm:p-8 lg:w-[53%] lg:p-12">
        {/* Project One's pixel cloud, tiled small so its squares stay fine */}
        <div aria-hidden className="mask-fade-bottom absolute inset-x-0 top-0 -z-10 h-[386px] bg-[url(/images/landing/how-bg.webp)] bg-size-[520px_auto] bg-top-left bg-repeat-x" />
        <div className="flex min-h-0 flex-1 items-center justify-center">
          {/* one frame the size of the tallest screenshot, so swapping them never resizes the panel; they cross-fade */}
          <div className="relative aspect-[1440/900] w-full max-w-[640px]">
            <AnimatePresence initial={false}>
              <motion.img
                key={step.image}
                src={step.image}
                alt={step.alt}
                width={1440}
                height={step.height}
                className="shadow-card absolute inset-x-0 top-1/2 w-full -translate-y-1/2 rounded-lg lg:rounded-xl"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.45, ease: EASE }}
              />
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
