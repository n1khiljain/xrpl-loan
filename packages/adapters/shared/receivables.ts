/** Lifecycle of a receivable. Postgres holds it; from funding on, the XRPL loan object backs the numbers. */
export const RECEIVABLE_STATES = [
  "None",
  "FinanceReview",
  "Submitted",
  "Approved",
  "Funded",
  "GuarantorCalled",
  "Settled",
  "Recovered",
  "WrittenOff",
  "Rejected",
  "Cancelled",
] as const;
export type ReceivableState = (typeof RECEIVABLE_STATES)[number];

/** States a receivable never leaves. WrittenOff isn't one: it still takes payments. */
export const FINAL_RECEIVABLE_STATES: readonly ReceivableState[] = ["Settled", "Recovered", "Rejected", "Cancelled"];

/** What kind of money is owed. Club reimbursements are one kind among several. */
export const RECEIVABLE_TYPES = ["card_settlement", "reimbursement", "invoice", "other"] as const;
export type ReceivableType = (typeof RECEIVABLE_TYPES)[number];

export const CALL_REASONS = ["None", "PayerRejected", "PartialShortfall", "Overdue"] as const;
export type CallReason = (typeof CALL_REASONS)[number];

/**
 * A receivable's money and dates, as the edge functions report them: amounts are integer base units of the loan asset
 * (see ASSET_DECIMALS) as bigints, timestamps are unix seconds, 0 where a step hasn't happened.
 */
export type ReceivableView = {
  /** Sequential number shown on the receivable card. */
  id: bigint;
  recipient: string;
  state: ReceivableState;
  callReason: CallReason;
  principalWrittenOff: boolean;
  guarantor: string;
  /** Yearly fee rate on unpaid principal, in basis points. */
  feeBps: number;
  submittedAt: number;
  approvalExpiresAt: number;
  faceValue: bigint;
  requestedAmount: bigint;
  approvedAmount: bigint;
  purchasePrice: bigint;
  amountDue: bigint;
  amountPaid: bigint;
  writtenOffPrincipal: bigint;
  purchasedAt: number;
  dueAt: number;
  guarantorCalledAt: number;
  writeOffEligibleAt: number;
  /** SHA-256 of the frozen receivable packet. */
  packetHash: string;
  /** What's still owed right now. */
  amountRemaining: bigint;
};

/** ReceivableView as JSON: bigints arrive as decimal strings. */
export type ReceivableViewJson = { [K in keyof ReceivableView]: ReceivableView[K] extends bigint ? string : ReceivableView[K] };

const BIGINT_KEYS = [
  "id",
  "faceValue",
  "requestedAmount",
  "approvedAmount",
  "purchasePrice",
  "amountDue",
  "amountPaid",
  "writtenOffPrincipal",
  "amountRemaining",
] as const satisfies readonly (keyof ReceivableView)[];

/** Revives the bigints in a ReceivableView that came over JSON. */
export function receivableViewFromJson(json: ReceivableViewJson): ReceivableView {
  const out = { ...json } as unknown as Record<string, unknown>;
  for (const key of BIGINT_KEYS) out[key] = BigInt(json[key]);
  return out as ReceivableView;
}
