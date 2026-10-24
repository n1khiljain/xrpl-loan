/** Paths of the official logo files found in public/brand, or null for a missing one (docs/BRAND.md). */
export type LogoFiles = { bab: string | null; babOnDark: string | null; frax: string | null; fraxOnDark: string | null };

type OrgLogo = { name: "bab" | "frax"; label: string; light: string | null; dark: string | null; height: string };

/**
 * "auto" is for the app's light surfaces. "on-dark" is for ink and dark gradient surfaces, and "on-light" for pale
 * gradient surfaces such as the top of the sky panel.
 */
export type LockupTone = "auto" | "on-dark" | "on-light";

function orgLogos(files: LogoFiles): [OrgLogo, OrgLogo] {
  // the design canvas puts Frax first, then B@B (U-65); B@B's mark is taller than Frax's wordmark
  return [
    { name: "frax", label: "Frax", light: files.frax, dark: files.fraxOnDark, height: "h-[0.8em]" },
    { name: "bab", label: "Blockchain at Berkeley", light: files.bab, dark: files.babOnDark, height: "h-[1.2em]" },
  ];
}

function Logo({ logo, tone }: { logo: OrgLogo; tone: LockupTone }) {
  const dark = logo.dark ?? logo.light;
  const light = logo.light ?? logo.dark;
  // a missing file shows the org name as text in the display font; logos are never drawn in code
  if (!dark || !light) {
    return (
      <span data-logo={logo.name} data-fallback="text" className="display-type text-[0.7em] leading-none">
        {logo.label}
      </span>
    );
  }
  if (tone !== "auto") {
    return (
      <span data-logo={logo.name} data-fallback="file" className="inline-flex items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={tone === "on-dark" ? dark : light} alt={logo.label} className={`${logo.height} w-auto`} />
      </span>
    );
  }
  return (
    <span data-logo={logo.name} data-fallback="file" className="inline-flex items-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={light} alt={logo.label} className={`${logo.height} w-auto`} />
    </span>
  );
}

/**
 * Frax, a thin rule, then B@B, sized by font-size (set text-2xl etc. on a parent). Official files only; the
 * lockup never recolors, stretches, or boxes a logo (BRAND.md).
 */
export function LockupView({ files, tone = "auto" }: { files: LogoFiles; tone?: LockupTone }) {
  const [frax, bab] = orgLogos(files);
  return (
    <span className="inline-flex items-center gap-[0.55em]" aria-label="Frax and Blockchain at Berkeley">
      <Logo logo={frax} tone={tone} />
      <span aria-hidden className={`h-[1.1em] w-px ${tone === "on-dark" ? "bg-on-ink/40" : tone === "on-light" ? "bg-ink/40" : "bg-foreground/40"}`} />
      <Logo logo={bab} tone={tone} />
    </span>
  );
}
