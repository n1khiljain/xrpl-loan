import type { ReactNode } from "react";

/* eslint-disable @next/next/no-img-element */

/** Project One's tagline glow behind a block of the dark features panel. */
export function GlowStage({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex w-full flex-col items-center py-16 sm:py-20 lg:py-28">
      {/* screen blend drops the art's black backdrop, so the panel's grain runs straight through it */}
      <img
        src="/images/landing/tagline-glow.webp"
        alt=""
        aria-hidden
        width={1512}
        height={962}
        loading="lazy"
        className="mask-feather pointer-events-none absolute top-0 left-1/2 h-full max-h-[520px] w-auto max-w-full -translate-x-1/2 mix-blend-screen"
      />
      <div className="relative flex w-full flex-col items-center">{children}</div>
    </div>
  );
}
