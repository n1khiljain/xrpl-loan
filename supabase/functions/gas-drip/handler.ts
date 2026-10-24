import { type DripLedger, type GasSponsor, withDripPolicy } from "@app/adapters";
import { z } from "zod";
import { type TokenVerifier, assertOwnWallet, authenticate } from "../_shared/auth.ts";
import type { Db, Wallet } from "../_shared/db/types.ts";
import { type Handler, HttpError, forbidden, json, methodNotAllowed, readOptionalJson } from "../_shared/http.ts";

export type GasDripDeps = { auth: TokenVerifier; db: Db; sponsor: GasSponsor; amountWei: bigint };

const Body = z.strictObject({ wallet: z.string().optional() });

/** `gas_drips` as the adapter's ledger. `reserve_gas_drip` does the check and insert atomically. */
export function dbDripLedger(db: Db): DripLedger {
  return {
    hasProfile: async (wallet) => (await db.getProfile(wallet.toLowerCase() as Wallet)) !== null,
    reserve: (wallet, windowMs) => db.reserveGasDrip(wallet.toLowerCase() as Wallet, Math.floor(windowMs / 1000)),
    confirm: (id, sent) => db.confirmGasDrip(id, sent),
    release: (id) => db.releaseGasDrip(id),
  };
}

/**
 * Tops up the caller's gas through `GasSponsor`: only wallets with a profile whose KYC is approved, so throwaway
 * accounts can't each pull a drip (security campaign E-4a), and at most once per wallet per 24 hours (FR-B7). A
 * second request inside the window gets 429.
 */
export function createGasDripHandler(deps: GasDripDeps): Handler {
  const sponsor = withDripPolicy(deps.sponsor, { ledger: dbDripLedger(deps.db), amountWei: deps.amountWei });
  return async (req) => {
    const user = await authenticate(req, deps.auth);
    if (req.method !== "POST") throw methodNotAllowed(["POST"]);
    const profile = await deps.db.getProfileByPrivyId(user.userId);
    if (!profile) throw forbidden("only wallets with a profile get gas", "no_profile");
    // UNCERTAIN: U-90
    if (profile.kycStatus !== "approved") throw forbidden("only verified members get gas", "kyc_required");
    const body = await readOptionalJson(req, Body);
    assertOwnWallet({ user, profile, staffRole: null }, body.wallet);

    const result = await sponsor.ensureGas(profile.wallet);
    if (result.reason === "rate_limited") {
      throw new HttpError(429, "rate_limited", "this wallet already got gas in the last 24 hours");
    }
    if (result.reason === "no_profile") throw forbidden("only wallets with a profile get gas", "no_profile");
    return json(result);
  };
}
