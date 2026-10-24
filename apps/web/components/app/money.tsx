import { usd } from "@/lib/format";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "text-base",
  md: "text-2xl",
  lg: "text-[40px]",
  xl: "text-5xl sm:text-[64px]",
} as const;

/** Dollar amounts: tabular figures, and the largest text on claim and dashboard screens (BRAND.md). */
export function Money({ wei, size = "md", className }: { wei: bigint | string | null | undefined; size?: keyof typeof SIZES; className?: string }) {
  return <span className={cn("money-type", SIZES[size], className)}>{usd(wei)}</span>;
}
