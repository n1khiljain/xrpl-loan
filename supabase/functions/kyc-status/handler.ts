import type { FraxNetClient } from "@app/adapters";
import { type TokenVerifier, requireCaller } from "../_shared/auth.ts";
import type { Db } from "../_shared/db/types.ts";
import { kycBody, recheck } from "../_shared/fraxnet.ts";
import { type Handler, json, methodNotAllowed } from "../_shared/http.ts";

export type KycStatusDeps = { auth: TokenVerifier; db: Db; fraxnet: FraxNetClient; walletChainId: number | null; now?: () => Date };

/**
 * The caller's KYC status (FR-B6). A member who connected FraxNet is checked again through their stored tokens,
 * and FraxNet's answer is mirrored into the profile (U-77). Without a connection, the stored status stands, which
 * is the one an underwriter set by hand (U-07, U-36).
 */
export function createKycStatusHandler(deps: KycStatusDeps): Handler {
  const now = deps.now ?? (() => new Date());
  return async (req) => {
    const caller = await requireCaller(req, deps);
    if (req.method !== "POST") throw methodNotAllowed(["POST"]);
    const { profile, connection, stale } = await recheck({ db: deps.db, fraxnet: deps.fraxnet, now, walletChainId: deps.walletChainId }, caller.profile);
    return json(kycBody(profile, connection, deps.fraxnet.verifyUrl(), stale));
  };
}
