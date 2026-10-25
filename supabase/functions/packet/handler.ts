import { z } from "zod";
import { type TokenVerifier, requireCaller } from "../_shared/auth.ts";
import { loadReceivable, requireSeller, requireKycApproved, uuid } from "../_shared/receivables.ts";
import { type Db, UniqueViolation } from "../_shared/db/types.ts";
import { type Handler, conflict, json, methodNotAllowed, readJson } from "../_shared/http.ts";
import { type ReceivablePacket, buildPacket, packetHash } from "../_shared/packet.ts";

export type PacketDeps = { auth: TokenVerifier; db: Db };

const Body = z.strictObject({ receivableId: uuid });

/**
 * Freezes a draft into its canonical packet and returns `packetHash`. After this the amounts, payer, due date,
 * documents, and guarantor can't change, so the guarantor (if any) signs off on exactly what the underwriter reviews. Calling it again
 * returns the same hash.
 */
export function createPacketHandler(deps: PacketDeps): Handler {
  const { db } = deps;
  return async (req) => {
    const caller = await requireCaller(req, deps);
    if (req.method !== "POST") throw methodNotAllowed(["POST"]);
    const { receivableId } = await readJson(req, Body);
    let receivable = await loadReceivable(db, receivableId);
    requireSeller(caller, receivable);
    requireKycApproved(caller, "member");

    if (receivable.packetHash === null) {
      if (receivable.status !== "Draft") throw conflict("only a draft can be frozen", "not_draft");
      // an org's receivable is backed by one of its officers; other kinds may go without a guarantor
      if (receivable.orgId !== null && !receivable.guarantorWallet) throw conflict("choose an officer to sign off first", "no_guarantor");
      const docs = await db.listDocuments(receivable.id);
      if (docs.length === 0) throw conflict("add at least one receipt", "no_documents");
      if (docs.some((d) => d.sha256 === null)) throw conflict("every receipt must finish uploading", "unconfirmed_documents");
      const packet = buildPacket({
        type: receivable.type,
        recipient: receivable.recipientWallet,
        payerName: receivable.payerName,
        dueDate: receivable.dueDate,
        orgId: receivable.orgId,
        faceValue: receivable.faceValue,
        reference: receivable.reference,
        documentHashes: docs.map((d) => d.sha256 as string),
        createdAt: receivable.createdAt,
      });
      try {
        receivable = await db.updateReceivable(receivable.id, { packetJson: packet, packetHash: await packetHash(packet) });
      } catch (error) {
        if (error instanceof UniqueViolation) throw conflict("another receivable already has this packet", "duplicate_packet");
        throw error;
      }
    }

    return json({ packetHash: receivable.packetHash, packet: receivable.packetJson as ReceivablePacket });
  };
}
