import type { ReceivableViewJson } from "@app/adapters";

/** Response shapes of the edge functions in supabase/functions. Amounts arrive as decimal strings of base units. */
export type KycStatus = "not_started" | "pending" | "approved" | "rejected";
export type StaffRole = "underwriter" | "attester" | "admin";
export type OffchainStatus =
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

/** A classic XRPL address. */
export type Address = `r${string}`;

export type Profile = {
  wallet: Address;
  privyUserId: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  kycStatus: KycStatus;
  kycSource: "manual" | null;
  kycUpdatedAt: string | null;
};

export type MeResponse = {
  profile: Profile | null;
  staffRole: StaffRole | null;
  officerOrgs: Array<{ orgId: number; name: string; title: string | null }>;
  wallet: { address: Address; funded: boolean; fundedTx: string | null } | null;
};

export type ReceivableType = "card_settlement" | "reimbursement" | "invoice" | "other";

export type OffchainReceivable = {
  id: string;
  number: number;
  type: ReceivableType;
  payerName: string;
  payerEmail: string | null;
  payerWallet: Address | null;
  /** YYYY-MM-DD */
  dueDate: string;
  /** Only for an org's receivable (e.g. a club reimbursement). */
  orgId: number | null;
  recipientWallet: Address;
  faceValue: string;
  requestedAmount: string;
  reference: string;
  description: string | null;
  packetHash: string | null;
  guarantorWallet: Address | null;
  guarantySigned: boolean;
  guarantySignedAt: string | null;
  status: OffchainStatus;
  rejectReason: string | null;
  loanId: string | null;
  /** The vault series that funded the loan. */
  vaultId: string | null;
  /** When staff marked a missed payment (impaired) or defaulted the loan on the ledger. */
  impairedAt: string | null;
  defaultedAt: string | null;
  payerOutcome: "none" | "rejected" | "short_paid";
  payerOutcomeNote: string | null;
  createdAt: string;
  updatedAt: string;
  /** Money and dates once it's past a draft. */
  ledger: ReceivableViewJson | null;
};

export type DocumentView = { id: string; sha256: string | null; mimeType: string; sizeBytes: number; createdAt: string };

export type ReceivableWithDocuments = { receivable: OffchainReceivable; documents: DocumentView[] };

export type PacketResponse = { packetHash: string };

export type InviteCreated = { inviteUrl: string; expiresAt: string; emailed: boolean };

export type InviteView = {
  receivable: {
    id: string;
    orgId: number | null;
    orgName: string | null;
    sellerName: string | null;
    recipientWallet: Address;
    faceValue: string;
    requestedAmount: string;
    type: ReceivableType;
    payerName: string;
    dueDate: string;
    reference: string;
    description: string | null;
    documentCount: number;
    packetHash: string | null;
    status: OffchainStatus;
  };
  expiresAt: string;
  signed: boolean;
  signable: boolean;
};

export type DirectoryOrg = {
  id: number;
  name: string;
  officers: Array<{ wallet: Address; displayName: string | null; title: string | null }>;
};

export type PersonView = { wallet: Address; displayName: string | null; kycStatus: KycStatus | null; hasProfile: boolean };

export type LedgerTxView = { txHash: string; txType: string; purpose: string; result: string; createdAt: string; explorerUrl: string };

export type WalletView = {
  address: Address;
  explorerUrl: string;
  network: string;
  /** False until the faucet funds the account. */
  exists: boolean;
  xrpDrops: string;
  /** The loan asset in base units, or null without a trust line. */
  assetUnits: string | null;
  assetCode: string;
  transactions: LedgerTxView[];
};

/** One vault in the rolling series, from the `vault` function. Amounts are base units. */
export type VaultSeriesView = {
  vaultId: string;
  loanBrokerId: string | null;
  phase: "open" | "subscription" | "lending" | "closed";
  subscriptionAt: number | null;
  redemptionAt: number | null;
  assetsTotal: string;
  assetsAvailable: string;
  lossUnrealized: string;
  debtTotal: string;
  coverAvailable: string;
  yourShares: string;
  yourValue: string;
};

export type VaultView = {
  broker: string;
  series: VaultSeriesView[];
  totals: {
    assetsTotal: string;
    assetsAvailable: string;
    debtTotal: string;
    coverAvailable: string;
    lossUnrealized: string;
    interestEarned: string;
    interestExpected: string;
    loansOutstanding: number;
    loansImpaired: number;
    loansDefaulted: number;
  };
  balance: string;
};
