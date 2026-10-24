import { assertEquals, assertStringIncludes } from "@std/assert";
import { assertStatus, draftWorld } from "../_shared/fixtures.ts";
import { MemoryStorage } from "../_shared/storage.ts";
import { MemoryDb, assertRejectsBadTokens, call, makeUser, verifier } from "../_shared/testing.ts";
import { createDocumentsReadHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/documents-read";

Deno.test("documents-read rejects requests without a valid Privy token", async () => {
  await assertRejectsBadTokens(createDocumentsReadHandler({ auth: verifier, db: new MemoryDb(), storage: new MemoryStorage() }), ENDPOINT, ["POST"]);
});

Deno.test("claimant, org officers, and underwriters get a 5-minute signed ENDPOINT; others get 404 (FR-B3)", async () => {
  const w = await draftWorld();
  const [doc] = await w.db.listDocuments(w.claim.id);
  if (!doc) throw new Error("no receipt");
  const underwriter = await makeUser(w.db, { staff: "underwriter" });
  const attester = await makeUser(w.db, { staff: "attester" });
  const handler = createDocumentsReadHandler({ auth: verifier, db: w.db, storage: w.storage });
  const read = (token: string) => call(handler, "POST", ENDPOINT, { token, body: { documentId: doc.id } });

  for (const reader of [w.claimant, w.guarantor, underwriter]) {
    const res = await read(reader.token);
    assertStatus(res, 200);
    assertEquals(res.body.expiresIn, 300);
    assertStringIncludes(String(res.body.signedPath), `/storage/v1/object/sign/receipts/${doc.storagePath}`);
  }
  assertStatus(await read(w.outsider.token), 404);
  assertStatus(await read(attester.token), 404);
});
