"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ShapeName } from "@/components/landing/glyph-field";
import { PosterContent, posterSurface } from "@/components/landing/poster-card";
import { Button } from "@/components/ui/button";
import { ASSET } from "@/lib/config";
import { cn } from "@/lib/utils";

/*
 * The landing's hero, after smallest.ai's: the headline with the two calls to action under it and arrows on the
 * right, then the four steps of a loan as a row of cards that runs off the right edge. Each card is laid out like the
 * identity's posters: the step's name top left, its number top right, the step drawn in glyphs in the middle, and the
 * description along the bottom. The spotlighted card is wider and sits on spot orange; the rest are Night with their
 * glyphs in orange. The arrows (or a click on a card) move the spotlight, and the row scrolls so the spotlighted card
 * leads.
 */

const STEPS: { title: string; detail: string; glyph: ShapeName }[] = [
  {
    title: "Get verified",
    detail: "Sign in with your email, then a reviewer approves you once.",
    glyph: "shield",
  },
  {
    title: "Name the payment",
    detail: "Add its reference and documents, and pick an approver at your business.",
    glyph: "receipt",
  },
  {
    title: "Get the loan",
    detail: `Once a reviewer approves it, one button sends ${ASSET} to your wallet.`,
    glyph: "coins",
  },
  {
    title: "Pay it back with interest",
    detail: "Repay by the end of the loan's horizon, and it's closed out.",
    glyph: "check",
  },
];

// lines the row up with the content column on wide screens, and with the page gutter on narrow ones
const ROW_INSET = "max(1rem, calc((100% - 1440px) / 2 + 2.5rem))";
// card widths, shared by the classes below and the scroll maths
const PLAIN_VW = 0.78;
const PLAIN_MAX = 440;
// on desktop the row pins in the middle of the screen while the page scrolls through the steps; this much page
// scroll (in viewport heights) moves it on by one step
const PIN_STEP_VH = 0.7;
const ROW_H = 560; // sm:h-[560px]

export function HowItWorks() {
  const [current, setCurrent] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const pin = useRef<HTMLDivElement>(null);
  const sticky = useRef<HTMLDivElement>(null);
  // pinned: on desktop, unless the visitor prefers reduced motion; elsewhere the row scrolls on its own
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPinned(wide.matches && !reduced.matches);
    update();
    wide.addEventListener("change", update);
    reduced.addEventListener("change", update);
    return () => {
      wide.removeEventListener("change", update);
      reduced.removeEventListener("change", update);
    };
  }, []);

  /** How far through the pinned stretch the page is, 0 to 1, and the numbers behind it. */
  const pinState = () => {
    const outer = pin.current;
    const inner = sticky.current;
    if (!outer || !inner) return null;
    const top = parseFloat(getComputedStyle(inner).top) || 0;
    const rect = outer.getBoundingClientRect();
    const travel = rect.height - inner.offsetHeight;
    return { top, rect, travel, p: travel > 0 ? Math.min(1, Math.max(0, (top - rect.top) / travel)) : 0 };
  };

  // while pinned, the page's scroll drives the row: it slides left continuously, and the spotlight follows the card
  // nearest the front
  useEffect(() => {
    if (!pinned) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const row = track.current;
        const state = pinState();
        if (!row || !state) return;
        // the row travels only until its last card reaches the right edge, so it never ends on empty space
        row.scrollLeft = state.p * (row.scrollWidth - row.clientWidth);
        setCurrent(Math.round(state.p * (STEPS.length - 1)));
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [pinned]);

  /** Choose a step: when pinned, scroll the page to where that step leads; otherwise just spotlight it. */
  const go = (i: number) => {
    const state = pinned ? pinState() : null;
    if (!state) return setCurrent(i);
    const target = window.scrollY + state.rect.top - state.top + (i / (STEPS.length - 1)) * state.travel;
    window.scrollTo({ top: target, behavior: "smooth" });
  };

  // unpinned: bring the spotlighted card to the front of the row; the row scrolls on its own, never the page. The
  // cards are still changing width when this runs, so it aims for where they end up: every card before the
  // spotlight is plain.
  useEffect(() => {
    const row = track.current;
    if (!row || pinned) return;
    const plain = Math.min(window.innerWidth * PLAIN_VW, PLAIN_MAX);
    // the row's gap changes at lg, so read it rather than repeat it
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollTo({ left: current * (plain + gap), behavior: reduced ? "auto" : "smooth" });
  }, [current, pinned]);


  return (
    <section
      aria-label="The steps of a loan"
      className="bg-surface text-foreground relative isolate w-full scroll-mt-24 overflow-x-clip pt-16 pb-16 sm:pt-24 lg:pt-32 lg:pb-28"
    >
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8 px-4 sm:px-6 lg:px-10">
        {/* the headline on the left; its line and the calls to action on the right */}
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
          <h1 className="hero-type max-w-[18ch] text-[clamp(2.5rem,4.6vw,4.25rem)] text-balance lg:max-w-[21ch]">Expedite the payments you choose</h1>
          <div className="flex max-w-[34rem] flex-col gap-6 lg:max-w-[30rem] lg:shrink-0 lg:pb-2">
            <p className="text-muted-foreground text-lg leading-relaxed sm:text-xl">
              Get the money for a payment up front, then pay it back with interest based on how long it runs.
            </p>
            <div className="flex flex-wrap gap-2.5">
              <Button asChild size="lg">
                <Link href="/claims/new/">Expedite a payment</Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href="/lend/">Lend to the vault</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* on desktop the row pins mid-screen while the page scrolls through the steps, then lets go */}
      <div ref={pin} className="mt-10 lg:mt-16" style={pinned ? { height: `calc(${ROW_H + 8}px + ${(STEPS.length - 1) * PIN_STEP_VH * 100}vh)` } : undefined}>
      <div ref={sticky} className={cn(pinned && "sticky")} style={pinned ? { top: `max(88px, calc(50vh - ${(ROW_H + 8) / 2}px + 36px))` } : undefined}>
      <div
        ref={track}
        className="relative flex gap-4 overflow-x-auto pr-4 pb-2 [scrollbar-width:none] lg:gap-6 [&::-webkit-scrollbar]:hidden"
        style={{ paddingLeft: ROW_INSET }}
      >
        {STEPS.map((step, i) => {
          const spot = i === current;
          return (
            <button
              key={step.title}
              type="button"
              aria-current={spot ? "step" : undefined}
              aria-label={`Step ${i + 1}: ${step.title}. ${step.detail}`}
              onClick={() => go(i)}
              className={cn(
                posterSurface(spot ? "orange" : "night"),
                "shrink-0 transition-[width] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
                spot ? "w-[min(86vw,620px)]" : "w-[min(78vw,440px)] cursor-pointer",
              )}
            >
              <PosterContent
                title={step.title}
                detail={step.detail}
                shape={step.glyph}
                tone={spot ? "orange" : "night"}
                index={i}
                markLabel={`Step ${i + 1} of ${STEPS.length}`}
                seed={i + 3}
              />
            </button>
          );
        })}
        {/* unpinned, room after the last card, so the last steps can still scroll to the front of the row */}
        {pinned ? null : <span aria-hidden className="shrink-0" style={{ width: "max(0px, calc(100% - min(86vw, 620px) - 1rem))" }} />}
      </div>
      </div>
      </div>
    </section>
  );
}
