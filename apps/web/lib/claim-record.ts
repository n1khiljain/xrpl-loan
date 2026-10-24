import type { ClaimView } from "@app/adapters";
import type { DisplayState } from "@/components/app/state-chip";
import type { TimelineStep } from "@/components/app/timeline";
import { dateFromSeconds, dateTime, usd } from "./format";
import type { OffchainClaim } from "./types";

/** Where the claim stands. The backend keeps one status; the ledger view only adds its numbers. */
export function displayState(claim: OffchainClaim, _onchain?: ClaimView | null): DisplayState {
  return claim.status;
}

export function timeline(claim: OffchainClaim, onchain: ClaimView | null): TimelineStep[] {
  const state = displayState(claim, onchain);
  const at = (s: number | undefined) => (s ? dateFromSeconds(s) : undefined);
  const reached = (states: DisplayState[]) => states.includes(state);
  const afterPurchase: DisplayState[] = ["Funded", "GuarantorCalled", "Settled", "Recovered", "WrittenOff"];
  const afterApproval: DisplayState[] = ["Approved", ...afterPurchase];
  const afterSubmit: DisplayState[] = ["Submitted", "Rejected", "Cancelled", ...afterApproval];

  const steps: TimelineStep[] = [
    { label: "Started", detail: dateTime(claim.createdAt), status: "done" },
    {
      label: "Approver signed off",
      status: claim.guarantySigned || reached(afterSubmit) ? "done" : claim.packetHash ? "current" : "upcoming",
    },
    {
      label: "Sent for review",
      detail: at(onchain?.submittedAt),
      status: reached(afterSubmit) ? "done" : claim.guarantySigned ? "current" : "upcoming",
    },
  ];
  if (state === "Rejected") return [...steps, { label: "Not approved", status: "failed" }];
  if (state === "Cancelled") return [...steps, { label: "Cancelled", status: "failed" }];
  steps.push(
    {
      label: "Approved",
      detail: onchain && reached(afterApproval) ? `For ${usd(onchain.approvedAmount)}` : undefined,
      status: reached(afterApproval) ? "done" : state === "Submitted" ? "current" : "upcoming",
    },
    {
      label: "You got paid",
      detail: at(onchain?.purchasedAt),
      status: reached(afterPurchase) ? "done" : state === "Approved" ? "current" : "upcoming",
    },
  );
  if (state === "GuarantorCalled" || state === "WrittenOff" || state === "Recovered" && (onchain?.guarantorCalledAt ?? 0) > 0) {
    steps.push({ label: "Approver asked to cover", detail: at(onchain?.guarantorCalledAt), status: state === "Recovered" ? "done" : "failed" });
  }
  if (state === "WrittenOff") steps.push({ label: "Written off", status: "failed" });
  steps.push({
    label: "Sent back to the vault, closed out",
    detail: state === "Funded" && onchain ? `Due ${dateFromSeconds(onchain.dueAt)}` : undefined,
    status: state === "Settled" || state === "Recovered" ? "done" : state === "Funded" ? "current" : "upcoming",
  });
  return steps;
}
