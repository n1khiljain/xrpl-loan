"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { ReceivableCardTone } from "@/components/brand/receivable-card";
import { type CardMoment, LiveReceivableCard } from "@/components/brand/live-receivable-card";
import { EASE } from "@/components/motion";
import { cn } from "@/lib/utils";

const STEP_MS = 2600;

// the app's own loan card, walked through the states a borrower sees (labels and colors match state-chip.tsx)
const STAGES: { state: string; label: string; tone: ReceivableCardTone; moment?: CardMoment; caption: string }[] = [
  { state: "IN REVIEW", label: "In review", tone: "frost", caption: "Your approver signed off. Install and your finance team check the payment." },
  { state: "APPROVED", label: "Approved", tone: "sky", moment: "approved", caption: "The vault is ready to pay you." },
  { state: "PAID", label: "Paid", tone: "deep", moment: "paid", caption: "The vault pays you within a day." },
  { state: "CLOSED OUT", label: "Closed out", tone: "gold", moment: "closed", caption: "The payment arrives, you pay the loan back with interest, and you're done." },
];

type Stage = (typeof STAGES)[number];

// every card in the deck is held at 0 degrees on all three axes
const UPRIGHT = { rotate: 0, rotateX: 0, rotateY: 0 } as const;

/** Where each place in the deck sits: every card upright, the top one in front, the rest stepping back up and right. */
const PLACES = [
  { x: 0, y: 0, scale: 1 },
  { x: 16, y: -12, scale: 0.95 },
  { x: 30, y: -22, scale: 0.9 },
  { x: 42, y: -30, scale: 0.85 },
] as const;

/**
 * One card in the deck. When the top card's turn ends it's dealt off to the left and slipped back under the stack, so
 * the deck reads as being shuffled; every other card steps forward one place. Only the top card plays its moment.
 */
function DeckCard({ stage, depth, reduced }: { stage: Stage; depth: number; reduced: boolean }) {
  const place = PLACES[depth] ?? PLACES[PLACES.length - 1]!;
  const back = PLACES.length - 1;
  // the deck only ever moves forward a card at a time, so the card at the back is the one just dealt off the top
  const dealt = depth === back;
  const z = PLACES.length - depth;
  // pinned flat on every move, so a card that comes to the front is always square on, never left at an angle
  return (
    <motion.div
      aria-hidden={depth !== 0}
      className="absolute inset-0"
      style={{ rotate: 0, rotateX: 0, rotateY: 0 }}
      initial={false}
      animate={
        dealt && !reduced
          ? {
              x: [0, -50, -50, place.x],
              y: [0, 16, 16, place.y],
              scale: [1, 0.96, 0.96, place.scale],
              zIndex: [PLACES.length + 1, PLACES.length + 1, 0, z],
              ...UPRIGHT,
            }
          : { ...place, zIndex: z, ...UPRIGHT }
      }
      transition={
        reduced ? { duration: 0 } : dealt ? { duration: 0.9, times: [0, 0.4, 0.45, 1], ease: EASE } : { type: "spring", stiffness: 240, damping: 28, mass: 0.9 }
      }
    >
      <LiveReceivableCard
        receivableId="0014"
        amount="$240.00"
        amountValue={240}
        state={stage.state}
        org="Northwind Supply"
        tone={stage.tone}
        moment={depth === 0 ? stage.moment : null}
        className={cn("transition-shadow", depth === 0 ? "drop-shadow-2xl" : "")}
      />
    </motion.div>
  );
}

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
    // the heading, the states, and the caption for the one in hand on the left; on the same line to their right, the deck
    <div ref={ref} className="grid w-full max-w-6xl items-center gap-16 px-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-24">
      <h2 className="display-type text-on-ink text-[clamp(2rem,4vw,3.25rem)] lg:hidden">From request to funded, in a day</h2>

      {/* grows in on a soft spring the first time it scrolls into view, like the dashboard shot on the first landing */}
      <motion.div
        className="relative h-[320px] w-[224px] sm:h-[400px] sm:w-[280px] lg:order-2 lg:mr-10 lg:justify-self-end"
        initial={{ scale: 0.6, opacity: 0 }}
        whileInView={{ scale: 1, opacity: 1 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ scale: { type: "spring", stiffness: 80, damping: 18, mass: 1.5 }, opacity: { duration: 0.8, ease: EASE } }}
      >
        {/* the four states as one deck, and clicking it deals the next card; on phones the whole deck is drawn at 80% */}
        <button
          type="button"
          aria-label={`Show the next state: ${(STAGES[(current + 1) % STAGES.length] ?? STAGES[0]!).label}`}
          onClick={() => setCurrent((c) => (c + 1) % STAGES.length)}
          className="absolute inset-0 block origin-top scale-[0.8] cursor-pointer rounded-3xl focus-visible:ring-[3px] focus-visible:ring-on-ink/40 focus-visible:outline-none sm:scale-100"
        >
          {STAGES.map((s, i) => (
            <DeckCard key={s.state} stage={s} depth={(i - current + STAGES.length) % STAGES.length} reduced={Boolean(reduced)} />
          ))}
        </button>
      </motion.div>

      {/* on desktop the column runs the deck's full height: the heading meets the card's top, the states and their line its bottom */}
      <div className="flex w-full flex-col gap-8 lg:order-1 lg:gap-10 lg:self-stretch lg:justify-between">
        <h2 className="display-type text-on-ink hidden max-w-[16ch] text-[clamp(2rem,4vw,3.25rem)] text-balance lg:block">From request to funded, in a day</h2>
        <div className="flex w-full flex-col gap-8">
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
                  {/* the state in hand fills in spot orange; the ones already passed stay white */}
                  <span
                    className={cn(
                      "absolute inset-y-0 left-0 transition-[width,background-color] duration-500",
                      i < current ? "bg-on-ink w-full" : i === current ? "w-full bg-[var(--spot)]" : "w-0",
                    )}
                  />
                </span>
                <span className={cn("text-xs font-medium transition-colors sm:text-sm", i === current ? "text-on-ink" : "text-on-ink/50 group-hover:text-on-ink/75")}>
                  {s.label}
                </span>
              </button>
            ))}
          </div>
          {/* the state in hand is named by its tab above, so only its line follows, soft white on the Night */}
          <p aria-live="polite" className="text-on-ink/75 w-full text-lg leading-snug sm:text-xl">
            {stage.caption}
          </p>
        </div>
      </div>
    </div>
  );
}