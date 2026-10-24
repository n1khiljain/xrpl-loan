import {
  ADD_WALLET_SCOPE,
  AdapterConfigError,
  FraxNetAuthError,
  type FraxNetClient,
  type FraxNetIdentity,
  type FraxNetTokens,
  UpstreamError,
  verificationFromIdentity,
} from "@app/adapters";
import { getAddress } from "viem";
import type { Db, FraxnetConnection, Profile } from "./db/types.ts";
import { HttpError } from "./http.ts";

/** Where FraxNet sends the browser back after sign-in. Frax registers this exact URL for the app (U-77). */
export function fraxnetRedirectUri(appBaseUrl: string): string {
  return `${appBaseUrl.replace(/\/+$/, "")}/fraxnet/callback/`;
}

/** How long a sign-in attempt stays usable. FraxNet's authorization codes last 10 minutes too. */
export const STATE_TTL_MS = 10 * 60 * 1000;

/** Access tokens this close to expiry are refreshed first, so one doesn't lapse mid-request. */
const EXPIRY_SKEW_MS = 60 * 1000;

/** Maps adapter failures that aren't the caller's fault to responses that say what's wrong. */
export function fraxnetHttpError(error: unknown): unknown {
  if (error instanceof AdapterConfigError) return new HttpError(503, "not_configured", "FraxNet sign-in isn't set up on this server yet");
  if (error instanceof UpstreamError) return new HttpError(502, "fraxnet_unavailable", "FraxNet didn't answer. Try again in a minute.");
  return error;
}

/**
 * Writes what FraxNet said into the connection and the profile. A FraxNet answer replaces a manual one (U-59), and
 * the profile's timestamp only moves when the status or its source changes.
 */
export async function applyIdentity(
  db: Db,
  profile: Profile,
  identity: FraxNetIdentity,
  at: string,
): Promise<Profile> {
  await db.updateFraxnetConnection(profile.wallet, {
    orgId: identity.org.id,
    orgName: identity.org.name,
    orgVerified: identity.org.verified,
    orgVerifiedAt: identity.org.verifiedAt,
    orgIsBusiness: identity.org.isBusiness,
    email: identity.email,
    needsReconnect: false,
    checkedAt: at,
  });
  const { status } = verificationFromIdentity(identity);
  if (status === profile.kycStatus && profile.kycSource === "fraxnet_api" && profile.fraxnetAccountRef === identity.userId) return profile;
  return await db.updateProfile(profile.wallet, {
    kycStatus: status,
    kycSource: "fraxnet_api",
    kycUpdatedBy: null,
    kycUpdatedAt: status === profile.kycStatus && profile.kycSource === "fraxnet_api" ? profile.kycUpdatedAt : at,
    fraxnetAccountRef: identity.userId,
  });
}

export function tokenFields(tokens: FraxNetTokens, previousRefresh: string | null = null) {
  return {
    accessToken: tokens.accessToken,
    accessExpiresAt: tokens.expiresAt,
    // FraxNet rotates refresh tokens on every use; keep the old one only if a response somehow leaves it out
    refreshToken: tokens.refreshToken ?? previousRefresh,
    ...(tokens.scopes.length > 0 ? { scopes: tokens.scopes } : {}),
  };
}

/** What FraxNet shows next to the wallet in the member's FraxNet account. */
export const WALLET_NAME = "FraxNet College";

/**
 * Adds the member's app wallet (the one Privy made) to their FraxNet organization, which is FraxNet's "Add a wallet
 * address" step, so they don't have to find and paste it (U-78). Best effort: a refused scope or an unsupported chain
 * leaves `walletAddedAt` empty and Verification shows the address to paste instead. Never throws.
 */
export async function addAppWallet(
  deps: { db: Db; fraxnet: FraxNetClient; now: () => Date; walletChainId: number | null },
  connection: FraxnetConnection,
  accessToken: string,
): Promise<FraxnetConnection> {
  if (deps.walletChainId === null || connection.walletAddedAt !== null || !connection.scopes.includes(ADD_WALLET_SCOPE)) return connection;
  try {
    await deps.fraxnet.addWallet(accessToken, { address: getAddress(connection.wallet), chainId: deps.walletChainId, name: WALLET_NAME });
  } catch (error) {
    console.error("fraxnet: adding the app wallet failed", error instanceof Error ? error.message : error);
    return connection;
  }
  return await deps.db.updateFraxnetConnection(connection.wallet, { walletAddedAt: deps.now().toISOString() });
}

