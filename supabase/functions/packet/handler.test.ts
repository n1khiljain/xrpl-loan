import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { verifyTypedData } from "viem";
import { addReceipt, assertStatus, draftWorld } from "../_shared/fixtures.ts";
import { buildPacket, canonicalize, packetHash } from "../_shared/packet.ts";
import { FIXED_NOW, MemoryDb, assertRejectsBadTokens, call, localConfig, verifier } from "../_shared/testing.ts";
import { createPacketHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/packet";

Deno.test("packet rejects requests without a valid Privy token", async () => {
  const registry = { guarantyNonce: async () => 0n, tokenBalance: async () => 0n };
  await assertRejectsBadTokens(createPacketHandler({ auth: verifier, db: new MemoryDb(), config: localConfig(), registry }), ENDPOINT, ["POST"]);
});

Deno.test("canonicalize follows RFC 8785: sorted keys, no whitespace, ES number and string forms", () => {
  assertEquals(canonicalize({ b: 1, a: [true, null, "x"], c: { z: 1.5, y: -0 } }), '{"a":[true,null,"x"],"b":1,"c":{"y":0,"z":1.5}}');
  assertEquals(canonicalize({ "é": 1, e: 2, E: 3 }), '{"E":3,"e":2,"é":1}');
  assertEquals(canonicalize({ n: 1e21, s: 'q"\n' }), '{"n":1e+21,"s":"q\\"\\n"}');
});

Deno.test("the same inputs give the same packetHash regardless of key order or file order (FR-B4)", () => {
  const hashes = ["c".repeat(64), "a".repeat(64), "B".repeat(64)];
  const one = buildPacket({
    orgId: 1,
    recipient: "0xAbC0000000000000000000000000000000000001",
    faceValue: 500n * 10n ** 18n,
    callinkPrNumber: "PR-7",
    documentHashes: hashes,
    createdAt: "2026-10-01T12:00:00Z",
  });
  // same content, keys listed in another order, files in another order, different spellings of the same values
  const two = buildPacket({
    createdAt: new Date("2026-10-01T12:00:00.000Z"),
    documentHashes: [hashes[2] as string, hashes[0] as string, hashes[1] as string],
    callinkPrNumber: " PR-7 ",
    faceValue: "500000000000000000000",
    recipient: "0xabc0000000000000000000000000000000000001",
    orgId: 1,
  });
  assertEquals(packetHash(one), packetHash(two));
  const reordered = Object.fromEntries(Object.entries(one).reverse()) as typeof one;
  assertEquals(canonicalize(reordered), canonicalize(one));
  assertEquals(packetHash(reordered), packetHash(one));
  assertNotEquals(packetHash({ ...one, faceValue: "1" }), packetHash(one));
});

Deno.test("the packet function returns the same packetHash for the same draft with receipts added in another order", async () => {
  const first = await draftWorld({ receipts: ["receipt A", "receipt B", "receipt C"] });
  // a separate database with the same people, org, terms, and created time, and the receipts uploaded C, A, B
  const second = await draftWorld({
    receipts: ["receipt C", "receipt A", "receipt B"],
    claimant: first.claimant,
    guarantor: first.guarantor,
  });
  const freeze = async (w: typeof first) =>
    (
      await call(createPacketHandler({ auth: verifier, db: w.db, config: w.config, registry: w.registry, now: () => FIXED_NOW }), "POST", ENDPOINT, {
        token: w.claimant.token,
        body: { claimId: w.claim.id },
      })
    ).body;

  const a = await freeze(first);
  const b = await freeze(second);
  assert(typeof a.packetHash === "string" && a.packetHash.startsWith("0x"));
  assertEquals(a.packetHash, b.packetHash);
  const hashesOf = (body: typeof a) => (body.packet as { documentHashes: string[] }).documentHashes;
  assertEquals(hashesOf(a), hashesOf(b));
  assertEquals(hashesOf(a), [...hashesOf(a)].sort());
});

Deno.test("packet freezes the draft and returns EIP-712 typed data the guarantor can sign", async () => {
  const w = await draftWorld();
  w.nonces.set(w.guarantor.wallet, 3n);
  const handler = createPacketHandler({ auth: verifier, db: w.db, config: w.config, registry: w.registry, now: () => FIXED_NOW });
  const res = await call(handler, "POST", ENDPOINT, { token: w.claimant.token, body: { claimId: w.claim.id } });
  assertStatus(res, 200);
  const stored = await w.db.getClaim(w.claim.id);
  assertEquals(stored?.packetHash, res.body.packetHash);

  const typed = res.body.typedData as {
    domain: { name: string; version: string; chainId: number; verifyingContract: string };
    message: Record<string, string>;
  };
  assertEquals(typed.domain, {
    name: "FraxCollegeClaimRegistry",
    version: "1",
    chainId: 31337,
    verifyingContract: w.config.deployed.claimRegistry as string,
  });
  assertEquals(typed.message.nonce, "3");
  assertEquals(typed.message.orgId, "1");
  assertEquals(Number(typed.message.deadline), FIXED_NOW.getTime() / 1000 + 7 * 24 * 3600);

  const message = {
    guarantor: typed.message.guarantor as `0x${string}`,
    recipient: typed.message.recipient as `0x${string}`,
    orgId: BigInt(typed.message.orgId as string),
    faceValue: BigInt(typed.message.faceValue as string),
    requestedAmount: BigInt(typed.message.requestedAmount as string),
    packetHash: typed.message.packetHash as `0x${string}`,
    nonce: 3n,
    deadline: BigInt(typed.message.deadline as string),
  };
  const { GUARANTY_TYPES } = await import("../_shared/guaranty.ts");
  const domain = { ...typed.domain, verifyingContract: typed.domain.verifyingContract as `0x${string}` };
  const signature = await w.guarantor.account.signTypedData({ domain, types: GUARANTY_TYPES, primaryType: "Guaranty", message });
  assert(await verifyTypedData({ address: w.guarantor.account.address, domain, types: GUARANTY_TYPES, primaryType: "Guaranty", message, signature }));

  // freezing again keeps the hash and the draft can't change
  const again = await call(handler, "POST", ENDPOINT, { token: w.claimant.token, body: { claimId: w.claim.id } });
  assertEquals(again.body.packetHash, res.body.packetHash);
  await addReceipt(w.db, w.storage, w.claim, w.claimant, "late receipt", 9);
  assertEquals((await call(handler, "POST", ENDPOINT, { token: w.claimant.token, body: { claimId: w.claim.id } })).body.packetHash, res.body.packetHash);
});

Deno.test("packet won't freeze a draft for a member whose verification lapsed (U-77)", async () => {
  const w = await draftWorld();
  await w.db.updateProfile(w.claimant.wallet, { kycStatus: "pending", kycSource: "fraxnet_api" });
  const handler = createPacketHandler({ auth: verifier, db: w.db, config: w.config, registry: w.registry });
  assertStatus(await call(handler, "POST", ENDPOINT, { token: w.claimant.token, body: { claimId: w.claim.id } }), 403, "kyc_required");
  assertEquals((await w.db.getClaim(w.claim.id))?.packetHash, null);
});

Deno.test("packet needs the claimant, a guarantor, and confirmed receipts", async () => {
  const w = await draftWorld({ receipts: [] });
  const handler = createPacketHandler({ auth: verifier, db: w.db, config: w.config, registry: w.registry });
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
