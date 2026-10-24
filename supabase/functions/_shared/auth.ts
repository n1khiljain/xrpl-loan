import { type JWTPayload, createRemoteJWKSet, importSPKI, jwtVerify } from "jose";
import type { Db, Profile, StaffRole, Wallet } from "./db/types.ts";
import { HttpError, forbidden, unauthorized } from "./http.ts";

/** The Privy user behind a verified access token. */
export type PrivyUser = { userId: string };

/** What a Privy identity token says about the user: the emails they proved by code or Google sign-in. */
export type PrivyIdentity = { userId: string; verifiedEmails: string[] };

export interface TokenVerifier {
  /** Resolves for a valid access token; rejects for anything else. */
  verify(token: string): Promise<PrivyUser>;
  /** Resolves for a valid identity token; rejects for anything else. */
  verifyIdentity(token: string): Promise<PrivyIdentity>;
}

/** Privy access tokens last an hour; anything issued longer ago than this is refused even with a later `exp`. */
export const MAX_TOKEN_AGE = "24h";

/** Emails from an identity token's `linked_accounts`: email-code accounts and Google accounts, lowercased. */
export function emailsFrom(payload: JWTPayload): string[] {
  const raw = payload.linked_accounts;
  let accounts: unknown;
  try {
    accounts = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }
  if (!Array.isArray(accounts)) return [];
  const out: string[] = [];
  for (const a of accounts) {
    if (typeof a !== "object" || a === null) continue;
    const account = a as Record<string, unknown>;
    const email = account.type === "email" ? account.address : account.type === "google_oauth" ? account.email : null;
    if (typeof email === "string" && email.includes("@")) out.push(email.toLowerCase());
  }
  return out;
}

/** Privy publishes each app's signing keys here, so the backend needs no key copied from the dashboard. */
export const privyJwksUrl = (appId: string) => new URL(`https://auth.privy.io/api/v1/apps/${encodeURIComponent(appId)}/jwks.json`);

/**
 * Verifies Privy tokens: ES256, issuer `privy.io`, audience our Privy app ID, subject a `did:privy:` ID, an `exp`,
 * and an `iat` no older than `MAX_TOKEN_AGE`. Access tokens and identity tokens are signed by the same app keys.
 * With `verificationKey` (an SPKI PEM; escaped `\n` from env files is accepted) only that key is trusted, which the
 * tests and the local demo use. Without it, the app's published JWKS is fetched and cached, so key rotation just works.
 */
export function createPrivyVerifier(options: { appId: string; verificationKey?: string }): TokenVerifier {
  const pem = options.verificationKey?.replace(/\\n/g, "\n").trim();
  const key = pem ? importSPKI(pem, "ES256") : null;
  const jwks = pem ? null : createRemoteJWKSet(privyJwksUrl(options.appId));
  const verify = async (token: string, opts: Parameters<typeof jwtVerify>[2]) =>
    key ? jwtVerify(token, await key, opts) : jwtVerify(token, jwks!, opts);
  async function check(token: string): Promise<JWTPayload & { sub: string }> {
    const { payload } = await verify(token, {
      issuer: "privy.io",
      audience: options.appId,
      algorithms: ["ES256"],
      requiredClaims: ["exp", "iat"],
      maxTokenAge: MAX_TOKEN_AGE,
    });
    if (typeof payload.sub !== "string" || !payload.sub.startsWith("did:privy:")) {
      throw new Error("token subject is not a Privy user");
    }
    return payload as JWTPayload & { sub: string };
  }
  return {
    async verify(token) {
      return { userId: (await check(token)).sub };
    },
    async verifyIdentity(token) {
      const payload = await check(token);
      if (payload.linked_accounts === undefined) throw new Error("not an identity token");
      return { userId: payload.sub, verifiedEmails: emailsFrom(payload) };
    },
  };
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return match?.[1] ?? null;
}

/** The first step of every authenticated function: a valid Privy token or 401. */
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

/** A verified user who has set up their account with `POST /me`. */
export async function requireCaller(req: Request, deps: { auth: TokenVerifier; db: Db }): Promise<Caller> {
  const user = await authenticate(req, deps.auth);
  const profile = await deps.db.getProfileByPrivyId(user.userId);
  if (!profile) throw forbidden("set up your account with POST /me first", "no_profile");
  return { user, profile, staffRole: await deps.db.getStaffRole(profile.wallet) };
}

export function requireStaff(caller: Caller, roles: readonly StaffRole[]): StaffRole {
  if (!caller.staffRole || !roles.includes(caller.staffRole)) throw forbidden(`needs staff role ${roles.join(" or ")}`);
  return caller.staffRole;
}

const ADDRESS = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

export function isXrplAddress(value: string): value is Wallet {
  return ADDRESS.test(value);
}

export function normalizeWallet(value: string): Wallet {
  if (!isXrplAddress(value)) throw new HttpError(400, "bad_address", `${value} is not an XRPL address`);
  return value;
}
