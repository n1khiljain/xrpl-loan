import type { ClaimViewJson } from "@app/adapters";

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

export type OffchainClaim = {
  id: string;
  number: number;
  orgId: number;
  recipientWallet: Address;
  recipientType: "member" | "org_treasurer";
  faceValue: string;
  requestedAmount: string;
  callinkPrNumber: string;
  description: string | null;
  packetHash: string | null;
  guarantorWallet: Address | null;
  guarantySigned: boolean;
  guarantySignedAt: string | null;
  status: OffchainStatus;
  rejectReason: string | null;
  loanId: string | null;
  asucOutcome: "none" | "rejected" | "short_paid";
  asucOutcomeNote: string | null;
  createdAt: string;
  updatedAt: string;
  /** Money and dates once it's past a draft. */
  ledger: ClaimViewJson | null;
};

export type DocumentView = { id: string; sha256: string | null; mimeType: string; sizeBytes: number; createdAt: string };

export type ClaimWithDocuments = { claim: OffchainClaim; documents: DocumentView[] };

export type PacketResponse = { packetHash: string };

export type InviteCreated = { inviteUrl: string; expiresAt: string; emailed: boolean };

export type InviteView = {
  claim: {
    id: string;
    orgId: number;
    orgName: string | null;
    claimantName: string | null;
    recipientWallet: Address;
    faceValue: string;
    requestedAmount: string;
    callinkPrNumber: string;
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
