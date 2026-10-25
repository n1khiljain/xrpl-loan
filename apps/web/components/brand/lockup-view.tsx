/** Logo file paths kept for the brand folder lookup. The wordmark does not draw them. */
export type LogoFiles = { bab: string | null; babOnDark: string | null };

/**
 * "auto" is for the app's light surfaces. "on-dark" is for ink and dark gradient surfaces, and "on-light" for pale
 * gradient surfaces such as the top of the sky panel.
 */
export type LockupTone = "auto" | "on-dark" | "on-light";

/** The product's name, set in the display font beside its mark. */
export const PRODUCT_NAME = "Install";

/*
 * The mark: an arrow coming down onto a base line, the install gesture, drawn on a 5x5 grid in the identity's glyphs.
 * Dots make the arrow, rounded squares the base, and the point where it lands is the one spot-orange dot, like the
 * orange glyph in each card's picture. Built from plain boxes, not drawn, and kept to one ink color plus that dot so
 * it reads at favicon size and in one color if it has to.
 */
type Cell = "." | "o" | "s" | "x";
const MARK: Cell[][] = [
  [".", ".", "o", ".", "."],
  ["o", ".", "o", ".", "o"],
  [".", "o", "o", "o", "."],
  [".", ".", "x", ".", "."],
  ["s", "s", "s", "s", "s"],
];

export function LogoMark({ tone = "auto", className }: { tone?: LockupTone; className?: string }) {
  const ink = tone === "on-dark" ? "bg-on-ink" : tone === "on-light" ? "bg-ink" : "bg-foreground";
  return (
    <span aria-hidden className={`grid size-[1em] shrink-0 grid-cols-5 grid-rows-5 gap-[0.04em] ${className ?? ""}`}>
      {MARK.flatMap((row, r) =>
        row.map((cell, c) => (
          <span
            key={`${r}-${c}`}
            className={cell === "." ? "" : cell === "s" ? `${ink} rounded-[0.03em]` : cell === "x" ? "rounded-full bg-[var(--spot)]" : `${ink} rounded-full`}
          />
        )),
      )}
    </span>
  );
}

/**
 * The product lockup: the mark, then the wordmark, sized by font-size (set text-2xl etc. on a parent). The mark is a
 * touch taller than the capitals and centred on them, with clear space of about half its width before the name.
 */
export function LockupView({ tone = "auto" }: { files?: LogoFiles; tone?: LockupTone }) {
  const color = tone === "on-dark" ? "text-on-ink" : tone === "on-light" ? "text-ink" : "text-foreground";
  return (
    <span className={`display-type inline-flex items-center gap-[0.38em] text-[1em] leading-none font-semibold ${color}`} role="img" aria-label={PRODUCT_NAME}>
      <LogoMark tone={tone} className="text-[1.2em]" />
      <span aria-hidden>{PRODUCT_NAME}</span>
    </span>
  );
}
