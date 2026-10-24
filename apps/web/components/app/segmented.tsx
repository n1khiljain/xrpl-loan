"use client";

import { motion } from "motion/react";
import { EASE } from "@/components/motion";
import { cn } from "@/lib/utils";

/**
 * A row of tabs where the highlight slides to the chosen one, so it's clear what changed. `id` keeps two controls on
 * one page from sharing a highlight.
 */
export function Segmented<T extends string>({
  id,
  label,
  options,
  value,
  onChange,
  className,
}: {
  id: string;
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("bg-muted inline-flex w-fit items-center rounded-full p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active ? (
              <motion.span
                layoutId={`segmented-${id}`}
                aria-hidden
                className="bg-surface shadow-soft absolute inset-0 rounded-full"
                transition={{ duration: 0.35, ease: EASE }}
              />
            ) : null}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
