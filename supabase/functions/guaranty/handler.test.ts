import { assertEquals } from "@std/assert";
import { eoaSignatureCheck } from "../_shared/chain.ts";
import { assertStatus, draftWorld } from "../_shared/fixtures.ts";
import { GUARANTY_TYPES } from "../_shared/guaranty.ts";
import { MemoryMailer } from "../_shared/mail.ts";
import { FIXED_NOW, MemoryDb, assertRejectsBadTokens, call, localConfig, verifier } from "../_shared/testing.ts";
import { createInviteHandler } from "../guarantor-invite/handler.ts";
import { createPacketHandler } from "../packet/handler.ts";
import { createGuarantyHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/guaranty";

type Typed = {
  domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` };
  message: Record<string, string>;
};

async function signedWorld() {
  const w = await draftWorld();
  w.nonces.set(w.guarantor.wallet, 2n);
  const packet = createPacketHandler({ auth: verifier, db: w.db, config: w.config, registry: w.registry, now: () => FIXED_NOW });
  const frozen = await call(packet, "POST", "http://localhost/packet", { token: w.claimant.token, body: { claimId: w.claim.id } });
  const typed = frozen.body.typedData as Typed;
  const message = {
    guarantor: typed.message.guarantor as `0x${string}`,
    recipient: typed.message.recipient as `0x${string}`,
    orgId: BigInt(typed.message.orgId as string),
    faceValue: BigInt(typed.message.faceValue as string),
    requestedAmount: BigInt(typed.message.requestedAmount as string),
    packetHash: typed.message.packetHash as `0x${string}`,
    nonce: BigInt(typed.message.nonce as string),
    deadline: BigInt(typed.message.deadline as string),
  };
  const signature = await w.guarantor.account.signTypedData({ domain: typed.domain, types: GUARANTY_TYPES, primaryType: "Guaranty", message });
  const handler = createGuarantyHandler({
    auth: verifier,
    db: w.db,
    config: w.config,
    registry: w.registry,
    verifySignature: eoaSignatureCheck,
    now: () => FIXED_NOW,
  });
  const body = { claimId: w.claim.id, signature, nonce: message.nonce.toString(), deadline: message.deadline.toString() };
  return { ...w, handler, body, message, typed };
}

Deno.test("guaranty rejects requests without a valid Privy token", async () => {
  const db = new MemoryDb();
  const registry = { guarantyNonce: async () => 0n, tokenBalance: async () => 0n };
  await assertRejectsBadTokens(
    createGuarantyHandler({ auth: verifier, db, config: localConfig(), registry, verifySignature: eoaSignatureCheck }),
    ENDPOINT,
    ["POST"],
  );
});

Deno.test("a valid signature from the guarantor is stored with its nonce and deadline", async () => {
  const w = await signedWorld();
  const res = await call(w.handler, "POST", ENDPOINT, { token: w.guarantor.token, body: w.body });
  assertStatus(res, 200);
  const claim = await w.db.getClaim(w.claim.id);
  assertEquals([claim?.guarantySignature, claim?.guarantyNonce, claim?.guarantyDeadline], [
    w.body.signature.toLowerCase(),
    "2",
    Number(w.message.deadline),
  ]);
});

Deno.test("guaranty refuses the wrong signer, altered terms, a stale nonce, and a past deadline", async () => {
  const w = await signedWorld();
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.claimant.token, body: w.body }), 403);

  const byClaimant = await w.claimant.account.signTypedData({ domain: w.typed.domain, types: GUARANTY_TYPES, primaryType: "Guaranty", message: w.message });
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.guarantor.token, body: { ...w.body, signature: byClaimant } }), 400, "bad_signature");

  const other = { ...w.message, requestedAmount: w.message.requestedAmount + 1n };
  const alteredSig = await w.guarantor.account.signTypedData({ domain: w.typed.domain, types: GUARANTY_TYPES, primaryType: "Guaranty", message: other });
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.guarantor.token, body: { ...w.body, signature: alteredSig } }), 400, "bad_signature");

  w.nonces.set(w.guarantor.wallet, 3n);
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.guarantor.token, body: w.body }), 409, "stale_nonce");
  w.nonces.set(w.guarantor.wallet, 2n);

  const past = String(Math.floor(FIXED_NOW.getTime() / 1000) - 1);
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.guarantor.token, body: { ...w.body, deadline: past } }), 400, "expired");
  assertEquals((await w.db.getClaim(w.claim.id))?.guarantySignature, null);
});

Deno.test("an officer who isn't verified on FraxNet can't sign off (U-24, U-77)", async () => {
  const w = await signedWorld();
  await w.db.updateProfile(w.guarantor.wallet, { kycStatus: "not_started", kycSource: null });
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.guarantor.token, body: w.body }), 403, "kyc_required");
  assertEquals((await w.db.getClaim(w.claim.id))?.guarantySignature, null);
});

Deno.test("signing through an invite marks the invite used", async () => {
  const w = await signedWorld();
  const invites = createInviteHandler({
    auth: verifier,
    db: w.db,
    config: w.config,
    registry: w.registry,
    mailer: new MemoryMailer(),
    appBaseUrl: "http://x",
    now: () => FIXED_NOW,
  });
  const created = await call(invites, "POST", "http://localhost/guarantor-invite", { token: w.claimant.token, body: { claimId: w.claim.id } });
  const invite = new URL(String(created.body.inviteUrl)).searchParams.get("invite") as string;
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.guarantor.token, body: { ...w.body, invite } }), 200);
  const [row] = [...w.db.invites.values()];
  assertEquals(row?.usedAt, FIXED_NOW.toISOString());
  // a used invite no longer opens (E-3c); the claim itself is on the guarantor's Sign-offs list
  const reopened = await call(invites, "GET", `http://localhost/guarantor-invite?invite=${invite}`, { token: w.guarantor.token });
  assertStatus(reopened, 410, "used");
});
