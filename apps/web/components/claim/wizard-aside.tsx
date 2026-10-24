import { GradientPanel } from "@/components/app/gradient-panel";
import { ClaimCard } from "@/components/brand/claim-card";
import { params } from "@/lib/config";
import { amountDue, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The wizard's right-column live preview (desktop only; WizardAside in the design canvas). A draft claim card plus
 * the you-receive / fee / you-settle rows, computed from the amount entered so far with `amountDue` over the full time
 * to the due date, since the fee grows the longer it's out. Hidden below
 * `lg`; the review step renders a small `ClaimCard` inline for phones instead.
 */
export function WizardAside({
  org,
  requestedUnits,
  state,
  className,
}: {
  org: string;
  requestedUnits: bigint;
  state: string;
  className?: string;
}) {
  const due = requestedUnits ? amountDue(requestedUnits, params.feeBps, params.overdueWindowSeconds) : 0n;
  const fee = due - requestedUnits;
  return (
    <GradientPanel tone="aside" className={cn("hidden w-96 shrink-0 flex-col items-center gap-[18px] p-6 lg:flex", className)}>
      <span className="eyebrow text-on-ink/60 self-start">Live preview</span>
      <ClaimCard claimId="DRAFT" amount={usd(requestedUnits)} state={state} org={org} tone="frost" />
      {/* straight on the panel, like the pool's stats: no box inside the box */}
      <dl className="divide-on-ink/12 w-full divide-y text-sm">
        {[
          ["You get now", usd(requestedUnits)],
          ["Fee, at most, if sent by the due date", usd(fee)],
          ["You send back, at most", usd(due)],
        ].map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 py-3 last:pb-0">
            <dt className="text-on-ink/60">{label}</dt>
            <dd className="tabular font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
    </GradientPanel>
  );
}
