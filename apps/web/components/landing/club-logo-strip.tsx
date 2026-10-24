"use client";

import { useAnimationFrame, useReducedMotion } from "motion/react";
import { useRef } from "react";

/* eslint-disable @next/next/no-img-element */

// white cut-outs of the marquee's club logos; width is each file's width at its 96px height
const CLUBS: { name: string; slug: string; width: number }[] = [
  { name: "Berkeley Investment Group", slug: "big", width: 94 },
  { name: "Berkeley Consulting", slug: "bc", width: 96 },
  { name: "Entrepreneurs @ Berkeley", slug: "eab", width: 96 },
  { name: "Launchpad", slug: "launchpad", width: 93 },
  { name: "Machine Learning at Berkeley", slug: "mlab", width: 49 },
  { name: "Berkeley Business Society", slug: "bbs", width: 96 },
  { name: "Big Data at Berkeley", slug: "bdab", width: 360 },
  { name: "Traders at Berkeley", slug: "traders", width: 93 },
  { name: "DiversaTech", slug: "diversatech", width: 97 },
  { name: "Net Impact Berkeley", slug: "netimpact", width: 96 },
  { name: "Venture Capital at Berkeley", slug: "vcb", width: 158 },
  { name: "BerkeleyTime", slug: "berkeleytime", width: 129 },
  { name: "Phoenix Consulting Group", slug: "phoenix", width: 49 },
  { name: "CMG Strategy Consulting", slug: "cmg", width: 280 },
  { name: "Voyager Consulting", slug: "voyager", width: 92 },
  { name: "Venture Strategy Solutions", slug: "vss", width: 115 },
  { name: "AI Entrepreneurs at Berkeley", slug: "aieb", width: 112 },
  { name: "The Berkeley Group", slug: "tbg", width: 159 },
  { name: "180 Degrees Consulting", slug: "180dc", width: 77 },
  { name: "Data Science Society", slug: "dss", width: 94 },
  { name: "Codeology", slug: "codeology", width: 94 },
];

/**
 * A partner strip with Berkeley clubs: small white logos drifting along the bottom of the hero, wide gaps,
 * no fade. The list renders twice so the loop has no seam; reduced motion holds it still.
 */
export function ClubLogoStrip({ speed = 0.4 }: { speed?: number }) {
  const reduced = useReducedMotion();
  const track = useRef<HTMLUListElement>(null);
  const x = useRef(0);

  useAnimationFrame(() => {
    const el = track.current;
    if (!el || reduced) return;
    const loop = el.scrollWidth / 2;
    x.current -= speed;
    if (loop > 0 && x.current <= -loop) x.current += loop;
    el.style.transform = `translate3d(${x.current}px, 0, 0)`;
  });

  return (
    <div className="w-full overflow-hidden py-8">
      <ul ref={track} aria-label="Berkeley student organizations" className="flex w-max items-center">
        {[0, 1].map((copy) =>
          CLUBS.map((club) => (
            <li key={`${copy}-${club.slug}`} aria-hidden={copy === 1} className="shrink-0 pr-16 sm:pr-24 lg:pr-32">
              <img
                src={`/images/landing/clubs-white/${club.slug}.webp`}
                alt={copy === 0 ? club.name : ""}
                width={club.width}
                height={96}
                draggable={false}
                className="h-7 w-auto transition-opacity hover:opacity-80 lg:h-8"
              />
            </li>
          )),
        )}
      </ul>
    </div>
  );
}
