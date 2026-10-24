import type { Address, Hash, Hex } from "viem";

/** `ClaimState` from `ClaimTypes.sol`, in enum order. */
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

/** States a claim never leaves, so nothing about it changes again (I-6). WrittenOff isn't one: it still takes payments. */
export const FINAL_CLAIM_STATES: readonly ClaimState[] = ["Settled", "Recovered", "Rejected", "Cancelled"];

export const RECIPIENT_TYPES = ["Member", "OrgTreasurer"] as const;
export type RecipientType = (typeof RECIPIENT_TYPES)[number];

export const CALL_REASONS = ["None", "AsucRejected", "PartialShortfall", "Overdue"] as const;
export type CallReason = (typeof CALL_REASONS)[number];

/** A claim as `ClaimRegistry.getClaim` returns it, with enums as names, timestamps in seconds, amounts in wei. */
export type ClaimView = {
  id: bigint;
  recipient: Address;
  orgId: bigint;
  recipientType: RecipientType;
  state: ClaimState;
  callReason: CallReason;
  principalWrittenOff: boolean;
  guarantor: Address;
  /** Annual fee rate on unpaid principal, in basis points (U-84). */
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
  /** Last time the fee was added to `amountDue`. */
  feeAccruedAt: number;
  packetHash: Hex;
  /** What's still owed right now, fee accrued to the latest block included: `ClaimRegistry.amountRemaining`. */
  amountRemaining: bigint;
};

/** The raw tuple viem decodes from `getClaim`. */
export type RawClaim = {
  id: bigint;
  recipient: Address;
  orgId: bigint;
  recipientType: number;
  state: number;
  callReason: number;
  principalWrittenOff: boolean;
  guarantor: Address;
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
  feeAccruedAt: number;
  packetHash: Hex;
};

function enumName<T extends readonly string[]>(names: T, index: number, label: string): T[number] {
  const name = names[index];
  if (name === undefined) throw new RangeError(`unknown ${label} ${index}`);
  return name;
}

/**
 * `amountRemaining` should come from `ClaimRegistry.amountRemaining`: the stored `amountDue` only includes fee
 * accrued up to the claim's last payment, guarantor call, or write-off. Without it, the stored figure is used.
 */
export function toClaimView(raw: RawClaim, amountRemaining: bigint = raw.amountDue - raw.amountPaid): ClaimView {
  return {
    ...raw,
    recipientType: enumName(RECIPIENT_TYPES, raw.recipientType, "RecipientType"),
    state: enumName(CLAIM_STATES, raw.state, "ClaimState"),
    callReason: enumName(CALL_REASONS, raw.callReason, "CallReason"),
    amountRemaining,
  };
}

/** Events from `ClaimRegistry` and `OrgRegistry` that offchain state is rebuilt from. */
export const CLAIM_EVENT_NAMES = [
  "ClaimSubmitted",
  "ClaimCancelled",
  "ClaimApproved",
  "ClaimRejected",
  "ClaimPurchased",
  "ClaimSettlementPaid",
  "ClaimSettled",
  "GuarantorCalled",
  "ClaimRecovered",
  "ClaimWrittenOff",
] as const;
export type ClaimEventName = (typeof CLAIM_EVENT_NAMES)[number];

export const ORG_EVENT_NAMES = ["OrgAdded", "OrgActiveSet", "OfficerSet"] as const;
export type OrgEventName = (typeof ORG_EVENT_NAMES)[number];

/** A decoded event argument: uints wider than 48 bits are bigints, smaller ones and enums are numbers. */
export type EventArg = bigint | number | string | boolean;

type EventBase = {
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hash;
  args: Readonly<Record<string, EventArg>>;
};

export type ClaimEvent = EventBase & { contract: "ClaimRegistry"; name: ClaimEventName; claimId: bigint };
export type OrgEvent = EventBase & { contract: "OrgRegistry"; name: OrgEventName; orgId: bigint };
export type ChainEvent = ClaimEvent | OrgEvent;

export function compareEvents(a: EventBase, b: EventBase): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  return a.logIndex - b.logIndex;
}
