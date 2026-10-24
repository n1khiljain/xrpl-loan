/** Reject reason codes; the list lives in the app, not onchain (U-48). */
export const REJECT_REASONS = [
  { code: "MISSING_RECEIPTS", label: "Receipts missing or unreadable" },
  { code: "NOT_REIMBURSABLE", label: "ASUC won't reimburse this" },
  { code: "DUPLICATE", label: "Already claimed" },
  { code: "KYC_NOT_APPROVED", label: "KYC not approved" },
  { code: "OVER_LIMIT", label: "Over a limit" },
  { code: "OTHER", label: "Other" },
] as const;


/** CallReason in ClaimTypes.sol. AsucRejected and PartialShortfall can be called any time; Overdue after dueAt (U-29). */
export const CALL_REASONS = [
  { value: 1, key: "AsucRejected", label: "ASUC rejected it" },
  { value: 2, key: "PartialShortfall", label: "ASUC paid less" },
  { value: 3, key: "Overdue", label: "Overdue" },
] as const;