export type RecheckResult = { profile: Profile; connection: FraxnetConnection | null; stale: boolean };

/**
 * Asks FraxNet again about a connected member: reuses the stored access token while it's fresh, otherwise spends
 * the refresh token (and stores the rotated pair). A rejected token marks the connection for reconnecting and keeps
 * the last known status. If FraxNet is down, the stored answer stands and `stale` says so.
 */
export async function recheck(
  deps: { db: Db; fraxnet: FraxNetClient; now: () => Date; walletChainId: number | null },
  profile: Profile,
): Promise<RecheckResult> {
  const { db, fraxnet, now } = deps;
  let connection = await db.getFraxnetConnection(profile.wallet);
  if (!connection || connection.needsReconnect) return { profile, connection, stale: false };

  const fresh = (c: FraxnetConnection) =>
    c.accessToken !== null && c.accessExpiresAt !== null && Date.parse(c.accessExpiresAt) - EXPIRY_SKEW_MS > now().getTime();

  try {
    for (let attempt = 0; ; attempt++) {
      if (!fresh(connection)) {
        if (connection.refreshToken === null) throw new FraxNetAuthError("invalid_grant", "no refresh token stored");
        const tokens = await fraxnet.refresh(connection.refreshToken);
        connection = await db.updateFraxnetConnection(profile.wallet, tokenFields(tokens, connection.refreshToken));
      }
      try {
        const identity = await fraxnet.getIdentity(connection.accessToken as string);
        if (identity.userId !== connection.fraxnetUserId) throw new FraxNetAuthError("invalid_token", "token belongs to a different FraxNet user");
        const updated = await applyIdentity(db, profile, identity, now().toISOString());
        const checked = (await db.getFraxnetConnection(profile.wallet)) ?? connection;
        return { profile: updated, connection: await addAppWallet(deps, checked, connection.accessToken as string), stale: false };
      } catch (error) {
        // a revoked access token that hadn't expired yet: drop it and go once more through the refresh token
        if (error instanceof FraxNetAuthError && error.code === "invalid_token" && attempt === 0 && fresh(connection)) {
          connection = await db.updateFraxnetConnection(profile.wallet, { accessToken: null, accessExpiresAt: null });
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof FraxNetAuthError) {
      connection = await db.updateFraxnetConnection(profile.wallet, {
        needsReconnect: true,
        accessToken: null,
        accessExpiresAt: null,
        checkedAt: now().toISOString(),
      });
      return { profile, connection, stale: false };
    }
    if (error instanceof UpstreamError) return { profile, connection, stale: true };
    throw fraxnetHttpError(error);
  }
}

/** What the web app shows on the onboarding screen. Never includes tokens. */
export function kycBody(profile: Profile, connection: FraxnetConnection | null, verifyUrl: string, stale = false) {
  return {
    status: profile.kycStatus,
    source: profile.kycSource,
    updatedAt: profile.kycUpdatedAt,
    verifyUrl,
    stale,
    fraxnet: connection && {
      orgName: connection.orgName,
      verified: connection.orgVerified,
      verifiedAt: connection.orgVerifiedAt,
      isBusiness: connection.orgIsBusiness,
      email: connection.email,
      reason: verificationFromIdentity({
        userId: connection.fraxnetUserId,
        email: connection.email,
        firstName: null,
        lastName: null,
        org: {
          id: connection.orgId,
          name: connection.orgName,
          verified: connection.orgVerified,
          verifiedAt: connection.orgVerifiedAt,
          isBusiness: connection.orgIsBusiness,
        },
      }).reason,
      needsReconnect: connection.needsReconnect,
      walletAdded: connection.walletAddedAt !== null,
      connectedAt: connection.connectedAt,
      checkedAt: connection.checkedAt,
    },
  };
}
