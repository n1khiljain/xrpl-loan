import { z } from "zod";
import { type TokenVerifier, requireCaller } from "../_shared/auth.ts";
import { loadReceivable, requireKycApproved, uuid } from "../_shared/receivables.ts";
import type { Db } from "../_shared/db/types.ts";
import { type Handler, conflict, forbidden, json, methodNotAllowed, readJson } from "../_shared/http.ts";
import { hashToken } from "../guarantor-invite/handler.ts";

export type GuarantyDeps = { auth: TokenVerifier; db: Db; now?: () => Date };

const Body = z.strictObject({
  receivableId: uuid,
  /** the frozen packet hash the guarantor saw, so a sign-off can't land on a packet that changed under them */
  packetHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** the invite token, marked used once the sign-off is stored */
  invite: z.string().optional(),
});

/**
 * The guarantor signs off on a frozen receivable: they agree to cover what's left if the payer never pays. The sign-off
 * is bound to the packet hash they were shown and logged in admin_actions; the seller then sends it for review.
 */
export function createGuarantyHandler(deps: GuarantyDeps): Handler {
  const now = deps.now ?? (() => new Date());
  const { db } = deps;
  return async (req) => {
    const caller = await requireCaller(req, deps);
    if (req.method !== "POST") throw methodNotAllowed(["POST"]);
    const body = await readJson(req, Body);
    const receivable = await loadReceivable(db, body.receivableId);
    if (receivable.guarantorWallet !== caller.profile.wallet) throw forbidden("you aren't this receivable's guarantor");
    requireKycApproved(caller, "officer");
    if (!receivable.packetHash) throw conflict("the receivable isn't frozen yet", "not_frozen");
    if (receivable.packetHash !== body.packetHash) throw conflict("the receivable changed since you opened it; reload and check it again", "stale_packet");
    if (receivable.status !== "Draft") throw conflict("this receivable was already submitted", "not_draft");
    if (receivable.orgId === null || !(await db.isActiveOfficer(receivable.orgId, caller.profile.wallet))) {
      throw conflict("you're no longer an active officer of this org", "not_officer");
    }

    const at = now().toISOString();
    const updated = receivable.guarantySignedAt ? receivable : await db.updateReceivable(receivable.id, { guarantySignedAt: at });
    await db.insertAdminAction({
      actorWallet: caller.profile.wallet,
      action: "guaranty_signed",
      target: receivable.id,
      payload: { packetHash: receivable.packetHash, at },
    });
    if (body.invite) {
      const invite = await db.getInviteByTokenHash(await hashToken(body.invite));
      if (invite && invite.receivableId === receivable.id && invite.guarantorWallet === caller.profile.wallet) {
        await db.markInviteUsed(invite.id);
      }
    }
    return json({ receivableId: updated.id, guarantySignedAt: updated.guarantySignedAt });
  };
}
