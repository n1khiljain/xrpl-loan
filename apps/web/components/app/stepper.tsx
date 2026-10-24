"use client";

import { Check } from "lucide-react";
import { motion } from "motion/react";
import { Fragment } from "react";
import { EASE } from "@/components/motion";
import { cn } from "@/lib/utils";

/**
 * The wizard's steps. The current one sits on the landing's dark glass pill, which slides to the next step as you
 * advance; earlier steps show a plain check. `current` is 0-based.
 */
export function Stepper({ steps, current, className }: { steps: readonly string[]; current: number; className?: string }) {
  return (
    <ol aria-label="Steps" className={cn("flex items-center gap-1.5 sm:gap-2", className)}>
      {steps.map((label, i) => {
        const done = i < current;
        const on = i === current;
        return (
          <Fragment key={label}>
            <li
              aria-current={on ? "step" : undefined}
              className={cn(
                "relative flex h-10 shrink-0 items-center gap-2 rounded-full pr-1.5 pl-1.5 text-[13px] font-semibold sm:pr-3.5",
                on ? "text-on-ink pr-3.5" : done ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {on ? (
                <motion.span
                  layoutId="stepper-active"
                  aria-hidden
                  className="bg-ink shadow-soft absolute inset-0 rounded-full"
                  transition={{ duration: 0.45, ease: EASE }}
                />
              ) : null}
              <span
                className={cn(
                  "relative flex size-7 items-center justify-center rounded-full text-xs",
                  on ? "bg-on-ink/15" : done ? "" : "bg-divider",
                )}
              >
                {done ? <Check aria-label="Done" className="size-4" strokeWidth={2.5} /> : i + 1}
              </span>
              <span className={cn("relative", on ? "inline" : "hidden sm:inline")}>{label}</span>
            </li>
            {i < steps.length - 1 ? <li aria-hidden className="bg-border h-px min-w-3 flex-1" /> : null}
          </Fragment>
        );
      })}
    </ol>
  );
}
