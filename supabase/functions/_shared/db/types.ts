/**
 * Rows from `supabase/migrations`, in camelCase. Addresses are classic XRPL addresses, amounts are integer base units
 * of the loan asset as decimal strings, and timestamps are ISO strings.
 */
export type Wallet = `r${string}`;
export type KycStatus = "not_started" | "pending" | "approved" | "rejected";
export type KycSource = "manual";
export type StaffRole = "underwriter" | "attester" | "admin";
export type ReceivableType = "card_settlement" | "reimbursement" | "invoice" | "other";
export type PayerOutcome = "none" | "rejected" | "short_paid";
export type CallReason = "none" | "payer_rejected" | "partial_shortfall" | "overdue";
export type ReceivableStatus =
  | "Draft"
  | "FinanceReview"
  | "Submitted"
  | "Approved"
  | "Funded"
  | "GuarantorCalled"
  | "Settled"
  | "Recovered"
  | "WrittenOff"
  | "Rejected"
  | "Cancelled";
export type NotificationKind = "guaranty_requested" | "receivable_approved" | "receivable_funded" | "due_soon" | "guarantor_called";

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

export type Org = { id: number; name: string; active: boolean; joinCode: string };
export type Officer = { orgId: number; wallet: Wallet; title: string | null; active: boolean };

/** One organization per person. A finance agent has no title; everyone else has one. */
export type OrgMember = { orgId: number; wallet: Wallet; financeAgent: boolean; roleTitle: string | null };

export type Receivable = {
  id: string;
  number: number;
  type: ReceivableType;
  recipientWallet: Wallet;
  payerName: string;
  payerEmail: string | null;
  payerWallet: Wallet | null;
  /** YYYY-MM-DD: when the payer is expected to pay. */
  dueDate: string;
  /** Set only for an org's receivable (a club reimbursement), together with its officer as guarantor. */
  orgId: number | null;
  faceValue: string;
  requestedAmount: string;
  reference: string;
  description: string | null;
  packetJson: unknown;
  packetHash: string | null;
  guarantorWallet: Wallet | null;
  guarantySignedAt: string | null;
  status: ReceivableStatus;
  /** Set when a finance agent sends the request on to an admin. */
  financeClearedAt: string | null;
  financeClearedBy: Wallet | null;
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
  /** The vault series and its loan broker that funded the loan. */
  vaultId: string | null;
  loanBrokerId: string | null;
  /** When staff marked the loan impaired (a missed payment) or defaulted it on the ledger. */
  impairedAt: string | null;
  defaultedAt: string | null;
  callReason: CallReason;
  guarantorCalledAt: string | null;
  writeOffEligibleAt: string | null;
  principalWrittenOff: boolean;
  writtenOffPrincipal: string;
  payerOutcome: PayerOutcome;
  payerOutcomeNote: string | null;
  payerOutcomeAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewReceivable = Pick<
  Receivable,
  | "type"
  | "recipientWallet"
  | "payerName"
  | "payerEmail"
  | "payerWallet"
  | "dueDate"
  | "orgId"
  | "faceValue"
  | "requestedAmount"
  | "reference"
  | "description"
  | "guarantorWallet"
>;

export type ReceivablePatch = Partial<Omit<Receivable, "id" | "number" | "recipientWallet" | "createdAt" | "updatedAt">>;

export type ReceivableDocument = {
  id: string;
  receivableId: string;
  storagePath: string;
  sha256: string | null;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: Wallet;
  createdAt: string;
};

export type GuarantorInvite = {
  id: string;
  receivableId: string;
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
  receivableId: string | null;
  purpose: string;
  result: string;
  createdAt: string;
};

export type ReceivableScope =
  /** Receivables the wallet sells, guarantees, or can see as an officer of the org. */
  | { kind: "wallet"; wallet: Wallet; officerOrgIds: number[]; /** Set when the caller is a finance agent, so they see requests waiting on them. */ financeOrgId: number | null }
  /** Every receivable, for staff. */
  | { kind: "all" }
  /** Receivables with a payer outcome report, for the attester's exceptions list. */
  | { kind: "reported" };

export type NotificationKey = { wallet: Wallet; kind: NotificationKind; receivableId: string };

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
  getOrgByJoinCode(joinCode: string): Promise<Org | null>;
  listOrgs(): Promise<Org[]>;
  setOrgActive(id: number, active: boolean): Promise<void>;
  upsertOfficer(officer: Officer): Promise<void>;
  isActiveOfficer(orgId: number, wallet: Wallet): Promise<boolean>;
  listOfficerOrgs(wallet: Wallet): Promise<Array<{ orgId: number; name: string; title: string | null }>>;
  /** Active orgs with their active officers and the officers' display names (for picking a guarantor). */
  listActiveOrgsWithOfficers(): Promise<Array<Org & { officers: Array<{ wallet: Wallet; title: string | null; displayName: string | null }> }>>;

  insertMember(member: OrgMember): Promise<void>;
  getMember(wallet: Wallet): Promise<OrgMember | null>;
  /** Wallets of the organization's finance agents. */
  listFinanceAgents(orgId: number): Promise<Wallet[]>;

  insertReceivable(receivable: NewReceivable): Promise<Receivable>;
  getReceivable(id: string): Promise<Receivable | null>;
  updateReceivable(id: string, patch: ReceivablePatch): Promise<Receivable>;
  /**
   * Updates only if the receivable is still in `from`; returns null when another request moved it first, so two clicks
   * can't both approve or fund.
   */
  transitionReceivable(id: string, from: ReceivableStatus[], patch: ReceivablePatch): Promise<Receivable | null>;
  listReceivables(scope: ReceivableScope): Promise<Receivable[]>;
  listReceivablesByStatus(statuses: ReceivableStatus[]): Promise<Receivable[]>;

  insertDocument(doc: Omit<ReceivableDocument, "id" | "createdAt" | "sha256"> & { id?: string }): Promise<ReceivableDocument>;
  getDocument(id: string): Promise<ReceivableDocument | null>;
  listDocuments(receivableId: string): Promise<ReceivableDocument[]>;
  setDocumentHash(id: string, sha256: string): Promise<ReceivableDocument>;

  insertInvite(invite: Omit<GuarantorInvite, "id" | "createdAt" | "usedAt">): Promise<GuarantorInvite>;
  getInviteByTokenHash(tokenHash: string): Promise<GuarantorInvite | null>;
  markInviteUsed(id: string): Promise<void>;
  /** Invites created for the receivable at or after `since` (an ISO timestamp), used or not. */
  countInvitesSince(receivableId: string, since: string): Promise<number>;

  recordLedgerTx(tx: Omit<LedgerTx, "createdAt">): Promise<void>;
  listLedgerTxs(filter: { receivableId?: string; account?: Wallet; limit?: number }): Promise<LedgerTx[]>;

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
