/** Reject reason codes the underwriter picks from. */
export const REJECT_REASONS = [
  { code: "MISSING_RECEIPTS", label: "Receipts missing or unreadable" },
  { code: "NOT_REIMBURSABLE", label: "The payer won't pay this" },
  { code: "DUPLICATE", label: "Already used for another loan" },
  { code: "KYC_NOT_APPROVED", label: "KYC not approved" },
  { code: "OVER_LIMIT", label: "Over a limit" },
  { code: "OTHER", label: "Other" },
] as const;

/** Why the guarantor is called. The first two can be called any time; overdue only after the due date. */
export const CALL_REASONS = [
  { value: "payer_rejected", label: "Payer rejected it" },
  { value: "partial_shortfall", label: "Payer paid less" },
  { value: "overdue", label: "Overdue" },
] as const;
export type CallReasonValue = (typeof CALL_REASONS)[number]["value"];
