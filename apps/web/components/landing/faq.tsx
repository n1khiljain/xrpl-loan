"use client";

import { Minus, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

const FAQ = [
  {
    q: "What is Install?",
    a: "Install lets a business expedite a transaction, transfer, or payment. You get an upfront loan from a lending vault on the XRP Ledger, and you pay it back with interest based on how long the loan runs.",
  },
  { q: "What does it cost?", a: "Interest depends on the loan horizon. A shorter loan costs less. The app covers XRP Ledger network costs." },
  { q: "What if the payment never arrives?", a: "Report it in the app. The person who signed off covers what was not paid." },
  { q: "Who holds my documents?", a: "Only you, the people who sign off at your business, and Install's reviewers can see your documents. The documents themselves never go on the ledger." },
] as const;

export function Faq() {
  const [open, setOpen] = useState(0);

  return (
    <section id="faq" className="mx-auto w-full max-w-[1440px] scroll-mt-24 px-4 py-16 sm:px-6 lg:px-10 lg:py-28">
      <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end lg:gap-12">
        <h2 className="display-type text-3xl sm:text-4xl lg:text-5xl xl:text-6xl">
          Frequently asked questions
        </h2>
        <p className="text-muted-foreground max-w-md text-base leading-relaxed lg:text-right lg:text-lg">Common questions from businesses.</p>
      </div>

      <div className="mt-10 flex flex-col gap-3 lg:mt-16 lg:gap-4">
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
              className="border-border bg-surface shadow-soft cursor-pointer rounded-xl border p-4 transition-shadow hover:shadow-float sm:p-5 lg:rounded-2xl lg:p-6"
            >
              <h3>
                <button
                  type="button"
                  id={`faq-q-${i}`}
                  aria-expanded={isOpen}
                  aria-controls={`faq-a-${i}`}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 text-left"
                >
                  <span className="flex min-w-0 items-center gap-3 lg:gap-5">
                    <span className="bg-surface-muted text-foreground flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold lg:size-10 lg:text-base">
                      {i + 1}
                    </span>
                    <span className="text-base leading-tight font-medium lg:text-xl">{item.q}</span>
                  </span>
                  <motion.span key={isOpen ? "minus" : "plus"} aria-hidden initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} transition={{ duration: 0.25 }} className="text-foreground shrink-0">
                    {isOpen ? <Minus className="size-5 lg:size-6" /> : <Plus className="size-5 lg:size-6" />}
                  </motion.span>
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
                    <p className="text-muted-foreground pt-3 pb-1 pl-12 text-sm leading-relaxed sm:text-base lg:pl-15 lg:text-lg">{item.a}</p>
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
