/** Paths of the official B@B logo files found in public/brand, or null for a missing one. */
export type LogoFiles = { bab: string | null; babOnDark: string | null };

/**
 * "auto" is for the app's light surfaces. "on-dark" is for ink and dark gradient surfaces, and "on-light" for pale
 * gradient surfaces such as the top of the sky panel.
 */
export type LockupTone = "auto" | "on-dark" | "on-light";

/** The product's name, set in the display font next to the logo. Text only: no third-party logo is drawn. */
export const PRODUCT_NAME = "Receivables";

/**
 * The Blockchain at Berkeley logo, a thin rule, then the product name, sized by font-size (set text-2xl etc. on a
 * parent). Official files only; the lockup never recolors, stretches, or boxes the logo. A missing file shows the
 * org name as text instead.
 */
export function LockupView({ files, tone = "auto" }: { files: LogoFiles; tone?: LockupTone }) {
  const src = tone === "on-dark" ? (files.babOnDark ?? files.bab) : (files.bab ?? files.babOnDark);
  const rule = tone === "on-dark" ? "bg-on-ink/40" : tone === "on-light" ? "bg-ink/40" : "bg-foreground/40";
  return (
    <span className="inline-flex items-center gap-[0.55em]" aria-label={`Blockchain at Berkeley ${PRODUCT_NAME}`}>
      {src ? (
        <span data-logo="bab" data-fallback="file" className="inline-flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="Blockchain at Berkeley" className="h-[1.2em] w-auto" />
        </span>
      ) : (
        <span data-logo="bab" data-fallback="text" className="display-type text-[0.7em] leading-none">
          Blockchain at Berkeley
        </span>
      )}
      <span aria-hidden className={`h-[1.1em] w-px ${rule}`} />
      <span className="display-type text-[0.7em] leading-none">{PRODUCT_NAME}</span>
    </span>
  );
}
