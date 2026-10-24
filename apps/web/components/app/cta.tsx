import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The design's primary call to action: a label and a round arrow bubble inside a pill. Put it inside a <Button
 * size="lg" className="pr-2"> or an <a>; `invert` flips the bubble for light buttons on dark surfaces.
 */
export function CtaLabel({ children, invert = false }: { children: ReactNode; invert?: boolean }) {
  return (
    <>
      <span>{children}</span>
      <span className={cn("ml-2 flex size-10 items-center justify-center rounded-full", invert ? "bg-ink text-on-ink" : "bg-surface text-foreground")}>
        <ArrowRight className="size-4" strokeWidth={2.2} />
      </span>
    </>
  );
}
