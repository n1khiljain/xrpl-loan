import { assertEquals, assertMatch } from "@std/assert";
import { assertStatus, draftWorld } from "../_shared/fixtures.ts";
import { MemoryStorage, sha256Hex } from "../_shared/storage.ts";
import { MemoryDb, assertRejectsBadTokens, call, verifier } from "../_shared/testing.ts";
import { createDocumentsHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/documents";

Deno.test("documents rejects requests without a valid Privy token", async () => {
  const storage = new MemoryStorage();
  await assertRejectsBadTokens(createDocumentsHandler({ auth: verifier, db: new MemoryDb(), storage }), ENDPOINT, ["POST"]);
  assertEquals(storage.uploads.length, 0);
});

Deno.test("create returns a signed upload target; confirm hashes what was uploaded", async () => {
  const w = await draftWorld({ receipts: [] });
  const handler = createDocumentsHandler({ auth: verifier, db: w.db, storage: w.storage });
  const bytes = new TextEncoder().encode("%PDF-1.7 receipt for snacks");

  const created = await call(handler, "POST", ENDPOINT, {
    token: w.claimant.token,
    body: { action: "create", claimId: w.claim.id, mimeType: "application/pdf", sizeBytes: bytes.byteLength },
  });
  assertStatus(created, 201);
  const doc = created.body.document as { id: string; sha256: string | null };
  const upload = created.body.upload as { path: string; token: string };
  assertEquals(doc.sha256, null);
  assertEquals(upload.path, `${w.claim.id}/${doc.id}`);

  assertStatus(await call(handler, "POST", ENDPOINT, { token: w.claimant.token, body: { action: "confirm", documentId: doc.id } }), 409, "not_uploaded");
  w.storage.put(upload.path, bytes);
  const confirmed = await call(handler, "POST", ENDPOINT, { token: w.claimant.token, body: { action: "confirm", documentId: doc.id } });
  assertStatus(confirmed, 200);
  const sha = (confirmed.body.document as { sha256: string }).sha256;
  assertMatch(sha, /^[0-9a-f]{64}$/);
  assertEquals(sha, await sha256Hex(bytes));
});

Deno.test("only the claimant uploads, only allowed types and sizes, and only before the packet is frozen", async () => {
  const w = await draftWorld({ receipts: [] });
  const handler = createDocumentsHandler({ auth: verifier, db: w.db, storage: w.storage });
  const create = (token: string, extra: Record<string, unknown> = {}) =>
    call(handler, "POST", ENDPOINT, {
      token,
      body: { action: "create", claimId: w.claim.id, mimeType: "image/png", sizeBytes: 100, ...extra },
    });
  assertStatus(await create(w.guarantor.token), 403);
  assertStatus(await create(w.claimant.token, { mimeType: "text/html" }), 400);
  assertStatus(await create(w.claimant.token, { sizeBytes: 10 * 1024 * 1024 + 1 }), 400);

  const made = await create(w.claimant.token);
  const doc = made.body.document as { id: string };
  const upload = made.body.upload as { path: string };
  w.storage.put(upload.path, new Uint8Array(99));
  assertStatus(await call(handler, "POST", ENDPOINT, { token: w.claimant.token, body: { action: "confirm", documentId: doc.id } }), 409, "size_mismatch");

  await w.db.updateClaim(w.claim.id, { packetHash: "22".repeat(32), packetJson: {} });
  assertStatus(await create(w.claimant.token), 409, "frozen");
});
