/** Response shapes of the edge functions in supabase/functions. Wei amounts arrive as decimal strings. */
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

export type Profile = {
  wallet: `0x${string}`;
  privyUserId: string;
  email: string | null;
  displayName: string | null;
  kycStatus: KycStatus;
  kycSource: "fraxnet_api" | "manual" | null;
  kycUpdatedAt: string | null;
  liquidationAddress: `0x${string}` | null;
};

export type MeResponse = {
  profile: Profile | null;
  staffRole: StaffRole | null;
  officerOrgs: Array<{ orgId: number; name: string; title: string | null }>;
};

export type OffchainClaim = {
  id: string;
  onchainClaimId: number | null;
  orgId: number;
  recipientWallet: `0x${string}`;
  recipientType: "member" | "org_treasurer";
  faceValue: string;
  requestedAmount: string;
  callinkPrNumber: string;
  description: string | null;
  packetHash: `0x${string}` | null;
  guarantorWallet: `0x${string}` | null;
  guarantySigned: boolean;
  guarantySignature: `0x${string}` | null;
  guarantyNonce: string | null;
  guarantyDeadline: number | null;
  status: OffchainStatus;
  asucOutcome: "none" | "rejected" | "short_paid";
  asucOutcomeNote: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DocumentView = { id: string; sha256: string | null; mimeType: string; sizeBytes: number; createdAt: string };

export type ClaimWithDocuments = { claim: OffchainClaim; documents: DocumentView[] };

/** The member's connected FraxNet account, as of the last check. Tokens never reach the browser (U-77). */
export type FraxnetAccount = {
  orgName: string;
  verified: boolean;
  verifiedAt: string | null;
  isBusiness: boolean | null;
  email: string | null;
  reason: "verified" | "not_verified" | "business_org";
  needsReconnect: boolean;
  /** Connecting added the member's app wallet to their FraxNet organization (U-78) */
  walletAdded: boolean;
  connectedAt: string;
  checkedAt: string;
};

/** From kyc-status and fraxnet-connect `finish`. */
export type KycStatusResponse = {
  status: KycStatus;
  source: "fraxnet_api" | "manual" | null;
  updatedAt: string | null;
  verifyUrl: string;
  /** FraxNet didn't answer, so this is the last stored answer. */
  stale: boolean;
  fraxnet: FraxnetAccount | null;
};

/** EIP-712 typed data as JSON: numbers are decimal strings. */
export type TypedDataJson = {
  domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: "Guaranty";
  message: Record<string, string>;
};

export type PacketResponse = { packetHash: `0x${string}`; typedData: TypedDataJson };

export type InviteCreated = { inviteUrl: string; expiresAt: string; emailed: boolean };

export type InviteView = {
  claim: {
    id: string;
    orgId: number;
    orgName: string | null;
    claimantName: string | null;
    recipientWallet: `0x${string}`;
    faceValue: string;
    requestedAmount: string;
    callinkPrNumber: string;
    description: string | null;
    documentCount: number;
    packetHash: `0x${string}` | null;
    status: OffchainStatus;
  };
  expiresAt: string;
  signed: boolean;
  typedData: TypedDataJson | null;
};

export type DirectoryOrg = {
  id: number;
  name: string;
  officers: Array<{ wallet: `0x${string}`; displayName: string | null; title: string | null }>;
};

export type PersonView = { wallet: `0x${string}`; displayName: string | null; kycStatus: KycStatus | null; hasProfile: boolean };
