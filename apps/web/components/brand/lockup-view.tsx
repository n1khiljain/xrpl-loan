/** Logo file paths kept for the brand folder lookup. The wordmark does not draw them. */
export type LogoFiles = { bab: string | null; babOnDark: string | null };

/**
 * "auto" is for the app's light surfaces. "on-dark" is for ink and dark gradient surfaces, and "on-light" for pale
 * gradient surfaces such as the top of the sky panel.
 */
export type LockupTone = "auto" | "on-dark" | "on-light";

/** The product's name, set in the display font. Text only: no logo is drawn. */
export const PRODUCT_NAME = "Install";

/**
 * The product wordmark, sized by font-size (set text-2xl etc. on a parent).
 */
export function LockupView({ tone = "auto" }: { files?: LogoFiles; tone?: LockupTone }) {
  const color = tone === "on-dark" ? "text-on-ink" : tone === "on-light" ? "text-ink" : "text-foreground";
  return (
    <span className={`display-type inline-flex items-center text-[1em] leading-none font-semibold ${color}`} aria-label={PRODUCT_NAME}>
      {PRODUCT_NAME}
    </span>
  );
}
