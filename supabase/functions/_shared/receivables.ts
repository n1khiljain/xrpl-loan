import type { ReceivableState, ReceivableViewJson } from "@app/adapters";
import { z } from "zod";
import type { Caller } from "./auth.ts";
import type { CallReason, Db, Receivable, ReceivableDocument } from "./db/types.ts";
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

export async function loadReceivable(db: Db, id: string): Promise<Receivable> {
  const receivable = await db.getReceivable(id);
  if (!receivable) throw notFound("no such receivable");
  return receivable;
}

export function isSeller(caller: Caller, receivable: Receivable): boolean {
  return receivable.recipientWallet === caller.profile.wallet;
}

/** The receivable's seller only. */
export function requireSeller(caller: Caller, receivable: Receivable): void {
  if (!isSeller(caller, receivable)) throw forbidden("only the seller can do this");
}

/** Seller, guarantor, an active officer of the org, or staff. */
export async function canViewReceivable(db: Db, caller: Caller, receivable: Receivable): Promise<boolean> {
  if (isSeller(caller, receivable) || receivable.guarantorWallet === caller.profile.wallet) return true;
  if (caller.staffRole !== null) return true;
  return receivable.orgId !== null && db.isActiveOfficer(receivable.orgId, caller.profile.wallet);
}

/** Documents are readable by the seller, the org's active officers, and underwriters. */
export async function canReadReceipts(db: Db, caller: Caller, receivable: Receivable): Promise<boolean> {
  if (isSeller(caller, receivable)) return true;
  if (caller.staffRole === "underwriter") return true;
  return receivable.orgId !== null && db.isActiveOfficer(receivable.orgId, caller.profile.wallet);
}

/** A draft can change until its packet is frozen. */
export function isEditable(receivable: Receivable): boolean {
  return receivable.status === "Draft" && receivable.packetHash === null;
}

/** Sellers must be verified before they sell a receivable, and guarantors before they sign off on one. */
export function requireKycApproved(caller: Caller, role: "member" | "officer"): void {
  if (caller.profile.kycStatus === "approved") return;
  throw forbidden(
    role === "member"
      ? "Finish verification before you ask for a loan."
      : "Finish verification before you sign off.",
    "kyc_required",
  );
}

export function documentView(doc: ReceivableDocument) {
  return { id: doc.id, sha256: doc.sha256, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes, createdAt: doc.createdAt };
}

const seconds = (iso: string | null) => (iso ? Math.floor(Date.parse(iso) / 1000) : 0);

const REASON: Record<CallReason, ReceivableViewJson["callReason"]> = {
  none: "None",
  payer_rejected: "PayerRejected",
  partial_shortfall: "PartialShortfall",
  overdue: "Overdue",
};

/** What's still owed: what's due less what's been paid, never below zero. */
export function amountRemaining(receivable: Pick<Receivable, "amountDue" | "amountPaid">): bigint {
  const left = BigInt(receivable.amountDue) - BigInt(receivable.amountPaid);
  return left > 0n ? left : 0n;
}

/** The receivable's money and dates in the shape the web app's screens read, or null while it's a draft. */
export function ledgerView(receivable: Receivable): ReceivableViewJson | null {
  if (receivable.status === "Draft") return null;
  return {
    id: String(receivable.number),
    recipient: receivable.recipientWallet,
    state: receivable.status as ReceivableState,
    callReason: REASON[receivable.callReason],
    principalWrittenOff: receivable.principalWrittenOff,
    guarantor: receivable.guarantorWallet ?? "",
    feeBps: receivable.feeBps,
    submittedAt: seconds(receivable.submittedAt),
    approvalExpiresAt: seconds(receivable.approvalExpiresAt),
    faceValue: receivable.faceValue,
    requestedAmount: receivable.requestedAmount,
    approvedAmount: receivable.approvedAmount,
    purchasePrice: receivable.purchasePrice,
    amountDue: receivable.amountDue,
    amountPaid: receivable.amountPaid,
    writtenOffPrincipal: receivable.writtenOffPrincipal,
    purchasedAt: seconds(receivable.purchasedAt),
    dueAt: seconds(receivable.dueAt),
    guarantorCalledAt: seconds(receivable.guarantorCalledAt),
    writeOffEligibleAt: seconds(receivable.writeOffEligibleAt),
    packetHash: receivable.packetHash ?? "",
    amountRemaining: amountRemaining(receivable).toString(),
  };
}

export function receivableView(receivable: Receivable) {
  return {
    id: receivable.id,
    number: receivable.number,
    type: receivable.type,
    payerName: receivable.payerName,
    payerEmail: receivable.payerEmail,
    payerWallet: receivable.payerWallet,
    dueDate: receivable.dueDate,
    orgId: receivable.orgId,
    recipientWallet: receivable.recipientWallet,
    faceValue: receivable.faceValue,
    requestedAmount: receivable.requestedAmount,
    reference: receivable.reference,
    description: receivable.description,
    packetHash: receivable.packetHash,
    guarantorWallet: receivable.guarantorWallet,
    guarantySigned: receivable.guarantySignedAt !== null,
    guarantySignedAt: receivable.guarantySignedAt,
    status: receivable.status,
    rejectReason: receivable.rejectReason,
    loanId: receivable.loanId,
    payerOutcome: receivable.payerOutcome,
    payerOutcomeNote: receivable.payerOutcomeNote,
    createdAt: receivable.createdAt,
    updatedAt: receivable.updatedAt,
    ledger: ledgerView(receivable),
  };
}
