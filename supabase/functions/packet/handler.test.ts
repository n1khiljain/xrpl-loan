import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { addReceipt, assertStatus, draftWorld } from "../_shared/fixtures.ts";
import { buildPacket, canonicalize, packetHash } from "../_shared/packet.ts";
import { MemoryDb, assertRejectsBadTokens, call, verifier } from "../_shared/testing.ts";
import { createPacketHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/packet";
const RECIPIENT = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";

Deno.test("packet rejects requests without a valid Privy token", async () => {
  await assertRejectsBadTokens(createPacketHandler({ auth: verifier, db: new MemoryDb() }), ENDPOINT, ["POST"]);
});

Deno.test("canonicalize follows RFC 8785: sorted keys, no whitespace, ES number and string forms", () => {
  assertEquals(canonicalize({ b: 1, a: [true, null, "x"], c: { z: 1.5, y: -0 } }), '{"a":[true,null,"x"],"b":1,"c":{"y":0,"z":1.5}}');
  assertEquals(canonicalize({ "é": 1, e: 2, E: 3 }), '{"E":3,"e":2,"é":1}');
  assertEquals(canonicalize({ n: 1e21, s: 'q"\n' }), '{"n":1e+21,"s":"q\\"\\n"}');
});

Deno.test("the same inputs give the same packetHash regardless of key order or file order", async () => {
  const hashes = ["c".repeat(64), "a".repeat(64), "B".repeat(64)];
  const one = buildPacket({
    orgId: 1,
    recipient: RECIPIENT,
    faceValue: 500_000_000n,
    callinkPrNumber: "PR-7",
    documentHashes: hashes,
    createdAt: "2026-10-01T12:00:00Z",
  });
  const two = buildPacket({
    createdAt: new Date("2026-10-01T12:00:00.000Z"),
    documentHashes: [hashes[2] as string, hashes[0] as string, hashes[1] as string],
    callinkPrNumber: " PR-7 ",
    faceValue: "500000000",
    recipient: RECIPIENT,
    orgId: 1,
  });
  assertEquals(await packetHash(one), await packetHash(two));
  const reordered = Object.fromEntries(Object.entries(one).reverse()) as typeof one;
  assertEquals(canonicalize(reordered), canonicalize(one));
  assertNotEquals(await packetHash({ ...one, faceValue: "1" }), await packetHash(one));
  assert(/^[0-9a-f]{64}$/.test(await packetHash(one)));
});

Deno.test("packet freezes the draft once; later receipts don't change the hash", async () => {
  const w = await draftWorld({ receipts: ["receipt C", "receipt A", "receipt B"] });
  const handler = createPacketHandler({ auth: verifier, db: w.db });
  const res = await call(handler, "POST", ENDPOINT, { token: w.claimant.token, body: { claimId: w.claim.id } });
  assertStatus(res, 200);
  const stored = await w.db.getClaim(w.claim.id);
  assertEquals(stored?.packetHash, res.body.packetHash);
  const docs = (res.body.packet as { documentHashes: string[] }).documentHashes;
  assertEquals(docs, [...docs].sort());

  await addReceipt(w.db, w.storage, w.claim, w.claimant, "late receipt", 9);
  const again = await call(handler, "POST", ENDPOINT, { token: w.claimant.token, body: { claimId: w.claim.id } });
  assertEquals(again.body.packetHash, res.body.packetHash);
});

Deno.test("packet won't freeze a draft for a member whose verification lapsed", async () => {
  const w = await draftWorld();
  await w.db.updateProfile(w.claimant.wallet, { kycStatus: "pending" });
  const handler = createPacketHandler({ auth: verifier, db: w.db });
  assertStatus(await call(handler, "POST", ENDPOINT, { token: w.claimant.token, body: { claimId: w.claim.id } }), 403, "kyc_required");
  assertEquals((await w.db.getClaim(w.claim.id))?.packetHash, null);
});

Deno.test("packet needs the claimant, a guarantor, and confirmed receipts", async () => {
  const w = await draftWorld({ receipts: [] });
  const handler = createPacketHandler({ auth: verifier, db: w.db });
  const post = (token: string) => call(handler, "POST", ENDPOINT, { token, body: { claimId: w.claim.id } });
  assertStatus(await post(w.guarantor.token), 403);
  assertStatus(await post(w.claimant.token), 409, "no_documents");
  const pending = await w.db.insertDocument({
    claimId: w.claim.id,
    storagePath: `${w.claim.id}/pending`,
    mimeType: "image/png",
    sizeBytes: 5,
    uploadedBy: w.claimant.wallet,
  });
  assertStatus(await post(w.claimant.token), 409, "unconfirmed_documents");
  await w.db.setDocumentHash(pending.id, "d".repeat(64));
  await w.db.updateClaim(w.claim.id, { guarantorWallet: null });
  assertStatus(await post(w.claimant.token), 409, "no_guarantor");
});
