"use client";

import { AnimatePresence, animate, MotionConfig, motion, useInView, useMotionValue, useMotionValueEvent, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

/*
 * The landing page's motion, shared with the app. Each piece is small and does one thing; use one only where
 * the movement tells someone what just happened. Reduced motion is honored once, at the root.
 */

/** The landing's easing: quick out, long settle. */
export const EASE = [0.23, 1, 0.32, 1] as const;

/** Turns motion off app-wide for anyone who asks their device for reduced motion. */
export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** Fades and lifts its content in the first time it scrolls into view. */
export function RiseIn({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.6, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Swaps one thing for the next when `id` changes: the old one tips up and out, the new one rises in. This is the
 * landing's receivable card move, for anything that changes state in place.
 */
export function Swap({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={id}
        className={className}
        initial={{ opacity: 0, y: 24, rotate: -4, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, rotate: 0, scale: 1 }}
        exit={{ opacity: 0, y: -24, rotate: 4, scale: 0.96 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** Opens and closes its content by animating the height, like the landing's step details and FAQ answers. */
export function Expand({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          className={className}
          style={{ overflow: "hidden" }}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.35, ease: EASE }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * Counts a number up to `value` once, the first time it's on screen. It renders the final value on the server and
 * under reduced motion, so the real number is always what's there without JavaScript.
 */
export function CountUp({ value, format, duration = 1.1 }: { value: number; format: (n: number) => string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.6 });
  const reduced = useReducedMotion();
  const n = useMotionValue(value);
  const [shown, setShown] = useState(() => format(value));
  useMotionValueEvent(n, "change", (v) => setShown(format(v)));

  // start from zero before the first paint, so the final number never flashes before the count
  useLayoutEffect(() => {
    if (!reduced) n.set(0);
  }, [reduced, n]);

  useEffect(() => {
    if (reduced) {
      n.set(value);
      return;
    }
    if (!seen) return;
    const run = animate(n, value, { duration, ease: EASE });
    return () => run.stop();
  }, [seen, reduced, value, duration, n]);

  // screen readers get the real number once, not every step of the count
  return (
    <span ref={ref} className="tabular">
      <span aria-hidden>{shown}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
