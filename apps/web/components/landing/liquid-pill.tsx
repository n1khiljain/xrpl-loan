"use client";

import type LiquidGlassComponent from "liquid-glass-react";
import { type ComponentProps, type ComponentType, type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/*
 * A pill on liquid-glass-react's glass: edge refraction with chromatic aberration, a frosted backdrop, and the
 * light-catching rim, using the library's own button settings from its README. The library reads `navigator` while
 * it renders, so it loads after mount; until then (and in the static export) the pill shows on the CSS glass track,
 * which looks close enough that the swap doesn't jump.
 *
 * The library centres itself on its position with translate(-50%, -50%), so it sits absolutely in a slot that an
 * invisible copy of the content sizes. Pass `sizer` when the content can't be rendered twice (it holds a shared
 * layout animation, say). The library also sets its own font, white text, and a dark text shadow on whatever it
 * wraps; the pill puts back the page's font and color and drops the shadow.
 */

type Glass = ComponentType<ComponentProps<typeof LiquidGlassComponent>>;

export function LiquidPill({ children, sizer, padding = "6px", className }: { children: ReactNode; sizer?: ReactNode; padding?: string; className?: string }) {
  const [Glass, setGlass] = useState<Glass | null>(null);
  useEffect(() => {
    let live = true;
    void import("liquid-glass-react").then((m) => {
      if (live) setGlass(() => m.default);
    });
    return () => {
      live = false;
    };
  }, []);

  const content = <span className="text-foreground block font-sans [text-shadow:none]">{children}</span>;

  return (
    <span className={cn("relative inline-block", className)}>
      {/* sizes the slot; never seen or reached */}
      <span aria-hidden inert className="invisible block" style={{ padding }}>
        {sizer ?? children}
      </span>
      <span className="absolute inset-0 flex items-center justify-center">
        {Glass ? (
          <Glass
            displacementScale={64}
            blurAmount={0.1}
            saturation={130}
            aberrationIntensity={2}
            elasticity={0.35}
            cornerRadius={100}
            padding={padding}
            style={{ position: "absolute", top: "50%", left: "50%" }}
          >
            {content}
          </Glass>
        ) : (
          <span className="glass-track absolute inset-0 flex items-center justify-center rounded-full" style={{ padding }}>
            {content}
          </span>
        )}
      </span>
    </span>
  );
}
