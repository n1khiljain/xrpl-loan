import { Swap } from "@/components/motion";
import { cn } from "@/lib/utils";

/** "JP" from "Jordan Park"; empty when there's no name yet, so the circle stays plain. */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") : "";
}

/**
 * Someone's initials in a plain circle (U-75). `onInk` is the white circle for the dark sidebar; otherwise it's dark
 * on light. The letters swap in when the name changes.
 */
export function Avatar({ name, onInk = false, className }: { name: string | null | undefined; onInk?: boolean; className?: string }) {
  const letters = initials(name);
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold",
        onInk ? "bg-on-ink text-ink" : "bg-ink text-on-ink",
        className,
      )}
    >
      <Swap id={letters}>{letters}</Swap>
    </span>
  );
}
