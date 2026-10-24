import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  panel: "bg-grad-panel",
  sky: "bg-grad-sky",
  aside: "bg-grad-aside",
  paid: "bg-grad-paid",
  gold: "bg-grad-gold",
  called: "bg-grad-called",
  ledger: "bg-grad-ledger",
} as const;

export type PanelTone = keyof typeof TONES;

/**
 * The landing's black glass panel: near-black, a faint light from the top, film grain, white text. Dark in both themes.
 * Gold and called keep a trace of their color, and `ledger` is the design canvas's blue, for identity and wallet panels.
 */
export function GradientPanel({ tone = "panel", className, ...props }: ComponentProps<"section"> & { tone?: PanelTone }) {
  return <section className={cn("noise text-on-ink relative overflow-hidden rounded-3xl [--noise-opacity:0.16]", TONES[tone], className)} {...props} />;
}
