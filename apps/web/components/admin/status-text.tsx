import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONE = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  muted: "text-muted-foreground",
} as const;

export type StatusTone = keyof typeof TONE;

/** A status as colored text, not a pill. */
export function StatusText({ tone, children, className, ...props }: { tone: StatusTone; children: ReactNode; className?: string; "data-testid"?: string }) {
  return (
    <span className={cn("shrink-0 text-xs font-semibold whitespace-nowrap", TONE[tone], className)} {...props}>
      {children}
    </span>
  );
}

/** KYC status to a tone. */
export function kycTone(status: string): StatusTone {
  return status === "approved" ? "success" : status === "rejected" ? "danger" : "warning";
}
