import { z } from "zod";
import { type TokenVerifier, requireCaller } from "../_shared/auth.ts";
import { documentView, isEditable, loadClaim, requireClaimant, uuid } from "../_shared/claims.ts";
import type { Db } from "../_shared/db/types.ts";
import { type Handler, conflict, forbidden, json, methodNotAllowed, notFound, readJson } from "../_shared/http.ts";
import { type ReceiptStorage, sha256Hex } from "../_shared/storage.ts";

export type DocumentsDeps = { auth: TokenVerifier; db: Db; storage: ReceiptStorage };

/** Matches the bucket's `allowed_mime_types` and `file_size_limit`. */
export const RECEIPT_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/heic", "image/webp"] as const;
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
export const MAX_RECEIPTS_PER_CLAIM = 20;

const Body = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("create"),
    claimId: uuid,
    mimeType: z.enum(RECEIPT_TYPES),
    sizeBytes: z.int().min(1).max(MAX_RECEIPT_BYTES),
  }),
  z.strictObject({ action: z.literal("confirm"), documentId: uuid }),
]);

/**
 * Receipt uploads (FR-B3). `create` records the file and returns a one-time signed upload target in the private
 * bucket. `confirm` reads the uploaded bytes back and stores their SHA-256, which goes into the packet.
 */
export function createDocumentsHandler(deps: DocumentsDeps): Handler {
  const { db, storage } = deps;
  return async (req) => {
    const caller = await requireCaller(req, deps);
    if (req.method !== "POST") throw methodNotAllowed(["POST"]);
    const body = await readJson(req, Body);

    if (body.action === "create") {
      const claim = await loadClaim(db, body.claimId);
      requireClaimant(caller, claim);
      if (!isEditable(claim)) throw conflict("the packet is frozen, so receipts can't change", "frozen");
      if ((await db.listDocuments(claim.id)).length >= MAX_RECEIPTS_PER_CLAIM) {
        throw conflict(`a claim can have at most ${MAX_RECEIPTS_PER_CLAIM} receipts`, "too_many_documents");
      }
      const id = crypto.randomUUID();
      // no file name in the path: names often carry personal details
      const storagePath = `${claim.id}/${id}`;
      const doc = await db.insertDocument({
        id,
        claimId: claim.id,
        storagePath,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes,
        uploadedBy: caller.profile.wallet,
      });
      const upload = await storage.signedUpload(storagePath);
      return json({ document: documentView(doc), upload }, { status: 201 });
    }

    const doc = await db.getDocument(body.documentId);
    if (!doc) throw notFound("no such document");
    const claim = await loadClaim(db, doc.claimId);
    requireClaimant(caller, claim);
    if (doc.uploadedBy !== caller.profile.wallet) throw forbidden("only the uploader can confirm a receipt");
    if (doc.sha256 !== null) return json({ document: documentView(doc) });
    if (!isEditable(claim)) throw conflict("the packet is frozen, so receipts can't change", "frozen");
    const bytes = await storage.read(doc.storagePath);
    if (!bytes) throw conflict("upload the file before confirming it", "not_uploaded");
    if (bytes.byteLength !== doc.sizeBytes) throw conflict("the uploaded file isn't the size declared", "size_mismatch");
    const confirmed = await db.setDocumentHash(doc.id, await sha256Hex(bytes));
    return json({ document: documentView(confirmed) });
  };
}
