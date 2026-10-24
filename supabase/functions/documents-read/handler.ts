import { z } from "zod";
import { type TokenVerifier, requireCaller } from "../_shared/auth.ts";
import { canReadReceipts, loadClaim, uuid } from "../_shared/claims.ts";
import type { Db } from "../_shared/db/types.ts";
import { type Handler, conflict, json, methodNotAllowed, notFound, readJson } from "../_shared/http.ts";
import { type ReceiptStorage, SIGNED_URL_SECONDS } from "../_shared/storage.ts";

export type DocumentsReadDeps = { auth: TokenVerifier; db: Db; storage: ReceiptStorage };

const Body = z.strictObject({ documentId: uuid });

/**
 * A five-minute signed URL for one receipt, for the claimant, the org's active officers, and underwriters only.
 * Anyone else gets a 404, so document IDs can't be probed.
 */
export function createDocumentsReadHandler(deps: DocumentsReadDeps): Handler {
  const { db, storage } = deps;
  return async (req) => {
    const caller = await requireCaller(req, deps);
    if (req.method !== "POST") throw methodNotAllowed(["POST"]);
    const { documentId } = await readJson(req, Body);
    const doc = await db.getDocument(documentId);
    if (!doc) throw notFound("no such document");
    const claim = await loadClaim(db, doc.claimId);
    if (!(await canReadReceipts(db, caller, claim))) throw notFound("no such document");
    if (doc.sha256 === null) throw conflict("this receipt hasn't finished uploading", "not_confirmed");
    const signedPath = await storage.signedRead(doc.storagePath, SIGNED_URL_SECONDS);
    return json({ signedPath, expiresIn: SIGNED_URL_SECONDS, sha256: doc.sha256, mimeType: doc.mimeType });
  };
}
