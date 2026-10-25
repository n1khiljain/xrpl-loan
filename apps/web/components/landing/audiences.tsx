import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { GlyphField } from "@/components/landing/glyph-field";
import { ASSET } from "@/lib/config";
import { cn } from "@/lib/utils";

/*
 * Who Install is for, laid out like smallest.ai's case-study row: a short heading on the left and two large tiles on
 * the right, each a link with a small label and its headline at the top and a picture in glyphs along the bottom. There
 * are no customer stories yet, so the tiles are the two sides of a loan: businesses on spot orange with a city skyline,
 * lenders on Night with rising columns in orange, like the identity's two posters.
 */

const TILES = [
  {
    href: "/receivables/new/",
    label: "For businesses",
    title: "Get paid now for the payment you're waiting on",
    tone: "orange",
  },
  {
    href: "/lend/",
    label: "For lenders",
    title: `Fund loans in ${ASSET} and earn the interest`,
    tone: "night",
  },
] as const;

export function Audiences() {
  return (
    <section aria-labelledby="audiences-title" className="bg-surface w-full">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-10 px-4 py-16 sm:px-6 lg:flex-row lg:items-center lg:gap-16 lg:px-10 lg:py-28">
        <h2 id="audiences-title" className="display-type max-w-[16ch] text-[clamp(2rem,4vw,3.25rem)] lg:w-[30%] lg:shrink-0">
          Built for both sides of the loan
        </h2>
        <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-2 lg:gap-6">
          {TILES.map((tile) => {
            const orange = tile.tone === "orange";
            return (
              <Link
                key={tile.href}
                href={tile.href}
                className={cn(
                  "group relative isolate flex aspect-[4/4.2] flex-col overflow-hidden rounded-3xl p-6 sm:p-8",
                  orange ? "bg-grad-feature text-ink" : "bg-ink text-on-ink",
                )}
              >
                <GlyphField tone={orange ? "on-orange" : "on-night"} shape={orange ? "skyline" : "growth"} seed={orange ? 5 : 13} fit={0.98} className="absolute inset-x-0 bottom-0 -z-10 h-[60%]" />
                <span className="flex items-center justify-between gap-4">
                  <span className={cn("text-sm sm:text-base", orange ? "text-ink" : "text-on-ink/75")}>{tile.label}</span>
                  <ArrowUpRight aria-hidden className="size-5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </span>
                <span className="card-title text-on-ink mt-4 max-w-[16ch]">{tile.title}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
