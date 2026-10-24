import { assertEquals } from "@std/assert";
import { assertStatus, draftWorld } from "../_shared/fixtures.ts";
import { MemoryMailer } from "../_shared/mail.ts";
import { FIXED_NOW, MemoryDb, assertRejectsBadTokens, call, verifier } from "../_shared/testing.ts";
import { createInviteHandler } from "../guarantor-invite/handler.ts";
import { createPacketHandler } from "../packet/handler.ts";
import { createGuarantyHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/guaranty";

async function frozenWorld() {
  const w = await draftWorld();
  const packet = await call(createPacketHandler({ auth: verifier, db: w.db }), "POST", "http://localhost/packet", {
    token: w.claimant.token,
    body: { claimId: w.claim.id },
  });
  const handler = createGuarantyHandler({ auth: verifier, db: w.db, now: () => FIXED_NOW });
  return { ...w, handler, body: { claimId: w.claim.id, packetHash: String(packet.body.packetHash) } };
}

Deno.test("guaranty rejects requests without a valid Privy token", async () => {
  await assertRejectsBadTokens(createGuarantyHandler({ auth: verifier, db: new MemoryDb() }), ENDPOINT, ["POST"]);
});

Deno.test("the guarantor's sign-off is stored with its time and logged against the packet hash", async () => {
  const w = await frozenWorld();
  const res = await call(w.handler, "POST", ENDPOINT, { token: w.guarantor.token, body: w.body });
  assertStatus(res, 200);
  assertEquals((await w.db.getClaim(w.claim.id))?.guarantySignedAt, FIXED_NOW.toISOString());
  assertEquals(w.db.adminActions.at(-1), {
    actorWallet: w.guarantor.wallet,
    action: "guaranty_signed",
    target: w.claim.id,
    payload: { packetHash: w.body.packetHash, at: FIXED_NOW.toISOString() },
  });
});

Deno.test("guaranty refuses anyone but the guarantor, a stale packet, a draft that isn't frozen, and a submitted claim", async () => {
  const w = await frozenWorld();
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.claimant.token, body: w.body }), 403);
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.guarantor.token, body: { ...w.body, packetHash: "e".repeat(64) } }), 409, "stale_packet");
  await w.db.updateClaim(w.claim.id, { status: "Submitted" });
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.guarantor.token, body: w.body }), 409, "not_draft");

  const d = await draftWorld();
  const handler = createGuarantyHandler({ auth: verifier, db: d.db });
  assertStatus(await call(handler, "POST", ENDPOINT, { token: d.guarantor.token, body: { claimId: d.claim.id, packetHash: "a".repeat(64) } }), 409, "not_frozen");
});

Deno.test("an officer who isn't verified, or isn't an officer anymore, can't sign off", async () => {
  const w = await frozenWorld();
  await w.db.updateProfile(w.guarantor.wallet, { kycStatus: "pending" });
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.guarantor.token, body: w.body }), 403, "kyc_required");
  await w.db.updateProfile(w.guarantor.wallet, { kycStatus: "approved" });
  w.db.officers.set(`1:${w.guarantor.wallet}`, { orgId: 1, wallet: w.guarantor.wallet, title: null, active: false });
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.guarantor.token, body: w.body }), 409, "not_officer");
  assertEquals((await w.db.getClaim(w.claim.id))?.guarantySignedAt, null);
});

Deno.test("signing through an invite marks the invite used", async () => {
  const w = await frozenWorld();
  const invites = createInviteHandler({ auth: verifier, db: w.db, mailer: new MemoryMailer(), appBaseUrl: "http://x", now: () => FIXED_NOW });
  const created = await call(invites, "POST", "http://localhost/guarantor-invite", { token: w.claimant.token, body: { claimId: w.claim.id } });
  const invite = new URL(String(created.body.inviteUrl)).searchParams.get("invite") as string;
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.guarantor.token, body: { ...w.body, invite } }), 200);
  const [row] = [...w.db.invites.values()];
  assertEquals(row?.usedAt, FIXED_NOW.toISOString());
  const reopened = await call(invites, "GET", `http://localhost/guarantor-invite?invite=${invite}`, { token: w.guarantor.token });
  assertStatus(reopened, 410, "used");
});
