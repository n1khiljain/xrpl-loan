"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { ReceivableCardTone } from "@/components/brand/receivable-card";
import { type CardMoment, LiveReceivableCard } from "@/components/brand/live-receivable-card";
import { EASE, Swap } from "@/components/motion";
import { cn } from "@/lib/utils";

const STEP_MS = 2600;

// the app's own loan card, walked through the states a borrower sees (labels and colors match state-chip.tsx)
const STAGES: { state: string; label: string; tone: ReceivableCardTone; moment?: CardMoment; caption: string }[] = [
  { state: "IN REVIEW", label: "In review", tone: "frost", caption: "Your approver signed off. A reviewer checks the payment." },
  { state: "APPROVED", label: "Approved", tone: "sky", moment: "approved", caption: "Approved. The vault is ready to pay you." },
  { state: "PAID", label: "Paid", tone: "deep", moment: "paid", caption: "The vault pays you within a day." },
  { state: "CLOSED OUT", label: "Closed out", tone: "gold", moment: "closed", caption: "The payment arrives, you pay the loan back with interest, and you're done." },
];

/** One loan, start to finish. Advances on its own while on screen; the steps are also buttons. */
export function CardJourney() {
  const [current, setCurrent] = useState(0);
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.5 });

  useEffect(() => {
    if (reduced || !inView) return;
    const t = setTimeout(() => setCurrent((c) => (c + 1) % STAGES.length), STEP_MS);
    return () => clearTimeout(t);
  }, [current, reduced, inView]);

  const stage = STAGES[current] ?? STAGES[0]!;

  return (
    <div ref={ref} className="flex w-full max-w-4xl flex-col items-center gap-10 px-4 lg:gap-14">
      <h2 className="display-type text-center text-3xl sm:text-4xl lg:text-5xl xl:text-6xl">From request to funded, in a day</h2>

      {/* grows in on a soft spring the first time it scrolls into view, like the dashboard shot on the first landing */}
      <motion.div
        className="relative h-[320px] w-[224px] sm:h-[400px] sm:w-[280px]"
        initial={{ scale: 0.6, opacity: 0 }}
        whileInView={{ scale: 1, opacity: 1 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ scale: { type: "spring", stiffness: 80, damping: 18, mass: 1.5 }, opacity: { duration: 0.8, ease: EASE } }}
      >
        <Swap id={stage.state} className="absolute inset-0 origin-bottom">
          {[
            { scale: 1, className: "hidden sm:block" },
            { scale: 0.8, className: "sm:hidden" },
          ].map((size) => (
            <LiveReceivableCard
              key={size.scale}
              receivableId="0014"
              amount="$240.00"
              amountValue={240}
              state={stage.state}
              org="Northwind Supply"
              tone={stage.tone}
              moment={stage.moment}
              scale={size.scale}
              className={size.className}
            />
          ))}
        </Swap>
      </motion.div>

      <div className="flex w-full flex-col items-center gap-5">
        <div role="tablist" aria-label="Loan states" className="grid w-full grid-cols-4 gap-2 sm:gap-3">
          {STAGES.map((s, i) => (
            <button
              key={s.state}
              type="button"
              role="tab"
              aria-selected={i === current}
              onClick={() => setCurrent(i)}
              className="group flex flex-col gap-2 text-left"
            >
              <span className="bg-on-ink/15 relative h-1 overflow-hidden rounded-full">
                <span className={cn("bg-on-ink absolute inset-y-0 left-0 transition-[width] duration-500", i <= current ? "w-full" : "w-0")} />
              </span>
              <span className={cn("text-xs font-semibold transition-colors sm:text-sm", i === current ? "text-on-ink" : "text-on-ink/45 group-hover:text-on-ink/70")}>
                {s.label}
              </span>
            </button>
          ))}
        </div>
        <p aria-live="polite" className="text-on-ink/70 min-h-[3.5em] max-w-xl text-center text-base leading-relaxed sm:text-lg">
          {stage.caption}
        </p>
      </div>
    </div>
  );
}
