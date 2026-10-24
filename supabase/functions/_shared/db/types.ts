/**
 * Rows from `supabase/migrations`, in camelCase. Addresses are classic XRPL addresses, amounts are integer base units
 * of the loan asset as decimal strings, and timestamps are ISO strings.
 */
export type Wallet = `r${string}`;
export type KycStatus = "not_started" | "pending" | "approved" | "rejected";
export type KycSource = "manual";
export type StaffRole = "underwriter" | "attester" | "admin";
export type RecipientType = "member" | "org_treasurer";
export type AsucOutcome = "none" | "rejected" | "short_paid";
export type CallReason = "none" | "asuc_rejected" | "partial_shortfall" | "overdue";
export type ClaimStatus =
  | "Draft"
  | "Submitted"
  | "Approved"
  | "Funded"
  | "GuarantorCalled"
  | "Settled"
  | "Recovered"
  | "WrittenOff"
  | "Rejected"
  | "Cancelled";
export type NotificationKind = "guaranty_requested" | "claim_approved" | "claim_funded" | "due_soon" | "guarantor_called";

/** A custodial wallet. `encryptedSeed` is only ever decrypted inside an edge function (see wallets.ts). */
export type WalletRow = { address: Wallet; encryptedSeed: string; fundedTx: string | null; createdAt: string };

export type Profile = {
  wallet: Wallet;
  privyUserId: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  kycStatus: KycStatus;
  kycSource: KycSource | null;
  kycUpdatedBy: Wallet | null;
  kycUpdatedAt: string | null;
  createdAt: string;
};

export type ProfilePatch = Partial<Omit<Profile, "wallet" | "privyUserId" | "createdAt">>;

export type Org = { id: number; name: string; active: boolean };
export type Officer = { orgId: number; wallet: Wallet; title: string | null; active: boolean };

