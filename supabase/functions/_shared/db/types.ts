/**
 * Rows from `supabase/migrations`, in camelCase. Addresses are lowercase hex, wei amounts are decimal strings,
 * and timestamps are ISO strings.
 */
export type Wallet = `0x${string}`;
export type KycStatus = "not_started" | "pending" | "approved" | "rejected";
export type KycSource = "fraxnet_api" | "manual";
export type StaffRole = "underwriter" | "attester" | "admin";
export type RecipientType = "member" | "org_treasurer";
export type AsucOutcome = "none" | "rejected" | "short_paid";
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

export type Profile = {
  wallet: Wallet;
  privyUserId: string;
  email: string | null;
  displayName: string | null;
  kycStatus: KycStatus;
  kycSource: KycSource | null;
  kycUpdatedBy: Wallet | null;
  kycUpdatedAt: string | null;
  fraxnetAccountRef: string | null;
  liquidationAddress: Wallet | null;
  createdAt: string;
};

/** A FraxNet sign-in in progress (U-77). Kept server side so the browser never sees the PKCE verifier. */
export type FraxnetOAuthState = { state: string; wallet: Wallet; codeVerifier: string; nonce: string; expiresAt: string };

/** A member's connected FraxNet account and its tokens (U-77). The org fields mirror GET /org at the last check. */
export type FraxnetConnection = {
  wallet: Wallet;
  fraxnetUserId: string;
  orgId: string;
  orgName: string;
  orgVerified: boolean;
  orgVerifiedAt: string | null;
  orgIsBusiness: boolean | null;
  email: string | null;
  scopes: string[];
  refreshToken: string | null;
  accessToken: string | null;
  accessExpiresAt: string | null;
  needsReconnect: boolean;
  /** When connecting added the app wallet to the FraxNet organization (U-78) */
  walletAddedAt: string | null;
  connectedAt: string;
  checkedAt: string;
};

export type FraxnetConnectionPatch = Partial<Omit<FraxnetConnection, "wallet" | "fraxnetUserId" | "connectedAt">>;

export type Org = { id: number; name: string; active: boolean };
export type Officer = { orgId: number; wallet: Wallet; title: string | null; active: boolean };

