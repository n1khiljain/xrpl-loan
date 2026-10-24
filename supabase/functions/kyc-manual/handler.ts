import { z } from "zod";
import { type TokenVerifier, normalizeWallet, requireCaller, requireStaff } from "../_shared/auth.ts";
import type { Db } from "../_shared/db/types.ts";
import { type Handler, json, methodNotAllowed, notFound, readJson } from "../_shared/http.ts";

export type KycManualDeps = { auth: TokenVerifier; db: Db; now?: () => Date };

const Body = z.strictObject({
  wallet: z.string(),
  status: z.enum(["not_started", "pending", "approved", "rejected"]),
  /** what the underwriter confirmed with Frax, and how */
  note: z.string().trim().min(1).max(500),
});

/**
 * An underwriter sets a wallet's KYC status after confirming it with Frax, until Frax's API exists. Every change
 * is logged in `admin_actions` with the underwriter's wallet and the time (FR-B6, U-36).
 */
export function createKycManualHandler(deps: KycManualDeps): Handler {
  const now = deps.now ?? (() => new Date());
  return async (req) => {
    const caller = await requireCaller(req, deps);
    if (req.method !== "POST") throw methodNotAllowed(["POST"]);
    requireStaff(caller, ["underwriter"]);
    const body = await readJson(req, Body);
    const wallet = normalizeWallet(body.wallet);

    const target = await deps.db.getProfile(wallet);
    if (!target) throw notFound("that wallet has no profile yet");

    const at = now().toISOString();
    const profile = await deps.db.updateProfile(wallet, {
      kycStatus: body.status,
      kycSource: "manual",
      kycUpdatedBy: caller.profile.wallet,
      kycUpdatedAt: at,
    });
    await deps.db.insertAdminAction({
      actorWallet: caller.profile.wallet,
      action: "kyc_manual",
      target: wallet,
      payload: { from: target.kycStatus, to: body.status, note: body.note, at },
    });
    return json({ profile });
  };
}
