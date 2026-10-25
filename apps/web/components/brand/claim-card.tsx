import type { ReactNode } from "react";
import { GlyphField, type ShapeName } from "@/components/landing/glyph-field";
import { ASSET } from "@/lib/config";
import { cn } from "@/lib/utils";

// "light" is the feature band's warm grey card, for a card shown on its own against a coloured panel
export type ClaimCardTone = "frost" | "sky" | "deep" | "gold" | "light";

const TONE: Record<ClaimCardTone, string> = {
  frost: "bg-grad-card-frost",
  deep: "bg-grad-card-deep",
  sky: "bg-grad-card-sky",
  gold: "bg-grad-card-gold",
  light: "bg-divider",
};

/**
 * Each state's text and glyph picture. Small text is Night on the pale and orange cards and white on Night; the
 * amount is a large title, so it can go white on orange (3.1:1 passes for large text).
 */
const STYLE: Record<ClaimCardTone, { text: string; amount: string; glyph: "on-pop" | "on-tint" | "on-orange" | "on-night" | "on-light"; shape: ShapeName }> = {
  frost: { text: "text-ink", amount: "text-ink", glyph: "on-pop", shape: "receipt" },
  sky: { text: "text-ink", amount: "text-ink", glyph: "on-tint", shape: "shield" },
  deep: { text: "text-ink", amount: "text-on-ink", glyph: "on-orange", shape: "coins" },
  gold: { text: "text-on-ink", amount: "text-on-ink", glyph: "on-night", shape: "check" },
  light: { text: "text-ink", amount: "text-ink", glyph: "on-light", shape: "drop" },
};

/**
 * The loan as a card: its number, state, and amount on a flat surface for its state, with the state drawn in glyphs
 * between them. The asset is named in text; no logo is drawn.
 * `size` scales the whole card (1 = 280x400). The number and
 * state are quiet text in the surrounding font, as on the landing page, not a monospace number and a pill.
 * `amountNode` replaces the printed amount (a count-up), and `children` sit over the card for a state's moment
 * (see LiveClaimCard).
 */
export function ClaimCard({
  claimId,
  amount,
  state,
  org,
  tone = "deep",
  scale = 1,
  amountNode,
  children,
  className,
}: {
  claimId: string;
  amount: string;
  state: string;
  org: string;
  tone?: ClaimCardTone;
  scale?: number;
  amountNode?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const style = STYLE[tone];
  return (
    <div
      role="img"
      aria-label={`Loan ${claimId}, ${amount}, ${state.toLowerCase()}`}
      className={cn("shadow-card relative isolate shrink-0 overflow-hidden rounded-[22px] font-sans", TONE[tone], style.text, className)}
      style={{ width: 280 * scale, height: 400 * scale, fontSize: 16 * scale }}
    >
      {/* the picture sits centred in the open space between the top labels and the amount, clear of both */}
      <GlyphField tone={style.glyph} shape={style.shape} cell={Math.max(7, Math.round(9 * scale))} seed={claimId.length + 4} fit={0.8} className="absolute inset-x-[0.75em] top-[3.2em] bottom-[6.6em] -z-10" />
      <span className="absolute top-[1em] left-[1.125em] text-[0.75em] font-semibold tracking-[0.02em]">
        {claimId === "DRAFT" ? "Draft" : `No. ${claimId}`}
      </span>
      <span className="absolute top-[1em] right-[1.125em] text-[0.75em] font-semibold tracking-[0.02em]">{sentenceCase(state)}</span>
      <span className={cn("money-type absolute right-[0.64em] bottom-[1.8em] left-[0.64em] text-[1.75em]", style.amount)}>{amountNode ?? amount}</span>
      {/* one row, so a long org name truncates instead of running into the label */}
      <span className="absolute right-[1.125em] bottom-[1em] left-[1.125em] flex items-center justify-between gap-[0.75em]">
        <span className="flex min-w-0 items-center gap-[0.5em] text-[0.75em] opacity-90">
          <span className="shrink-0 font-semibold">{ASSET}</span>
          <span className="truncate">{org}</span>
        </span>
        <span className="shrink-0 text-[0.8em] font-semibold">Loan</span>
      </span>
      {children}
    </div>
  );
}

/** "Closed out" from "CLOSED OUT". */
function sentenceCase(label: string): string {
  return label.charAt(0) + label.slice(1).toLowerCase();
}

/** "0012" from 12, the way claim cards number claims. */
export function cardNumber(id: bigint | number | string | null | undefined): string {
  if (id === null || id === undefined || id === "") return "DRAFT";
  return String(id).padStart(4, "0");
}
