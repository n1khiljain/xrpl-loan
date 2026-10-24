import { bindingMessage } from "@app/adapters";
import { importSPKI, jwtVerify } from "jose";
import { type Hex, getAddress, isAddress, verifyMessage } from "viem";
import type { Db, Profile, StaffRole, Wallet } from "./db/types.ts";
import { HttpError, forbidden, unauthorized } from "./http.ts";

/** The Privy user behind a verified access token. */
export type PrivyUser = { userId: string };

export interface TokenVerifier {
  /** Resolves for a valid token; rejects for anything else. */
  verify(token: string): Promise<PrivyUser>;
}

/**
 * Verifies Privy access tokens: ES256, issuer `privy.io`, audience our Privy app ID, subject a `did:privy:` ID, an
 * `exp`, and an `iat` no older than `MAX_TOKEN_AGE` (security campaign E-6b). `verificationKey` is the SPKI PEM from
 * the Privy dashboard; escaped `\n` from env files is accepted.
 */
/** Privy access tokens last an hour; anything issued longer ago than this is refused even with a later `exp`. */
// UNCERTAIN: U-86
export const MAX_TOKEN_AGE = "24h";

export function createPrivyVerifier(options: { appId: string; verificationKey: string }): TokenVerifier {
  const pem = options.verificationKey.replace(/\\n/g, "\n").trim();
  const key = importSPKI(pem, "ES256");
  return {
    async verify(token) {
      const { payload } = await jwtVerify(token, await key, {
        issuer: "privy.io",
        audience: options.appId,
        algorithms: ["ES256"],
        requiredClaims: ["exp", "iat"],
        maxTokenAge: MAX_TOKEN_AGE,
      });
      if (typeof payload.sub !== "string" || !payload.sub.startsWith("did:privy:")) {
        throw new Error("token subject is not a Privy user");
      }
      return { userId: payload.sub };
    },
  };
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return match?.[1] ?? null;
}

/** The first step of every authenticated function: a valid Privy token or 401 (FR-B1). */
export async function authenticate(req: Request, verifier: TokenVerifier): Promise<PrivyUser> {
  const token = bearerToken(req);
  if (!token) throw unauthorized("missing Privy access token");
  try {
    return await verifier.verify(token);
  } catch {
    throw unauthorized("invalid or expired Privy access token");
  }
}

export type Caller = { user: PrivyUser; profile: Profile; staffRole: StaffRole | null };

/** A verified user who has linked a wallet with `POST /me`. */
export async function requireCaller(req: Request, deps: { auth: TokenVerifier; db: Db }): Promise<Caller> {
  const user = await authenticate(req, deps.auth);
  const profile = await deps.db.getProfileByPrivyId(user.userId);
  if (!profile) throw forbidden("link a wallet with POST /me first", "no_profile");
  return { user, profile, staffRole: await deps.db.getStaffRole(profile.wallet) };
}

export function requireStaff(caller: Caller, roles: readonly StaffRole[]): StaffRole {
  if (!caller.staffRole || !roles.includes(caller.staffRole)) throw forbidden(`needs staff role ${roles.join(" or ")}`);
  return caller.staffRole;
}

/** A wallet named in a request must be the caller's own (SYSTEM_DESIGN 5.2). */
export function assertOwnWallet(caller: Caller, wallet: string | undefined): void {
  if (wallet !== undefined && normalizeWallet(wallet) !== caller.profile.wallet) {
    throw forbidden("that wallet belongs to a different account", "wallet_mismatch");
  }
}

export function normalizeWallet(value: string): Wallet {
  if (!isAddress(value, { strict: false })) throw new HttpError(400, "bad_address", `${value} is not an address`);
  return value.toLowerCase() as Wallet;
}

/** How long a wallet-link signature stays valid. UNCERTAIN: U-50 */
export const BINDING_MAX_AGE_MS = 10 * 60 * 1000;

/** The message a wallet signs to prove it belongs to the Privy user; shared with the web app. */
export { bindingMessage };

/** Checks a `personal_sign` over `bindingMessage` from the wallet, made in the last 10 minutes. UNCERTAIN: U-50 */
export async function verifyWalletBinding(p: {
  privyUserId: string;
  wallet: string;
  issuedAt: string;
  signature: Hex;
  now: Date;
}): Promise<void> {
  const issued = Date.parse(p.issuedAt);
  if (Number.isNaN(issued)) throw new HttpError(400, "bad_binding", "issuedAt must be an ISO timestamp");
  const age = p.now.getTime() - issued;
  if (age > BINDING_MAX_AGE_MS || age < -60_000) {
    throw new HttpError(400, "stale_binding", "the wallet signature expired; sign again");
  }
  const ok = await verifyMessage({
    address: getAddress(p.wallet),
    message: bindingMessage(p),
    signature: p.signature,
  }).catch(() => false);
  if (!ok) throw new HttpError(400, "bad_binding", "the signature doesn't match the wallet");
}
