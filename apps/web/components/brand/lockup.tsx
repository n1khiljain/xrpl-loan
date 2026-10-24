import { existsSync } from "node:fs";
import { join } from "node:path";
import { type LockupTone, type LogoFiles, LockupView } from "./lockup-view";

/**
 * Looks for each official file in public/brand when the static export is built, SVG first, then PNG. A missing file
 * never breaks the build; the lockup shows the org name instead.
 */
export function logoFiles(dir = join(process.cwd(), "public", "brand")): LogoFiles {
  const find = (stem: string) => {
    for (const ext of ["svg", "png"]) if (existsSync(join(dir, `${stem}.${ext}`))) return `/brand/${stem}.${ext}`;
    return null;
  };
  return { bab: find("bab-logo"), babOnDark: find("bab-logo-on-dark") };
}

/** Server component; pass the result of logoFiles() down to client components that need the lockup. */
export function Lockup({ tone }: { tone?: LockupTone }) {
  return <LockupView files={logoFiles()} tone={tone} />;
}
