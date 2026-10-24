"use client";

import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { type ComponentProps, type PointerEvent, useRef } from "react";
import { CountUp, EASE } from "@/components/motion";
import { cn } from "@/lib/utils";
import { ReceivableCard } from "./receivable-card";

/** The moment a state plays when the card arrives in it. */
export type CardMoment = "approved" | "paid" | "closed";

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Approved: one band of light crosses the card, once. */
function Shine() {
  return (
    <motion.span
      aria-hidden
      className="card-shine pointer-events-none absolute inset-y-0 w-full"
      initial={{ x: "-120%" }}
      animate={{ x: "120%" }}
      transition={{ duration: 1.1, ease: EASE, delay: 0.35 }}
    />
  );
}

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
 * The receivable card, alive: it leans toward the pointer with a glare that follows it, and each state plays its moment
 * when it arrives. Swap it with a new key when the state
 * changes so the moment plays again. Under reduced motion it's the still card with its finish.
 */
export function LiveReceivableCard({
  moment,
  amountValue,
  className,
  ...card
}: ComponentProps<typeof ReceivableCard> & { moment?: CardMoment | null; amountValue?: number }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const rx = useSpring(useMotionValue(0), { stiffness: 180, damping: 18 });
  const ry = useSpring(useMotionValue(0), { stiffness: 180, damping: 18 });

  function move(e: PointerEvent<HTMLDivElement>) {
    if (reduced || e.pointerType !== "mouse" || !ref.current) return;
    const box = ref.current.getBoundingClientRect();
    const px = (e.clientX - box.left) / box.width;
    const py = (e.clientY - box.top) / box.height;
    ry.set((px - 0.5) * 14);
    rx.set((0.5 - py) * 14);
    ref.current.style.setProperty("--glare-x", `${px * 100}%`);
    ref.current.style.setProperty("--glare-y", `${py * 100}%`);
  }

  function leave() {
    rx.set(0);
    ry.set(0);
    ref.current?.style.removeProperty("--glare-x");
    ref.current?.style.removeProperty("--glare-y");
  }

  const amountNode =
    moment === "paid" && amountValue !== undefined ? <CountUp value={amountValue} format={(n) => USD.format(n)} duration={1.2} /> : undefined;

  return (
    <div className={cn("[perspective:900px]", className)} onPointerMove={move} onPointerLeave={leave}>
      <motion.div ref={ref} style={{ rotateX: rx, rotateY: ry }} className="rounded-[22px] [transform-style:preserve-3d]">
        <ReceivableCard {...card} amountNode={amountNode}>
          <span aria-hidden className="card-glare pointer-events-none absolute inset-0 rounded-[inherit]" />
          {!reduced && moment === "approved" ? <Shine /> : null}
          {moment === "closed" ? <Stamp /> : null}
        </ReceivableCard>
      </motion.div>
    </div>
  );
}
