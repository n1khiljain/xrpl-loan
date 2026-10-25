"use client";

import { Minus, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { GlyphField, type ShapeName } from "@/components/landing/glyph-field";
import { config, params } from "@/lib/config";
import { amountDue, usd } from "@/lib/format";

// the cost answer's worked example, from the deployment's rate: $1,000 for 30 days
const EXAMPLE_LOAN = 1_000_000_000n;
const EXAMPLE_INTEREST = amountDue(EXAMPLE_LOAN, params.feeBps, 30 * 86_400) - EXAMPLE_LOAN;
const MAX_DAYS = Math.floor(params.overdueWindowSeconds / 86_400);

const FAQ = [
  {
    q: "What is Install?",
    a: "Install lets a business expedite a transaction, transfer, or payment. You get an upfront loan from a lending vault on the XRP Ledger, and you pay it back with interest based on how long the loan runs.",
  },
  {
    q: "What does it cost?",
    a: `Interest is ${config.params.feeBps / 100}% a year, charged only for the days the loan runs, so a $1,000 loan for 30 days costs about ${usd(EXAMPLE_INTEREST)}. Loans go up to ${usd(params.perReceivableCap).replace(/\.00$/, "")} and up to ${MAX_DAYS} days. The app covers XRP Ledger network costs.`,
  },
  { q: "What if the payment never arrives?", a: "Report it in the app. The person who signed off covers what was not paid." },
  { q: "Who holds my documents?", a: "Only you, the people who sign off at your business, and Install's reviewers can see your documents. The documents themselves never go on the ledger." },
] as const;

// each question's icon, in the same glyphs as the cards: the vault's drop, the clock for cost over time, the signed
// sign-off for a payment that never arrives, and the receipt for documents
const GLYPHS: ShapeName[] = ["drop", "clock", "pen", "receipt"];

export function Faq() {
  const [open, setOpen] = useState(0);

  return (
    <section id="faq" className="mx-auto w-full max-w-[1440px] scroll-mt-24 px-4 py-16 sm:px-6 lg:px-10 lg:py-28">
      <div className="flex flex-col justify-between gap-6 lg:flex-row lg:gap-12">
        <h2 className="display-type max-w-[16ch] text-[clamp(2rem,4vw,3.25rem)]">Frequently asked questions</h2>
        <p className="text-muted-foreground max-w-md text-base leading-relaxed sm:text-lg">Common questions from businesses.</p>
      </div>

      <div className="mt-10 flex flex-col gap-4 lg:mt-16">
        {FAQ.map((item, i) => {
          const isOpen = open === i;
          return (
            // the whole card toggles; the button's own click (mouse or keyboard) bubbles up to here.
            // selecting answer text to copy it shouldn't close the card
            <div
              key={item.q}
              onClick={() => {
                if (window.getSelection()?.toString()) return;
                setOpen(isOpen ? -1 : i);
              }}
              className="bg-divider cursor-pointer rounded-3xl p-6 sm:p-8"
            >
              <h3>
                <button
                  type="button"
                  id={`faq-q-${i}`}
                  aria-expanded={isOpen}
                  aria-controls={`faq-a-${i}`}
                  className="flex w-full cursor-pointer items-center justify-between gap-6 text-left"
                >
                  {/* the question as a card title, like the poster cards, with its idea drawn small in glyphs just before it */}
                  <span className="flex min-w-0 items-center gap-4 sm:gap-5">
                    <GlyphField tone="on-light" shape={GLYPHS[i] ?? "drop"} seed={i + 41} cell={3} fit={1} align="center" className="size-9 shrink-0 sm:size-10" />
                    <span className="card-title text-foreground min-w-0 text-[clamp(1.25rem,1.8vw,1.625rem)]">{item.q}</span>
                  </span>
                  <span className="flex shrink-0 items-center">
                    <motion.span key={isOpen ? "minus" : "plus"} aria-hidden initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} transition={{ duration: 0.25 }} className="text-foreground">
                      {isOpen ? <Minus className="size-5" /> : <Plus className="size-5" />}
                    </motion.span>
                  </span>
                </button>
              </h3>
              <AnimatePresence initial={false}>
                {isOpen ? (
                  <motion.div
                    id={`faq-a-${i}`}
                    role="region"
                    aria-labelledby={`faq-q-${i}`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.35, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <p className="text-muted-foreground max-w-[64ch] pt-3 pl-[52px] text-base leading-snug sm:pl-[60px] sm:text-lg">{item.a}</p>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
}
