import { FraxNetAuthError, type FraxNetClient, pkcePair, randomToken } from "@app/adapters";
import { z } from "zod";
import { type TokenVerifier, requireCaller } from "../_shared/auth.ts";
import { UniqueViolation } from "../_shared/db/types.ts";
import type { Db } from "../_shared/db/types.ts";
import { STATE_TTL_MS, addAppWallet, applyIdentity, fraxnetHttpError, fraxnetRedirectUri, kycBody, tokenFields } from "../_shared/fraxnet.ts";
import { type Handler, badRequest, conflict, json, methodNotAllowed, readJson } from "../_shared/http.ts";

export type FraxnetConnectDeps = {
  auth: TokenVerifier;
  db: Db;
  fraxnet: FraxNetClient;
  appBaseUrl: string;
  /** `config.fraxnet.walletChainId`: where the app wallet is added on FraxNet, or null to skip (U-78) */
  walletChainId: number | null;
  now?: () => Date;
};

const Body = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("start") }),
  z.strictObject({
    action: z.literal("finish"),
    code: z.string().min(1).max(4096),
    state: z.string().min(32).max(128),
  }),
]);

/**
 * Connect FraxNet (U-77). `start` saves a sign-in attempt (state, PKCE verifier, nonce) for the caller's wallet and
 * returns FraxNet's sign-in URL. FraxNet sends the browser back to /fraxnet/callback/, which posts `finish` with the
 * code and state. The code is exchanged here with the client secret, never in the browser, and the member's
 * organization decides their KYC status. Their app wallet is added to that organization too (U-78).
 */
export function createFraxnetConnectHandler(deps: FraxnetConnectDeps): Handler {
  const now = deps.now ?? (() => new Date());
  const redirectUri = fraxnetRedirectUri(deps.appBaseUrl);
  return async (req) => {
    const caller = await requireCaller(req, deps);
    if (req.method !== "POST") throw methodNotAllowed(["POST"]);
    const body = await readJson(req, Body);
    const wallet = caller.profile.wallet;

    try {
      if (body.action === "start") {
        const state = randomToken(32);
        const nonce = randomToken(16);
        const pkce = await pkcePair();
        const authorizeUrl = deps.fraxnet.authorizeUrl({ redirectUri, state, nonce, codeChallenge: pkce.challenge });
        await deps.db.insertFraxnetState({
          state,
          wallet,
          codeVerifier: pkce.verifier,
          nonce,
          expiresAt: new Date(now().getTime() + STATE_TTL_MS).toISOString(),
        });
        return json({ authorizeUrl });
      }

      const attempt = await deps.db.takeFraxnetState(body.state, wallet);
      if (!attempt || Date.parse(attempt.expiresAt) <= now().getTime()) {
        throw badRequest("That FraxNet sign-in expired or was already used. Start again.", "invalid_state");
      }

      let tokens;
      let identity;
      try {
        tokens = await deps.fraxnet.exchangeCode({ code: body.code, codeVerifier: attempt.codeVerifier, redirectUri });
        identity = await deps.fraxnet.getIdentity(tokens.accessToken);
      } catch (error) {
        if (error instanceof FraxNetAuthError) {
          throw badRequest(`FraxNet didn't accept the sign-in (${error.code}). Start again.`, "fraxnet_rejected");
        }
        throw error;
      }

      let connection;
      try {
        const { scopes: granted, ...fields } = tokenFields(tokens);
        connection = await deps.db.upsertFraxnetConnection({
          wallet,
          fraxnetUserId: identity.userId,
          orgId: identity.org.id,
          orgName: identity.org.name,
          orgVerified: identity.org.verified,
          orgVerifiedAt: identity.org.verifiedAt,
          orgIsBusiness: identity.org.isBusiness,
          email: identity.email,
          scopes: granted ?? [],
          ...fields,
          needsReconnect: false,
          walletAddedAt: null,
        });
      } catch (error) {
        if (error instanceof UniqueViolation) {
          throw conflict("That FraxNet account is already connected to another wallet.", "fraxnet_account_in_use");
        }
        throw error;
      }
      const profile = await applyIdentity(deps.db, caller.profile, identity, now().toISOString());
      const stored = (await deps.db.getFraxnetConnection(wallet)) ?? connection;
      const withWallet = await addAppWallet({ db: deps.db, fraxnet: deps.fraxnet, now, walletChainId: deps.walletChainId }, stored, tokens.accessToken);
      return json(kycBody(profile, withWallet, deps.fraxnet.verifyUrl()));
    } catch (error) {
      throw fraxnetHttpError(error);
    }
  };
}
