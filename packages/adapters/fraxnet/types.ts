import type { Address } from "viem";

export const VERIFICATION_STATUSES = ["not_started", "pending", "approved", "rejected"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/**
 * What the consent screen asks for. `openid`, `org:read` and `offline_access` are locked on (we can't read the
 * verified flag or recheck it later without them); the user may untick `email`, `profile`, and `addresses:manage`,
 * which lets us add their app wallet to FraxNet for them (U-77, U-78).
 */
export const FRAXNET_SCOPES = ["openid", "email", "profile", "org:read", "offline_access", "addresses:manage"] as const;
export const ADD_WALLET_SCOPE = "addresses:manage";

/** A wallet to record on the member's FraxNet organization. */
export type FraxNetWallet = { address: Address; chainId: number; name: string };
export const FRAXNET_REQUIRED_SCOPES = ["openid", "org:read", "offline_access"] as const;

/** The token pair from FraxNet's token endpoint. Refresh tokens rotate on every use. */
export type FraxNetTokens = {
  accessToken: string;
  /** null when `offline_access` wasn't granted */
  refreshToken: string | null;
  /** ISO time the access token stops working (FraxNet issues 1h tokens) */
  expiresAt: string;
  /** The scopes FraxNet actually granted, which can be fewer than we asked for */
  scopes: string[];
};

/** The FraxNet user behind a token and the one organization they picked on the consent screen. */
export type FraxNetIdentity = {
  userId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  org: {
    id: string;
    name: string;
    /** FraxNet's KYC (individual) or KYB (business) result for this organization */
    verified: boolean;
    verifiedAt: string | null;
    isBusiness: boolean | null;
  };
};

export type AuthorizeRequest = {
  redirectUri: string;
  /** random, at least 8 characters, checked when FraxNet sends the user back */
  state: string;
  nonce: string;
  /** PKCE S256 challenge for the verifier we keep on the server */
  codeChallenge: string;
};

/** OAuth and API errors FraxNet answers with (`invalid_grant`, `invalid_token`, `insufficient_scope`, ...). */
export class FraxNetAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`FraxNet: ${code}: ${message}`);
    this.name = "FraxNetAuthError";
  }
}

/**
 * Talks to FraxNet on behalf of a user who connected their account through OAuth (FR-B6, U-77). People verify on
 * FraxNet's own site, never in our app; we only read the result.
 */
export interface FraxNetClient {
  readonly kind: "real" | "mock";
  /** FraxNet's web app, where someone finishes verifying: `config.fraxnet.appUrl`. */
  verifyUrl(): string;
  /** Where to send the browser to sign in to FraxNet and consent. */
  authorizeUrl(request: AuthorizeRequest): string;
  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<FraxNetTokens>;
  refresh(refreshToken: string): Promise<FraxNetTokens>;
  /** `GET /me` and `GET /org` with the user's access token. */
  getIdentity(accessToken: string): Promise<FraxNetIdentity>;
  /**
   * `POST /org/addresses`: records the wallet on the organization, which is FraxNet's "Add a wallet address" step.
   * Adding one that's already there just renames it, so it's safe to repeat (U-78).
   */
  addWallet(accessToken: string, wallet: FraxNetWallet): Promise<void>;
  /** The user's FraxNet liquidation address on Ethereum for cash-out, or null if they have none (U-17, U-37). */
  getLiquidationAddress(wallet: Address): Promise<Address | null>;
}

/** Our KYC status from what FraxNet says about the organization the person connected (U-77). */
export function verificationFromIdentity(identity: FraxNetIdentity): { status: VerificationStatus; reason: "verified" | "not_verified" | "business_org" } {
  // UNCERTAIN: U-77 (a verified personal organization stands for the person's own KYC)
  if (!identity.org.verified) return { status: "pending", reason: "not_verified" };
  if (identity.org.isBusiness === true) return { status: "pending", reason: "business_org" };
  // only an organization FraxNet says is personal counts; unknown (null) is not approval (security campaign E-2b)
  // UNCERTAIN: U-91
  if (identity.org.isBusiness !== false) return { status: "pending", reason: "not_verified" };
  return { status: "approved", reason: "verified" };
}
