import type { ClaimState, ClaimViewJson } from "@app/adapters";
import { z } from "zod";
import type { Caller } from "./auth.ts";
import type { CallReason, Claim, ClaimDocument, Db, RecipientType } from "./db/types.ts";
import { forbidden, notFound } from "./http.ts";

/** Largest amount accepted anywhere: a trillion dollars in base units, far above any cap. */
export const MAX_UNITS = 10n ** 18n;

/** Base units of the loan asset as a decimal string, above zero. */
export const unitsString = z
  .string()
  // abort: later checks still run after a failed one in zod 4, and BigInt() throws on non-digits
  .regex(/^[1-9][0-9]*$/, { message: "must be a positive decimal string of base units", abort: true })
  .refine((v) => BigInt(v) <= MAX_UNITS, "is too large");

export const uuid = z.uuid();
export const xrplAddress = z
  .string()
  .regex(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/, "must be an XRPL address")
  .transform((v) => v as `r${string}`);

export async function loadClaim(db: Db, id: string): Promise<Claim> {
  const claim = await db.getClaim(id);
  if (!claim) throw notFound("no such claim");
  return claim;
}

export function isClaimant(caller: Caller, claim: Claim): boolean {
  return claim.recipientWallet === caller.profile.wallet;
}

/** The claim's seller only. */
export function requireClaimant(caller: Caller, claim: Claim): void {
  if (!isClaimant(caller, claim)) throw forbidden("only the claimant can do this");
}

/** Claimant, guarantor, an active officer of the org, or staff. */
export async function canViewClaim(db: Db, caller: Caller, claim: Claim): Promise<boolean> {
  if (isClaimant(caller, claim) || claim.guarantorWallet === caller.profile.wallet) return true;
  if (caller.staffRole !== null) return true;
  return db.isActiveOfficer(claim.orgId, caller.profile.wallet);
}

/** Documents are readable by the claimant, the org's active officers, and underwriters. */
export async function canReadReceipts(db: Db, caller: Caller, claim: Claim): Promise<boolean> {
  if (isClaimant(caller, claim)) return true;
  if (caller.staffRole === "underwriter") return true;
  return db.isActiveOfficer(claim.orgId, caller.profile.wallet);
}

/** A draft can change until its packet is frozen. */
export function isEditable(claim: Claim): boolean {
  return claim.status === "Draft" && claim.packetHash === null;
}

/** Members must be verified before they sell a claim, and officers before they sign off on one. */
export function requireKycApproved(caller: Caller, role: "member" | "officer"): void {
  if (caller.profile.kycStatus === "approved") return;
  throw forbidden(
    role === "member"
      ? "Finish verification before you ask for a loan."
      : "Finish verification before you sign off.",
    "kyc_required",
  );
}

export function documentView(doc: ClaimDocument) {
  return { id: doc.id, sha256: doc.sha256, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes, createdAt: doc.createdAt };
}

const seconds = (iso: string | null) => (iso ? Math.floor(Date.parse(iso) / 1000) : 0);

const RECIPIENT: Record<RecipientType, ClaimViewJson["recipientType"]> = { member: "Member", org_treasurer: "OrgTreasurer" };
const REASON: Record<CallReason, ClaimViewJson["callReason"]> = {
  none: "None",
  asuc_rejected: "AsucRejected",
  partial_shortfall: "PartialShortfall",
  overdue: "Overdue",
};

/** What's still owed: what's due less what's been paid, never below zero. */
export function amountRemaining(claim: Pick<Claim, "amountDue" | "amountPaid">): bigint {
  const left = BigInt(claim.amountDue) - BigInt(claim.amountPaid);
  return left > 0n ? left : 0n;
}

/** The claim's money and dates in the shape the web app's screens read, or null while it's a draft. */
export function ledgerView(claim: Claim): ClaimViewJson | null {
  if (claim.status === "Draft") return null;
  return {
    id: String(claim.number),
    recipient: claim.recipientWallet,
    orgId: String(claim.orgId),
    recipientType: RECIPIENT[claim.recipientType],
    state: claim.status as ClaimState,
    callReason: REASON[claim.callReason],
    principalWrittenOff: claim.principalWrittenOff,
    guarantor: claim.guarantorWallet ?? "",
    feeBps: claim.feeBps,
    submittedAt: seconds(claim.submittedAt),
    approvalExpiresAt: seconds(claim.approvalExpiresAt),
    faceValue: claim.faceValue,
    requestedAmount: claim.requestedAmount,
    approvedAmount: claim.approvedAmount,
    purchasePrice: claim.purchasePrice,
    amountDue: claim.amountDue,
    amountPaid: claim.amountPaid,
    writtenOffPrincipal: claim.writtenOffPrincipal,
    purchasedAt: seconds(claim.purchasedAt),
    dueAt: seconds(claim.dueAt),
    guarantorCalledAt: seconds(claim.guarantorCalledAt),
    writeOffEligibleAt: seconds(claim.writeOffEligibleAt),
    packetHash: claim.packetHash ?? "",
    amountRemaining: amountRemaining(claim).toString(),
  };
}

export function claimView(claim: Claim) {
  return {
    id: claim.id,
    number: claim.number,
    orgId: claim.orgId,
    recipientWallet: claim.recipientWallet,
    recipientType: claim.recipientType,
    faceValue: claim.faceValue,
    requestedAmount: claim.requestedAmount,
    callinkPrNumber: claim.callinkPrNumber,
    description: claim.description,
    packetHash: claim.packetHash,
    guarantorWallet: claim.guarantorWallet,
    guarantySigned: claim.guarantySignedAt !== null,
    guarantySignedAt: claim.guarantySignedAt,
    status: claim.status,
    rejectReason: claim.rejectReason,
    loanId: claim.loanId,
    asucOutcome: claim.asucOutcome,
    asucOutcomeNote: claim.asucOutcomeNote,
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt,
    ledger: ledgerView(claim),
  };
}
