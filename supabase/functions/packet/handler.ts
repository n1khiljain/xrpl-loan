import { z } from "zod";
import { type TokenVerifier, requireCaller } from "../_shared/auth.ts";
import { loadClaim, requireClaimant, requireKycApproved, uuid } from "../_shared/claims.ts";
import { type Db, UniqueViolation } from "../_shared/db/types.ts";
import { type Handler, conflict, json, methodNotAllowed, readJson } from "../_shared/http.ts";
import { type ClaimPacket, buildPacket, packetHash } from "../_shared/packet.ts";

export type PacketDeps = { auth: TokenVerifier; db: Db };

const Body = z.strictObject({ claimId: uuid });

/**
 * Freezes a draft into its canonical packet and returns `packetHash`. After this the amounts, documents, and
 * guarantor can't change, so the guarantor signs off on exactly what the underwriter reviews. Calling it again
 * returns the same hash.
 */
export function createPacketHandler(deps: PacketDeps): Handler {
  const { db } = deps;
  return async (req) => {
    const caller = await requireCaller(req, deps);
    if (req.method !== "POST") throw methodNotAllowed(["POST"]);
    const { claimId } = await readJson(req, Body);
    let claim = await loadClaim(db, claimId);
    requireClaimant(caller, claim);
    requireKycApproved(caller, "member");

    if (claim.packetHash === null) {
      if (claim.status !== "Draft") throw conflict("only a draft can be frozen", "not_draft");
      if (!claim.guarantorWallet) throw conflict("choose a guarantor first", "no_guarantor");
      const docs = await db.listDocuments(claim.id);
      if (docs.length === 0) throw conflict("add at least one receipt", "no_documents");
      if (docs.some((d) => d.sha256 === null)) throw conflict("every receipt must finish uploading", "unconfirmed_documents");
      const packet = buildPacket({
        orgId: claim.orgId,
        recipient: claim.recipientWallet,
        faceValue: claim.faceValue,
        callinkPrNumber: claim.callinkPrNumber,
        documentHashes: docs.map((d) => d.sha256 as string),
        createdAt: claim.createdAt,
      });
      try {
        claim = await db.updateClaim(claim.id, { packetJson: packet, packetHash: await packetHash(packet) });
      } catch (error) {
        if (error instanceof UniqueViolation) throw conflict("another claim already has this packet", "duplicate_packet");
        throw error;
      }
    }

    return json({ packetHash: claim.packetHash, packet: claim.packetJson as ClaimPacket });
  };
}
