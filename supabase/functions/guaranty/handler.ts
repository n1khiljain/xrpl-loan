import { type NetworkConfig, requireDeployed } from "@app/config";
import type { Address } from "viem";
import { z } from "zod";
import { type TokenVerifier, requireCaller } from "../_shared/auth.ts";
import type { RegistryReads, SignatureCheck } from "../_shared/chain.ts";
import { hexSignature, loadClaim, uuid } from "../_shared/claims.ts";
import type { Db } from "../_shared/db/types.ts";
import { guarantyTypedData } from "../_shared/guaranty.ts";
import { type Handler, badRequest, conflict, forbidden, json, methodNotAllowed, readJson } from "../_shared/http.ts";
import { hashToken } from "../guarantor-invite/handler.ts";
import { requireKycApproved } from "../_shared/kyc.ts";

export type GuarantyDeps = {
  auth: TokenVerifier;
  db: Db;
  config: NetworkConfig;
  registry: RegistryReads;
  verifySignature: SignatureCheck;
  now?: () => Date;
};

const Body = z.strictObject({
  claimId: uuid,
  signature: hexSignature,
  nonce: z.string().regex(/^[0-9]+$/),
  deadline: z.string().regex(/^[0-9]+$/),
  /** the invite token, marked used once the signature is stored */
  invite: z.string().optional(),
});

/**
 * Stores the guarantor's EIP-712 guaranty after checking it against the frozen claim, the guarantor's current
 * registry nonce, and the deadline (FR-C7). The claimant then submits it onchain.
 */
export function createGuarantyHandler(deps: GuarantyDeps): Handler {
  const now = deps.now ?? (() => new Date());
  const { db, config } = deps;
  return async (req) => {
    const caller = await requireCaller(req, deps);
    if (req.method !== "POST") throw methodNotAllowed(["POST"]);
    const body = await readJson(req, Body);
    const claim = await loadClaim(db, body.claimId);
    if (claim.guarantorWallet !== caller.profile.wallet) throw forbidden("you aren't this claim's guarantor");
    requireKycApproved(caller.profile, "officer");
    if (!claim.packetHash) throw conflict("the claim isn't frozen yet", "not_frozen");
    if (claim.statusCache !== "Draft") throw conflict("this claim was already submitted", "not_draft");

    const deadline = BigInt(body.deadline);
    if (deadline <= BigInt(Math.floor(now().getTime() / 1000))) throw badRequest("the deadline has passed", "expired");
    const nonce = BigInt(body.nonce);
    const current = await deps.registry.guarantyNonce(caller.profile.wallet as Address);
    if (nonce !== current) throw conflict("you signed with an old nonce; sign again", "stale_nonce");

    const typedData = guarantyTypedData({
      chainId: config.chainId,
      registry: requireDeployed(config).claimRegistry,
      message: {
        guarantor: caller.profile.wallet as Address,
        recipient: claim.recipientWallet as Address,
        orgId: BigInt(claim.orgId),
        faceValue: BigInt(claim.faceValue),
        requestedAmount: BigInt(claim.requestedAmount),
        packetHash: claim.packetHash,
        nonce,
        deadline,
      },
    });
    const valid = await deps.verifySignature({ address: caller.profile.wallet as Address, typedData, signature: body.signature });
    if (!valid) throw badRequest("the signature doesn't match this claim", "bad_signature");

    const updated = await db.updateClaim(claim.id, {
      guarantySignature: body.signature,
      guarantyNonce: nonce.toString(),
      guarantyDeadline: Number(deadline),
    });
    if (body.invite) {
      const invite = await db.getInviteByTokenHash(await hashToken(body.invite));
      if (invite && invite.claimId === claim.id && invite.guarantorWallet === caller.profile.wallet) {
        await db.markInviteUsed(invite.id);
      }
    }
    return json({ claimId: updated.id, guarantyNonce: updated.guarantyNonce, guarantyDeadline: updated.guarantyDeadline });
  };
}
