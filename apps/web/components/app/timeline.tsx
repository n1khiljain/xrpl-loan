"use client";

import { Check, X } from "lucide-react";
import { motion } from "motion/react";
import { EASE } from "@/components/motion";
import { cn } from "@/lib/utils";

export type TimelineStep = { label: string; detail?: string; status: "done" | "current" | "upcoming" | "failed" };

/**
 * The receivable's status timeline: dots on a connecting line. When a step finishes, its dot fills and the line to the next
 * one draws down, so the move is visible if you're on the page when it happens.
 */
export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="flex flex-col" aria-label="Progress">
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={step.label} className="flex gap-3.5" data-status={step.status}>
            <span className="flex shrink-0 flex-col items-center" aria-hidden>
              <motion.span
                key={step.status}
                initial={{ scale: 0.6 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.4, ease: EASE }}
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full",
                  step.status === "done" && "bg-foreground text-background",
                  step.status === "current" && "border-foreground bg-surface border-[5px]",
                  step.status === "upcoming" && "border-border border-2",
                  step.status === "failed" && "bg-danger text-on-ink",
                )}
              >
                {step.status === "done" ? <Check className="size-3" strokeWidth={3} /> : step.status === "failed" ? <X className="size-3" strokeWidth={3} /> : null}
              </motion.span>
              {!last ? (
                <span className="bg-divider relative w-0.5 min-h-[22px] grow">
                  {step.status === "done" ? (
                    <motion.span
                      className="bg-foreground absolute inset-0 origin-top"
                      initial={{ scaleY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ duration: 0.5, ease: EASE, delay: 0.1 }}
                    />
                  ) : null}
                </span>
              ) : null}
            </span>
            <div className={cn("flex min-w-0 flex-col gap-0.5", !last && "pb-3.5")}>
              <p className={cn("text-sm", step.status === "upcoming" ? "text-muted-foreground font-medium" : "text-foreground font-semibold")}>
                {step.label}
                <span className="sr-only"> ({step.status})</span>
              </p>
              {step.detail ? <p className="text-muted-foreground text-sm">{step.detail}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