export type Claim = {
  id: string;
  onchainClaimId: number | null;
  orgId: number;
  recipientWallet: Wallet;
  recipientType: RecipientType;
  faceValue: string;
  requestedAmount: string;
  callinkPrNumber: string;
  description: string | null;
  packetJson: unknown;
  packetHash: `0x${string}` | null;
  guarantorWallet: Wallet | null;
  guarantySignature: `0x${string}` | null;
  guarantyNonce: string | null;
  guarantyDeadline: number | null;
  statusCache: ClaimStatus;
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

export type ClaimPatch = Partial<
  Pick<
    Claim,
    | "onchainClaimId"
    | "recipientType"
    | "faceValue"
    | "requestedAmount"
    | "callinkPrNumber"
    | "description"
    | "packetJson"
    | "packetHash"
    | "guarantorWallet"
    | "guarantySignature"
    | "guarantyNonce"
    | "guarantyDeadline"
    | "statusCache"
    | "asucOutcome"
    | "asucOutcomeNote"
    | "asucOutcomeAt"
  >
>;

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

export type ClaimScope =
  /** Claims the wallet sells, guarantees, or can see as an officer of the org. */
  | { kind: "wallet"; wallet: Wallet; officerOrgIds: number[] }
  /** Every claim, for staff. */
  | { kind: "all" }
  /** Claims with an ASUC outcome report, for the attester's exceptions list (FR-B11). */
  | { kind: "reported" };

export type NotificationKey = { wallet: Wallet; kind: NotificationKind; claimId: string };
/** Template fields for a queued email: amounts as wei strings, dates as unix seconds, the claim link. */
export type NotificationData = Record<string, string | number>;
export type PendingNotification = NotificationKey & { id: string; data: NotificationData; attempts: number };

/** Thrown when an insert breaks a unique constraint. `constraint` names it. */
export class UniqueViolation extends Error {
  constructor(readonly constraint: string) {
    super(`unique violation: ${constraint}`);
    this.name = "UniqueViolation";
  }
}

/**
 * Everything the functions read and write. `SupabaseDb` implements it with the service role; `MemoryDb` backs
 * the Deno tests. `db_contract.ts` runs one suite against both.
 */
export interface Db {
  getProfile(wallet: Wallet): Promise<Profile | null>;
  getProfileByPrivyId(privyUserId: string): Promise<Profile | null>;
  insertProfile(p: Pick<Profile, "wallet" | "privyUserId" | "email" | "displayName">): Promise<Profile>;
  updateProfile(
    wallet: Wallet,
    patch: Partial<Omit<Profile, "wallet" | "privyUserId" | "createdAt">>,
  ): Promise<Profile>;

  getStaffRole(wallet: Wallet): Promise<StaffRole | null>;

  /** Saves a new FraxNet sign-in attempt, dropping the wallet's expired ones. */
  insertFraxnetState(s: FraxnetOAuthState): Promise<void>;
  /** Deletes and returns the attempt, only if it belongs to `wallet`. Each state works once. */
  takeFraxnetState(state: string, wallet: Wallet): Promise<FraxnetOAuthState | null>;
  getFraxnetConnection(wallet: Wallet): Promise<FraxnetConnection | null>;
  /**
   * Inserts or replaces the wallet's connection (a reconnect may switch FraxNet accounts). Throws
   * `UniqueViolation("fraxnet_connections_fraxnet_user_id_key")` when that FraxNet user backs another wallet.
   */
  upsertFraxnetConnection(c: Omit<FraxnetConnection, "connectedAt" | "checkedAt">): Promise<FraxnetConnection>;
  updateFraxnetConnection(wallet: Wallet, patch: FraxnetConnectionPatch): Promise<FraxnetConnection>;

  getOrg(id: number): Promise<Org | null>;
  upsertOrg(org: Org): Promise<void>;
  setOrgActive(id: number, active: boolean): Promise<void>;
  upsertOfficer(officer: Omit<Officer, "title">): Promise<void>;
  isActiveOfficer(orgId: number, wallet: Wallet): Promise<boolean>;
  listOfficerOrgs(wallet: Wallet): Promise<Array<{ orgId: number; name: string; title: string | null }>>;
  /** Active orgs with their active officers and the officers' display names (for picking a guarantor). */
  listActiveOrgsWithOfficers(): Promise<Array<Org & { officers: Array<{ wallet: Wallet; title: string | null; displayName: string | null }> }>>;

  insertClaim(claim: NewClaim): Promise<Claim>;
  getClaim(id: string): Promise<Claim | null>;
  getClaimByPacketHash(packetHash: string): Promise<Claim | null>;
  getClaimByOnchainId(onchainClaimId: number): Promise<Claim | null>;
  updateClaim(id: string, patch: ClaimPatch): Promise<Claim>;
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

  /** Atomic: null when the wallet already has a top-up newer than the window (FR-B7). */
  reserveGasDrip(wallet: Wallet, windowSeconds: number): Promise<string | null>;
  confirmGasDrip(id: string, sent: { txHash: `0x${string}` | null; amountWei: bigint }): Promise<void>;
  releaseGasDrip(id: string): Promise<void>;

  insertAdminAction(action: { actorWallet: Wallet; action: string; target: string; payload: Record<string, unknown> }): Promise<void>;

  /** Records an email that was already sent. False if this one was recorded before. */
  recordNotification(n: NotificationKey): Promise<boolean>;
  /** Queues an email to send once. False when this one was already queued or sent. */
  enqueueNotification(n: NotificationKey, data: NotificationData): Promise<boolean>;
  /** Unsent emails, oldest first. */
  listPendingNotifications(limit: number): Promise<PendingNotification[]>;
  markNotificationSent(id: string): Promise<void>;
  markNotificationFailed(id: string, error: string): Promise<void>;

  /** Atomic: records `key` and returns true the first time, false if it was recorded before. */
  claimOnce(key: string): Promise<boolean>;
  /** Forgets `key`, so a step that failed after `claimOnce` can be tried again. */
  releaseOnce(key: string): Promise<void>;

  getSyncBlock(key: string): Promise<number | null>;
  setSyncBlock(key: string, block: number): Promise<void>;
}
