import { z } from "zod";
import { type TokenVerifier, normalizeWallet, requireCaller, requireStaff } from "../_shared/auth.ts";
import type { Db, Wallet } from "../_shared/db/types.ts";
import { type Handler, conflict, json, methodNotAllowed, notFound, readJson } from "../_shared/http.ts";

export type KycManualDeps = {
  auth: TokenVerifier;
  db: Db;
  now?: () => Date;
  /** When approval should also put the vault credential on the account. Absent until the vault exists. */
  issueCredential?: (wallet: Wallet) => Promise<void>;
};

const Body = z.strictObject({
  wallet: z.string(),
  status: z.enum(["not_started", "pending", "approved", "rejected"]),
  /** what the underwriter checked, and how */
  note: z.string().trim().min(1).max(500),
});

/**
 * KYC is a Privy-verified email plus a staff decision. GET lists people waiting on that decision (and recent
 * ones); POST sets a status. Approval needs a verified email. Every change is logged in `admin_actions` with the
 * staff wallet and the time.
 */
export function createKycManualHandler(deps: KycManualDeps): Handler {
  const now = deps.now ?? (() => new Date());
  return async (req) => {
    const caller = await requireCaller(req, deps);
    requireStaff(caller, ["underwriter", "admin"]);

    if (req.method === "GET") {
      const people = await deps.db.listProfilesByKyc(["pending", "approved", "rejected", "not_started"]);
      return json({
        people: people.map((p) => ({
          wallet: p.wallet,
          displayName: p.displayName,
          email: p.email,
          emailVerified: p.emailVerified,
          kycStatus: p.kycStatus,
          kycUpdatedAt: p.kycUpdatedAt,
          createdAt: p.createdAt,
        })),
      });
    }
    if (req.method !== "POST") throw methodNotAllowed(["GET", "POST"]);
    const body = await readJson(req, Body);
    const wallet = normalizeWallet(body.wallet);

    const target = await deps.db.getProfile(wallet);
    if (!target) throw notFound("that wallet has no profile yet");
    if (body.status === "approved" && !target.emailVerified) {
      throw conflict("they need to verify their email by signing in with it first", "email_unverified");
    }

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
    if (body.status === "approved" && deps.issueCredential) {
      try {
        await deps.issueCredential(wallet);
      } catch (error) {
        const message = error instanceof Error ? error.message : "the credential didn't issue";
        throw conflict(`they're approved, but the credential didn't issue: ${message}`, "credential_failed");
      }
    }
    return json({ profile });
  };
}
