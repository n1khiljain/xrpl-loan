"use client";

import { ChevronDown } from "lucide-react";
import { motion } from "motion/react";
import { type ReactNode, useId, useState } from "react";
import { EASE, Expand } from "@/components/motion";

/**
 * A row that opens to show more, like the landing's FAQ. For the things a page can do that aren't the next step, so
 * the next step is the only thing asking for attention.
 */
export function Disclosure({
  label,
  hint,
  defaultOpen = false,
  children,
  className,
  testId,
}: {
  label: string;
  hint?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panel = useId();
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((o) => !o)}
        data-testid={testId}
        className="group flex w-full items-center justify-between gap-3 py-1 text-left"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-foreground text-[15px] font-semibold">{label}</span>
          {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
        </span>
        <motion.span
          aria-hidden
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="text-muted-foreground group-hover:text-foreground flex size-8 shrink-0 items-center justify-center transition-colors"
        >
          <ChevronDown className="size-4" />
        </motion.span>
      </button>
      <div id={panel}>
        <Expand open={open}>
          <div className="pt-4">{children}</div>
        </Expand>
      </div>
    </div>
  );
}
