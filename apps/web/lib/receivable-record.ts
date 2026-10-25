import type { ReceivableView } from "@app/adapters";
import type { DisplayState } from "@/components/app/state-chip";
import type { TimelineStep } from "@/components/app/timeline";
import { dateFromSeconds, dateTime, usd } from "./format";
import type { OffchainReceivable } from "./types";

/** Where the receivable stands. The backend keeps one status; the ledger view only adds its numbers. */
export function displayState(receivable: OffchainReceivable, _onchain?: ReceivableView | null): DisplayState {
  return receivable.status;
}

export function timeline(receivable: OffchainReceivable, onchain: ReceivableView | null): TimelineStep[] {
  const state = displayState(receivable, onchain);
  const at = (s: number | undefined) => (s ? dateFromSeconds(s) : undefined);
  const reached = (states: DisplayState[]) => states.includes(state);
  const afterPurchase: DisplayState[] = ["Funded", "GuarantorCalled", "Settled", "Recovered", "WrittenOff"];
  const afterApproval: DisplayState[] = ["Approved", ...afterPurchase];
  const afterSubmit: DisplayState[] = ["Submitted", "Rejected", "Cancelled", ...afterApproval];
  const sent = reached(afterSubmit) || state === "FinanceReview";
  // a finance agent reviewed it when one cleared it, or it's waiting on one now
  const needsFinance = state === "FinanceReview" || Boolean(receivable.financeClearedAt);

  // only an org's receivable waits on an officer before it can go for review
  const needsSignOff = receivable.guarantorWallet !== null;
  const readyToSend = needsSignOff ? receivable.guarantySigned : receivable.packetHash !== null;
  const steps: TimelineStep[] = [
    { label: "Started", detail: dateTime(receivable.createdAt), status: "done" },
    ...(needsSignOff
      ? [
          {
            label: "Approver signed off",
            status: (receivable.guarantySigned || sent ? "done" : receivable.packetHash ? "current" : "upcoming") as TimelineStep["status"],
          },
        ]
      : []),
    {
      label: "Sent for review",
      detail: at(onchain?.submittedAt),
      status: sent ? "done" : readyToSend ? "current" : "upcoming",
    },
    ...(needsFinance
      ? [
          {
            label: "Finance agent",
            status: (state === "FinanceReview" ? "current" : reached(afterSubmit) ? "done" : "upcoming") as TimelineStep["status"],
          },
        ]
      : []),
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
      label: "You got the loan",
      detail: at(onchain?.purchasedAt),
      status: reached(afterPurchase) ? "done" : state === "Approved" ? "current" : "upcoming",
    },
  );
  if (state === "GuarantorCalled" || state === "WrittenOff" || state === "Recovered" && (onchain?.guarantorCalledAt ?? 0) > 0) {
    steps.push({ label: "Approver asked to cover", detail: at(onchain?.guarantorCalledAt), status: state === "Recovered" ? "done" : "failed" });
  }
  if (receivable.impairedAt && !receivable.defaultedAt && state !== "Settled") {
    steps.push({ label: "Payment missed", detail: dateTime(receivable.impairedAt), status: "failed" });
  }
  if (receivable.defaultedAt) steps.push({ label: "Defaulted on the ledger", detail: dateTime(receivable.defaultedAt), status: "failed" });
  else if (state === "WrittenOff") steps.push({ label: "Written off", status: "failed" });
  steps.push({
    label: "Paid back, closed out",
    detail: state === "Funded" && onchain ? `Due ${dateFromSeconds(onchain.dueAt)}` : undefined,
    status: state === "Settled" || state === "Recovered" ? "done" : state === "Funded" ? "current" : "upcoming",
  });
  return steps;
}
