import { z } from "zod";
import type { Caller } from "./auth.ts";
import type { Claim, ClaimDocument, Db } from "./db/types.ts";
import { forbidden, notFound } from "./http.ts";

export const UINT128_MAX = 2n ** 128n - 1n;

/** frxUSD wei as a decimal string, above zero and within uint128. */
export const weiString = z
  .string()
  // abort: later checks still run after a failed one in zod 4, and BigInt() throws on non-digits
  .regex(/^[1-9][0-9]*$/, { message: "must be a positive decimal string of wei", abort: true })
  .refine((v) => BigInt(v) <= UINT128_MAX, "must fit in uint128");

export const uuid = z.uuid();
export const hexSignature = z.string().regex(/^0x[0-9a-fA-F]+$/, "must be hex").transform((v) => v.toLowerCase() as `0x${string}`);
export const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be an address").transform((v) => v.toLowerCase() as `0x${string}`);

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

/** Claimant, guarantor, an active officer of the org, or staff (SYSTEM_DESIGN 5.2). */
export async function canViewClaim(db: Db, caller: Caller, claim: Claim): Promise<boolean> {
  if (isClaimant(caller, claim) || claim.guarantorWallet === caller.profile.wallet) return true;
  if (caller.staffRole !== null) return true;
  return db.isActiveOfficer(claim.orgId, caller.profile.wallet);
}

/** Receipts are readable by the claimant, the org's active officers, and underwriters (FR-B3). UNCERTAIN: U-57 */
export async function canReadReceipts(db: Db, caller: Caller, claim: Claim): Promise<boolean> {
  if (isClaimant(caller, claim)) return true;
  if (caller.staffRole === "underwriter") return true;
  return db.isActiveOfficer(claim.orgId, caller.profile.wallet);
}

/** A draft can change until its packet is frozen. */
export function isEditable(claim: Claim): boolean {
  return claim.statusCache === "Draft" && claim.packetHash === null;
}

export function documentView(doc: ClaimDocument) {
  return { id: doc.id, sha256: doc.sha256, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes, createdAt: doc.createdAt };
}

export function claimView(claim: Claim) {
  return {
    id: claim.id,
    onchainClaimId: claim.onchainClaimId,
    orgId: claim.orgId,
    recipientWallet: claim.recipientWallet,
    recipientType: claim.recipientType,
    faceValue: claim.faceValue,
    requestedAmount: claim.requestedAmount,
    callinkPrNumber: claim.callinkPrNumber,
    description: claim.description,
    packetHash: claim.packetHash,
    guarantorWallet: claim.guarantorWallet,
    guarantySigned: claim.guarantySignature !== null,
    guarantySignature: claim.guarantySignature,
    guarantyNonce: claim.guarantyNonce,
    guarantyDeadline: claim.guarantyDeadline,
    status: claim.statusCache,
    asucOutcome: claim.asucOutcome,
    asucOutcomeNote: claim.asucOutcomeNote,
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt,
  };
}
