import { assertEquals } from "@std/assert";
import { assertStatus, draftWorld } from "../_shared/fixtures.ts";
import { MemoryDb, assertRejectsBadTokens, call, localConfig, makeUser, seedOrg, verifier } from "../_shared/testing.ts";
import { createClaimsHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/claims";
const USD = 10n ** 18n;

function draftBody(overrides: Record<string, unknown> = {}) {
  return {
    orgId: 1,
    faceValue: (300n * USD).toString(),
    requestedAmount: (300n * USD).toString(),
    callinkPrNumber: "PR-100",
    ...overrides,
  };
}

Deno.test("claims rejects requests without a valid Privy token", async () => {
  const db = new MemoryDb();
  await assertRejectsBadTokens(createClaimsHandler({ auth: verifier, db, config: localConfig() }), ENDPOINT, ["GET", "POST", "PATCH"]);
  assertEquals(db.claims.size, 0);
});

Deno.test("POST creates a draft for the caller; the same CalLink request can't be sold twice", async () => {
  const db = new MemoryDb();
  const claimant = await makeUser(db, { kyc: "approved" });
  const officer = await makeUser(db);
  seedOrg(db, 1, "Blockchain at Berkeley", [officer.wallet]);
  const handler = createClaimsHandler({ auth: verifier, db, config: localConfig() });

  const created = await call(handler, "POST", ENDPOINT, { token: claimant.token, body: draftBody({ guarantorWallet: officer.account.address }) });
  assertStatus(created, 201);
  const claim = created.body.claim as { recipientWallet: string; status: string; guarantorWallet: string };
  assertEquals([claim.recipientWallet, claim.status, claim.guarantorWallet], [claimant.wallet, "Draft", officer.wallet]);

  const dupe = await call(handler, "POST", ENDPOINT, { token: claimant.token, body: draftBody() });
  assertStatus(dupe, 409, "duplicate_callink");
});

Deno.test("POST needs the member verified on FraxNet first, whatever else is wrong (U-24, U-77)", async () => {
  const db = new MemoryDb();
  const officer = await makeUser(db);
  seedOrg(db, 1, "Blockchain at Berkeley", [officer.wallet]);
  const handler = createClaimsHandler({ auth: verifier, db, config: localConfig() });
  for (const kyc of [undefined, "pending", "rejected"] as const) {
    const member = await makeUser(db, kyc ? { kyc } : {});
    const res = await call(handler, "POST", ENDPOINT, { token: member.token, body: draftBody({ guarantorWallet: officer.wallet }) });
    assertStatus(res, 403, "kyc_required");
  }
  assertEquals(db.claims.size, 0);
});

Deno.test("POST enforces amounts, the per-claim cap, org state, and guarantor rules", async () => {
  const db = new MemoryDb();
  const claimant = await makeUser(db, { kyc: "approved" });
  const stranger = await makeUser(db);
  seedOrg(db, 1, "Blockchain at Berkeley", [claimant.wallet]);
  db.orgs.set(2, { id: 2, name: "Dormant Club", active: false });
  const handler = createClaimsHandler({ auth: verifier, db, config: localConfig() });
  const post = (body: Record<string, unknown>) => call(handler, "POST", ENDPOINT, { token: claimant.token, body: draftBody(body) });

  assertStatus(await post({ requestedAmount: (301n * USD).toString() }), 400, "over_face_value");
  assertStatus(await post({ faceValue: (3000n * USD).toString(), requestedAmount: (2501n * USD).toString() }), 400, "over_cap");
  assertStatus(await post({ faceValue: "0" }), 400);
  assertStatus(await post({ faceValue: "1.5" }), 400);
  assertStatus(await post({ orgId: 9 }), 404);
  assertStatus(await post({ orgId: 2 }), 409, "org_inactive");
  assertStatus(await post({ guarantorWallet: claimant.wallet }), 400, "self_guaranty");
  assertStatus(await post({ guarantorWallet: stranger.wallet }), 400, "not_officer");
  assertEquals(db.claims.size, 0);
});

Deno.test("GET shows a claim to its claimant, guarantor, org officers, and staff only", async () => {
  const w = await draftWorld();
  const officer = await makeUser(w.db);
  w.db.officers.set(`1:${officer.wallet}`, { orgId: 1, wallet: officer.wallet, title: null, active: true });
  const staff = await makeUser(w.db, { staff: "attester" });
  const handler = createClaimsHandler({ auth: verifier, db: w.db, config: w.config });

  for (const viewer of [w.claimant, w.guarantor, officer, staff]) {
    const res = await call(handler, "GET", `${ENDPOINT}?id=${w.claim.id}`, { token: viewer.token });
    assertStatus(res, 200);
    assertEquals((res.body.documents as unknown[]).length, 1);
  }
  assertStatus(await call(handler, "GET", `${ENDPOINT}?id=${w.claim.id}`, { token: w.outsider.token }), 404);

  const mine = await call(handler, "GET", ENDPOINT, { token: officer.token });
  assertEquals((mine.body.claims as Array<{ id: string }>).map((c) => c.id), [w.claim.id]);
  assertEquals(((await call(handler, "GET", ENDPOINT, { token: w.outsider.token })).body.claims as unknown[]).length, 0);
});

Deno.test("scope=all and scope=reported are staff-only (FR-B11)", async () => {
  const w = await draftWorld();
  const attester = await makeUser(w.db, { staff: "attester" });
  await w.db.updateClaim(w.claim.id, { asucOutcome: "short_paid", asucOutcomeNote: "ASUC paid $300" });
  const handler = createClaimsHandler({ auth: verifier, db: w.db, config: w.config });
  assertStatus(await call(handler, "GET", `${ENDPOINT}?scope=reported`, { token: w.claimant.token }), 403);
  const reported = await call(handler, "GET", `${ENDPOINT}?scope=reported`, { token: attester.token });
  assertEquals((reported.body.claims as Array<{ asucOutcome: string }>).map((c) => c.asucOutcome), ["short_paid"]);
});

Deno.test("PATCH edits a draft for its claimant until the packet is frozen", async () => {
  const w = await draftWorld();
  const handler = createClaimsHandler({ auth: verifier, db: w.db, config: w.config });
  const edit = await call(handler, "PATCH", ENDPOINT, { token: w.claimant.token, body: { id: w.claim.id, description: "Snacks and badges" } });
  assertStatus(edit, 200);
  assertEquals((edit.body.claim as { description: string }).description, "Snacks and badges");

  assertStatus(await call(handler, "PATCH", ENDPOINT, { token: w.guarantor.token, body: { id: w.claim.id, description: "x" } }), 403);
  assertStatus(
    await call(handler, "PATCH", ENDPOINT, { token: w.claimant.token, body: { id: w.claim.id, requestedAmount: (501n * USD).toString() } }),
    400,
    "over_face_value",
  );

  await w.db.updateClaim(w.claim.id, { packetHash: `0x${"11".repeat(32)}`, packetJson: {} });
  assertStatus(await call(handler, "PATCH", ENDPOINT, { token: w.claimant.token, body: { id: w.claim.id, description: "late" } }), 409, "frozen");
});
