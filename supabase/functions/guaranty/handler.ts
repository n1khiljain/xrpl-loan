import { z } from "zod";
import { type TokenVerifier, requireCaller } from "../_shared/auth.ts";
import { loadClaim, requireKycApproved, uuid } from "../_shared/claims.ts";
import type { Db } from "../_shared/db/types.ts";
import { type Handler, conflict, forbidden, json, methodNotAllowed, readJson } from "../_shared/http.ts";
import { hashToken } from "../guarantor-invite/handler.ts";

export type GuarantyDeps = { auth: TokenVerifier; db: Db; now?: () => Date };

const Body = z.strictObject({
  claimId: uuid,
  /** the frozen packet hash the guarantor saw, so a sign-off can't land on a packet that changed under them */
  packetHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** the invite token, marked used once the sign-off is stored */
  invite: z.string().optional(),
});

/**
 * The guarantor signs off on a frozen claim: they agree to cover what's left if the payer never pays. The sign-off
 * is bound to the packet hash they were shown and logged in admin_actions; the claimant then sends it for review.
 */
export function createGuarantyHandler(deps: GuarantyDeps): Handler {
  const now = deps.now ?? (() => new Date());
  const { db } = deps;
  return async (req) => {
    const caller = await requireCaller(req, deps);
    if (req.method !== "POST") throw methodNotAllowed(["POST"]);
    const body = await readJson(req, Body);
    const claim = await loadClaim(db, body.claimId);
    if (claim.guarantorWallet !== caller.profile.wallet) throw forbidden("you aren't this claim's guarantor");
    requireKycApproved(caller, "officer");
    if (!claim.packetHash) throw conflict("the claim isn't frozen yet", "not_frozen");
    if (claim.packetHash !== body.packetHash) throw conflict("the claim changed since you opened it; reload and check it again", "stale_packet");
    if (claim.status !== "Draft") throw conflict("this claim was already submitted", "not_draft");
    if (!(await db.isActiveOfficer(claim.orgId, caller.profile.wallet))) {
      throw conflict("you're no longer an active officer of this org", "not_officer");
    }

    const at = now().toISOString();
    const updated = claim.guarantySignedAt ? claim : await db.updateClaim(claim.id, { guarantySignedAt: at });
    await db.insertAdminAction({
      actorWallet: caller.profile.wallet,
      action: "guaranty_signed",
      target: claim.id,
      payload: { packetHash: claim.packetHash, at },
    });
    if (body.invite) {
      const invite = await db.getInviteByTokenHash(await hashToken(body.invite));
      if (invite && invite.claimId === claim.id && invite.guarantorWallet === caller.profile.wallet) {
        await db.markInviteUsed(invite.id);
      }
    }
    return json({ claimId: updated.id, guarantySignedAt: updated.guarantySignedAt });
  };
}
