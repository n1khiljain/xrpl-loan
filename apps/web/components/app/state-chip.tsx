import type { ClaimCardTone } from "@/components/brand/claim-card";
import type { CardMoment } from "@/components/brand/live-claim-card";
import { cn } from "@/lib/utils";

export type DisplayState =
  | "Draft"
  | "Submitted"
  | "Approved"
  | "Funded"
  | "GuarantorCalled"
  | "Settled"
  | "Recovered"
  | "WrittenOff"
  | "Rejected"
  | "Cancelled";

/** Plain-language names. The chip always shows the name, so color is never the only signal (BRAND.md). */
export const STATE_LABEL: Record<DisplayState, string> = {
  Draft: "Draft",
  Submitted: "In review",
  Approved: "Approved",
  Funded: "Paid",
  GuarantorCalled: "Officer asked to cover",
  Settled: "Closed out",
  Recovered: "Closed out",
  WrittenOff: "Written off",
  Rejected: "Not approved",
  Cancelled: "Cancelled",
};

/**
 * The claim card's color for each state, so the card itself shows how far along it is: frosted silver while it's
 * waiting, sky blue once approved, deep blue once paid, gold when it's closed out.
 */
export const CARD_TONE: Record<DisplayState, ClaimCardTone> = {
  Draft: "frost",
  Submitted: "frost",
  Approved: "sky",
  Funded: "deep",
  GuarantorCalled: "deep",
  WrittenOff: "deep",
  Settled: "gold",
  Recovered: "gold",
  Rejected: "frost",
  Cancelled: "frost",
};

/** The moment a live card plays for each state. */
export const CARD_MOMENT: Partial<Record<DisplayState, CardMoment>> = {
  Approved: "approved",
  Funded: "paid",
  Settled: "closed",
  Recovered: "closed",
};

/** Dot colors, mapped from BRAND.md's state colors. The label sits beside the dot, as plain text like the landing's. */
const STATE_DOT: Record<DisplayState, string> = {
  Draft: "bg-muted-foreground",
  Submitted: "bg-info",
  Approved: "bg-info",
  Funded: "bg-foreground",
  GuarantorCalled: "bg-danger",
  Settled: "bg-success",
  Recovered: "bg-success",
  WrittenOff: "bg-danger",
  Rejected: "bg-danger",
  Cancelled: "bg-muted-foreground",
};

export function StateChip({ state, className }: { state: DisplayState; className?: string }) {
  return (
    <span data-state={state} className={cn("text-foreground inline-flex w-fit items-center gap-1.5 text-xs font-medium whitespace-nowrap", className)}>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", STATE_DOT[state])} />
      {STATE_LABEL[state]}
    </span>
  );
}
