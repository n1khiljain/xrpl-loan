import { GlyphField, type ShapeName } from "@/components/landing/glyph-field";
import { cn } from "@/lib/utils";

/*
 * The landing's card, laid out like the identity's posters: a title top left, the quartered mark top right, a picture
 * drawn in glyphs in the middle, and a line of description along the bottom. It comes in the identity's surfaces:
 * spot orange (the one in focus), Night (with orange glyphs), and the light warm grey of the secondary button (with
 * Night glyphs). The hero's step cards
 * and the feature band share it, so the two sections read as one set.
 */

export type PosterTone = "orange" | "night" | "light";

/** The card's surface and frame; callers add the element, its width, and anything interactive. */
export function posterSurface(tone: PosterTone): string {
  return cn(
    "relative isolate flex h-[520px] flex-col overflow-hidden rounded-3xl p-6 text-left sm:h-[560px] sm:p-8",
    tone === "orange" ? "bg-grad-feature text-ink" : tone === "night" ? "bg-ink text-on-ink" : "bg-divider text-ink",
  );
}

/*
 * The identity's mark: four quarters in a 2x2 square, each rounded on its outer corner, with one quarter swapped for
 * a dot. The dot moves clockwise from the top left with the card's place in its set. Built from plain boxes, not drawn.
 */
const QUARTERS = ["rounded-tl-full", "rounded-tr-full", "rounded-br-full", "rounded-bl-full"] as const;
// grid order is top left, top right, bottom left, bottom right; clockwise order is TL, TR, BR, BL
const CLOCKWISE = [0, 1, 3, 2] as const;

/** `label` names the mark for screen readers; leave it out where the mark is decoration beside its own text. */
export function PosterMark({ index, label, tone, className }: { index: number; label?: string; tone: PosterTone; className?: string }) {
  const dotAt = CLOCKWISE[index % 4];
  return (
    <span {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })} className={cn("mt-1.5 grid size-6 shrink-0 grid-cols-2 gap-[2px]", className)}>
      {[0, 1, 2, 3].map((cell) => {
        const clockwise = CLOCKWISE.indexOf(cell as 0 | 1 | 2 | 3);
        return cell === dotAt ? (
          <span key={cell} className={cn("rounded-full", tone === "orange" ? "bg-ink" : "bg-[var(--spot)]")} />
        ) : (
          <span key={cell} className={cn(tone === "light" ? "bg-ink" : "bg-on-ink", QUARTERS[clockwise])} />
        );
      })}
    </span>
  );
}

/** The card's contents. Description text is Night on orange, where white would be too faint at its size. */
export function PosterContent({
  title,
  detail,
  shape,
  tone,
  index,
  markLabel,
  showMark = true,
  centerGlyph = true,
  seed,
  titleClassName,
  detailClassName,
}: {
  title: string;
  detail: string;
  shape: ShapeName;
  tone: PosterTone;
  index: number;
  markLabel: string;
  /** the quartered mark top right; the hero's steps show it, the feature band leaves it out */
  showMark?: boolean;
  /** draw the picture centred; off when the caller places it itself (the wide card's corner picture) */
  centerGlyph?: boolean;
  seed: number;
  titleClassName?: string;
  detailClassName?: string;
}) {
  return (
    <>
      <span className="flex items-start justify-between gap-6">
        <span className={cn("card-title max-w-[14ch]", tone === "light" ? "text-ink" : "text-on-ink", titleClassName)}>{title}</span>
        {showMark ? <PosterMark index={index} label={markLabel} tone={tone} /> : null}
      </span>
      {centerGlyph ? (
      <GlyphField
        tone={tone === "orange" ? "on-orange" : tone === "night" ? "on-night" : "on-light"}
        shape={shape}
        seed={seed}
        cell={13}
        fit={0.9}
        align="center"
        className="my-4 min-h-0 flex-1"
      />
      ) : (
        <span aria-hidden className="flex-1" />
      )}
      <span className={cn("max-w-[30ch] text-lg leading-snug sm:text-xl", tone === "orange" ? "text-ink" : tone === "night" ? "text-on-ink/80" : "text-muted-foreground", detailClassName)}>{detail}</span>
    </>
  );
}
