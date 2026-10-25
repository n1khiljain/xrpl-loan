"use client";

import { motion } from "motion/react";
import type { ComponentProps } from "react";
import { CountUp } from "@/components/motion";
import { ReceivableCard } from "./receivable-card";

/** The moment a state plays when the card arrives in it. */
export type CardMoment = "approved" | "paid" | "closed";

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Closed out: a round stamp presses into the gold, a little crooked, like a real one. */
function Stamp() {
  return (
    <motion.span
      aria-hidden
      className="text-ink/75 border-ink/60 pointer-events-none absolute top-[12.5em] right-[1.1em] flex size-[6.2em] flex-col items-center justify-center rounded-full border-[0.14em] mix-blend-multiply"
      initial={{ scale: 1.9, opacity: 0, rotate: -4 }}
      animate={{ scale: 1, opacity: 1, rotate: -14 }}
      transition={{ type: "spring", stiffness: 520, damping: 24, delay: 0.35 }}
    >
      <span className="border-ink/40 absolute inset-[0.3em] rounded-full border-[0.06em]" />
      <span className="text-[0.62em] font-semibold tracking-[0.08em]">Paid in full</span>
      <span className="text-[1em] leading-tight font-bold">Closed out</span>
    </motion.span>
  );
}

/**
 * The receivable card, alive: each state plays its moment when it arrives (the paid amount counts up, the closed-out stamp
 * presses in). It stays flat and still under the pointer; nothing leans or tilts on hover. Swap it with a new key when
 * the state changes so the moment plays again.
 */
export function LiveReceivableCard({
  moment,
  amountValue,
  className,
  ...card
}: ComponentProps<typeof ReceivableCard> & { moment?: CardMoment | null; amountValue?: number }) {
  const amountNode =
    moment === "paid" && amountValue !== undefined ? <CountUp value={amountValue} format={(n) => USD.format(n)} duration={1.2} /> : undefined;

  return (
    <div className={className}>
      <ReceivableCard {...card} amountNode={amountNode}>
        {moment === "closed" ? <Stamp /> : null}
      </ReceivableCard>
    </div>
  );
}
