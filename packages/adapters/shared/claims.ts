/** Lifecycle of a claim. Postgres holds it; from funding on, the XRPL loan object backs the numbers. */
export const CLAIM_STATES = [
  "None",
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
export type ClaimState = (typeof CLAIM_STATES)[number];

/** States a claim never leaves. WrittenOff isn't one: it still takes payments. */
export const FINAL_CLAIM_STATES: readonly ClaimState[] = ["Settled", "Recovered", "Rejected", "Cancelled"];

export const RECIPIENT_TYPES = ["Member", "OrgTreasurer"] as const;
export type RecipientType = (typeof RECIPIENT_TYPES)[number];

export const CALL_REASONS = ["None", "AsucRejected", "PartialShortfall", "Overdue"] as const;
export type CallReason = (typeof CALL_REASONS)[number];

/**
 * A claim's money and dates, as the edge functions report them: amounts are integer base units of the loan asset
 * (see ASSET_DECIMALS) as bigints, timestamps are unix seconds, 0 where a step hasn't happened.
 */
export type ClaimView = {
  /** Sequential number shown on the claim card. */
  id: bigint;
  recipient: string;
  orgId: bigint;
  recipientType: RecipientType;
  state: ClaimState;
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
  /** SHA-256 of the frozen claim packet. */
  packetHash: string;
  /** What's still owed right now. */
  amountRemaining: bigint;
};

/** ClaimView as JSON: bigints arrive as decimal strings. */
export type ClaimViewJson = { [K in keyof ClaimView]: ClaimView[K] extends bigint ? string : ClaimView[K] };

const BIGINT_KEYS = [
  "id",
  "orgId",
  "faceValue",
  "requestedAmount",
  "approvedAmount",
  "purchasePrice",
  "amountDue",
  "amountPaid",
  "writtenOffPrincipal",
  "amountRemaining",
] as const satisfies readonly (keyof ClaimView)[];

/** Revives the bigints in a ClaimView that came over JSON. */
export function claimViewFromJson(json: ClaimViewJson): ClaimView {
  const out = { ...json } as unknown as Record<string, unknown>;
  for (const key of BIGINT_KEYS) out[key] = BigInt(json[key]);
  return out as ClaimView;
}