export type Claim = {
  id: string;
  number: number;
  orgId: number;
  recipientWallet: Wallet;
  recipientType: RecipientType;
  faceValue: string;
  requestedAmount: string;
  callinkPrNumber: string;
  description: string | null;
  packetJson: unknown;
  packetHash: string | null;
  guarantorWallet: Wallet | null;
  guarantySignedAt: string | null;
  status: ClaimStatus;
  submittedAt: string | null;
  approvedAmount: string;
  approvedBy: Wallet | null;
  approvalExpiresAt: string | null;
  rejectReason: string | null;
  feeBps: number;
  purchasePrice: string;
  amountDue: string;
  amountPaid: string;
  purchasedAt: string | null;
  dueAt: string | null;
  loanId: string | null;
  callReason: CallReason;
  guarantorCalledAt: string | null;
  writeOffEligibleAt: string | null;
  principalWrittenOff: boolean;
  writtenOffPrincipal: string;
  asucOutcome: AsucOutcome;
  asucOutcomeNote: string | null;
  asucOutcomeAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewClaim = Pick<
  Claim,
  "orgId" | "recipientWallet" | "recipientType" | "faceValue" | "requestedAmount" | "callinkPrNumber" | "description" | "guarantorWallet"
>;

export type ClaimPatch = Partial<Omit<Claim, "id" | "number" | "orgId" | "recipientWallet" | "createdAt" | "updatedAt">>;

export type ClaimDocument = {
  id: string;
  claimId: string;
  storagePath: string;
  sha256: string | null;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: Wallet;
  createdAt: string;
};

export type GuarantorInvite = {
  id: string;
  claimId: string;
  guarantorWallet: Wallet;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
};

/** An XRPL transaction the app submitted or saw, kept for explorer links. */
export type LedgerTx = {
  txHash: string;
  txType: string;
  account: Wallet;
  claimId: string | null;
  purpose: string;
  result: string;
  createdAt: string;
};

export type ClaimScope =
  /** Claims the wallet sells, guarantees, or can see as an officer of the org. */
  | { kind: "wallet"; wallet: Wallet; officerOrgIds: number[] }
  /** Every claim, for staff. */
  | { kind: "all" }
  /** Claims with a payer outcome report, for the attester's exceptions list. */
  | { kind: "reported" };

export type NotificationKey = { wallet: Wallet; kind: NotificationKind; claimId: string };

/** Thrown when an insert breaks a unique constraint. `constraint` names it. */
export class UniqueViolation extends Error {
  constructor(readonly constraint: string) {
    super(`unique violation: ${constraint}`);
    this.name = "UniqueViolation";
  }
}

/**
 * Everything the functions read and write. `SupabaseDb` implements it with the service role; `MemoryDb` backs
 * the Deno tests. `db_contract.test.ts` runs one suite against both.
 */
export interface Db {
  insertWallet(w: Pick<WalletRow, "address" | "encryptedSeed">): Promise<WalletRow>;
  getWallet(address: Wallet): Promise<WalletRow | null>;
  setWalletFunded(address: Wallet, txHash: string): Promise<void>;

  getProfile(wallet: Wallet): Promise<Profile | null>;
  getProfileByPrivyId(privyUserId: string): Promise<Profile | null>;
  insertProfile(p: Pick<Profile, "wallet" | "privyUserId" | "email" | "emailVerified" | "displayName">): Promise<Profile>;
  updateProfile(wallet: Wallet, patch: ProfilePatch): Promise<Profile>;
  /** Profiles by KYC status, newest first, for the staff KYC list. */
  listProfilesByKyc(statuses: KycStatus[]): Promise<Profile[]>;

  getStaffRole(wallet: Wallet): Promise<StaffRole | null>;

  insertOrg(name: string): Promise<Org>;
  getOrg(id: number): Promise<Org | null>;
  listOrgs(): Promise<Org[]>;
  setOrgActive(id: number, active: boolean): Promise<void>;
  upsertOfficer(officer: Officer): Promise<void>;
  isActiveOfficer(orgId: number, wallet: Wallet): Promise<boolean>;
  listOfficerOrgs(wallet: Wallet): Promise<Array<{ orgId: number; name: string; title: string | null }>>;
  /** Active orgs with their active officers and the officers' display names (for picking a guarantor). */
  listActiveOrgsWithOfficers(): Promise<Array<Org & { officers: Array<{ wallet: Wallet; title: string | null; displayName: string | null }> }>>;

  insertClaim(claim: NewClaim): Promise<Claim>;
  getClaim(id: string): Promise<Claim | null>;
  updateClaim(id: string, patch: ClaimPatch): Promise<Claim>;
  /**
   * Updates only if the claim is still in `from`; returns null when another request moved it first, so two clicks
   * can't both approve or fund.
   */
  transitionClaim(id: string, from: ClaimStatus[], patch: ClaimPatch): Promise<Claim | null>;
  listClaims(scope: ClaimScope): Promise<Claim[]>;
  listClaimsByStatus(statuses: ClaimStatus[]): Promise<Claim[]>;

  insertDocument(doc: Omit<ClaimDocument, "id" | "createdAt" | "sha256"> & { id?: string }): Promise<ClaimDocument>;
  getDocument(id: string): Promise<ClaimDocument | null>;
  listDocuments(claimId: string): Promise<ClaimDocument[]>;
  setDocumentHash(id: string, sha256: string): Promise<ClaimDocument>;

  insertInvite(invite: Omit<GuarantorInvite, "id" | "createdAt" | "usedAt">): Promise<GuarantorInvite>;
  getInviteByTokenHash(tokenHash: string): Promise<GuarantorInvite | null>;
  markInviteUsed(id: string): Promise<void>;
  /** Invites created for the claim at or after `since` (an ISO timestamp), used or not. */
  countInvitesSince(claimId: string, since: string): Promise<number>;

  recordLedgerTx(tx: Omit<LedgerTx, "createdAt">): Promise<void>;
  listLedgerTxs(filter: { claimId?: string; account?: Wallet; limit?: number }): Promise<LedgerTx[]>;

  insertAdminAction(action: { actorWallet: Wallet; action: string; target: string; payload: Record<string, unknown> }): Promise<void>;

  /** Records an email that was sent. False if this one was recorded before. */
  recordNotification(n: NotificationKey): Promise<boolean>;

  /** Atomic: records `key` and returns true the first time, false if it was recorded before. */
  claimOnce(key: string): Promise<boolean>;
  /** Forgets `key`, so a step that failed after `claimOnce` can be tried again. */
  releaseOnce(key: string): Promise<void>;

  getSyncLedger(key: string): Promise<number | null>;
  setSyncLedger(key: string, ledger: number): Promise<void>;
}
