import { assertEquals } from "@std/assert";
import { DUE_DATE, assertStatus, draftWorld } from "../_shared/fixtures.ts";
import { FIXED_NOW, MemoryDb, assertRejectsBadTokens, call, makeUser, seedOrg, testConfig, verifier } from "../_shared/testing.ts";
import { createReceivablesHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/receivables";
const USD = 10n ** 6n;

/** A club reimbursement for org 1. */
function draftBody(overrides: Record<string, unknown> = {}) {
  return {
    type: "reimbursement",
    payerName: "ASUC",
    dueDate: DUE_DATE,
    orgId: 1,
    faceValue: (300n * USD).toString(),
    requestedAmount: (300n * USD).toString(),
    reference: "PR-100",
    ...overrides,
  };
}

/** An invoice to a customer: no org, no guarantor. */
function invoiceBody(overrides: Record<string, unknown> = {}) {
  return {
    type: "invoice",
    payerName: "Acme Supply Co.",
    payerEmail: "ap@acme.example",
    dueDate: DUE_DATE,
    faceValue: (1200n * USD).toString(),
    requestedAmount: (1000n * USD).toString(),
    reference: "INV-1042",
    ...overrides,
  };
}

const handlerFor = (db: MemoryDb) => createReceivablesHandler({ auth: verifier, db, config: testConfig(), now: () => FIXED_NOW });

Deno.test("receivables rejects requests without a valid Privy token", async () => {
  const db = new MemoryDb();
  await assertRejectsBadTokens(handlerFor(db), ENDPOINT, ["GET", "POST", "PATCH"]);
  assertEquals(db.receivables.size, 0);
});

Deno.test("POST creates a draft for the caller; the same reference can't be sold twice by one seller", async () => {
  const db = new MemoryDb();
  const seller = await makeUser(db, { kyc: "approved" });
  const officer = await makeUser(db);
  seedOrg(db, 1, "Blockchain at Berkeley", [officer.wallet]);
  const handler = handlerFor(db);

  const created = await call(handler, "POST", ENDPOINT, { token: seller.token, body: draftBody({ guarantorWallet: officer.wallet }) });
  assertStatus(created, 201);
  const receivable = created.body.receivable as { recipientWallet: string; status: string; guarantorWallet: string };
  assertEquals([receivable.recipientWallet, receivable.status, receivable.guarantorWallet], [seller.wallet, "Draft", officer.wallet]);

  const dupe = await call(handler, "POST", ENDPOINT, { token: seller.token, body: draftBody() });
  assertStatus(dupe, 409, "duplicate_reference");
});

Deno.test("POST needs the seller verified first, whatever else is wrong", async () => {
  const db = new MemoryDb();
  const officer = await makeUser(db);
  seedOrg(db, 1, "Blockchain at Berkeley", [officer.wallet]);
  const handler = handlerFor(db);
  for (const kyc of [undefined, "pending", "rejected"] as const) {
    const member = await makeUser(db, kyc ? { kyc } : {});
    const res = await call(handler, "POST", ENDPOINT, { token: member.token, body: draftBody({ guarantorWallet: officer.wallet }) });
    assertStatus(res, 403, "kyc_required");
  }
  assertEquals(db.receivables.size, 0);
});

Deno.test("POST enforces amounts, the per-receivable cap, org state, and guarantor rules", async () => {
  const db = new MemoryDb();
  const seller = await makeUser(db, { kyc: "approved" });
  const stranger = await makeUser(db);
  seedOrg(db, 1, "Blockchain at Berkeley", [seller.wallet]);
  db.orgs.set(2, { id: 2, name: "Dormant Club", active: false, joinCode: "DORMANT2" });
  const handler = handlerFor(db);
  const post = (body: Record<string, unknown>) => call(handler, "POST", ENDPOINT, { token: seller.token, body: draftBody(body) });

  assertStatus(await post({ requestedAmount: (301n * USD).toString() }), 400, "over_face_value");
  assertStatus(await post({ faceValue: (3000n * USD).toString(), requestedAmount: (2501n * USD).toString() }), 400, "over_cap");
  assertStatus(await post({ faceValue: "0" }), 400);
  assertStatus(await post({ faceValue: "1.5" }), 400);
  assertStatus(await post({ orgId: 9 }), 404);
  assertStatus(await post({ orgId: 2 }), 409, "org_inactive");
  assertStatus(await post({ guarantorWallet: seller.wallet }), 400, "self_guaranty");
  assertStatus(await post({ guarantorWallet: stranger.wallet }), 400, "not_officer");
  assertEquals(db.receivables.size, 0);
});

Deno.test("GET shows a receivable to its seller, guarantor, org officers, and staff only", async () => {
  const w = await draftWorld();
  const officer = await makeUser(w.db);
  w.db.officers.set(`1:${officer.wallet}`, { orgId: 1, wallet: officer.wallet, title: null, active: true });
  const staff = await makeUser(w.db, { staff: "attester" });
  const handler = handlerFor(w.db);

  for (const viewer of [w.seller, w.guarantor, officer, staff]) {
    const res = await call(handler, "GET", `${ENDPOINT}?id=${w.receivable.id}`, { token: viewer.token });
    assertStatus(res, 200);
    assertEquals((res.body.documents as unknown[]).length, 1);
  }
  assertStatus(await call(handler, "GET", `${ENDPOINT}?id=${w.receivable.id}`, { token: w.outsider.token }), 404);

  const mine = await call(handler, "GET", ENDPOINT, { token: officer.token });
  assertEquals((mine.body.receivables as Array<{ id: string }>).map((c) => c.id), [w.receivable.id]);
  assertEquals(((await call(handler, "GET", ENDPOINT, { token: w.outsider.token })).body.receivables as unknown[]).length, 0);
});

Deno.test("scope=all and scope=reported are staff-only", async () => {
  const w = await draftWorld();
  const attester = await makeUser(w.db, { staff: "attester" });
  await w.db.updateReceivable(w.receivable.id, { payerOutcome: "short_paid", payerOutcomeNote: "the payer sent $300" });
  const handler = handlerFor(w.db);
  assertStatus(await call(handler, "GET", `${ENDPOINT}?scope=reported`, { token: w.seller.token }), 403);
  const reported = await call(handler, "GET", `${ENDPOINT}?scope=reported`, { token: attester.token });
  assertEquals((reported.body.receivables as Array<{ payerOutcome: string }>).map((c) => c.payerOutcome), ["short_paid"]);
});

Deno.test("PATCH edits a draft for its seller until the packet is frozen", async () => {
  const w = await draftWorld();
  const handler = handlerFor(w.db);
  const edit = await call(handler, "PATCH", ENDPOINT, { token: w.seller.token, body: { id: w.receivable.id, description: "Snacks and badges" } });
  assertStatus(edit, 200);
  assertEquals((edit.body.receivable as { description: string }).description, "Snacks and badges");

  assertStatus(await call(handler, "PATCH", ENDPOINT, { token: w.guarantor.token, body: { id: w.receivable.id, description: "x" } }), 403);
  assertStatus(
    await call(handler, "PATCH", ENDPOINT, { token: w.seller.token, body: { id: w.receivable.id, requestedAmount: (501n * USD).toString() } }),
    400,
    "over_face_value",
  );

  await w.db.updateReceivable(w.receivable.id, { packetHash: "11".repeat(32), packetJson: {} });
  assertStatus(await call(handler, "PATCH", ENDPOINT, { token: w.seller.token, body: { id: w.receivable.id, description: "late" } }), 409, "frozen");
});

Deno.test("POST makes an invoice with no org and no guarantor, with the payer and due date", async () => {
  const db = new MemoryDb(() => FIXED_NOW);
  const seller = await makeUser(db, { kyc: "approved" });
  const created = await call(handlerFor(db), "POST", ENDPOINT, { token: seller.token, body: invoiceBody() });
  assertStatus(created, 201);
  const r = created.body.receivable as Record<string, unknown>;
  assertEquals(
    [r.type, r.payerName, r.payerEmail, r.dueDate, r.orgId, r.guarantorWallet, r.reference],
    ["invoice", "Acme Supply Co.", "ap@acme.example", DUE_DATE, null, null, "INV-1042"],
  );
});

Deno.test("POST refuses a guarantor on a receivable without an org", async () => {
  const db = new MemoryDb(() => FIXED_NOW);
  const seller = await makeUser(db, { kyc: "approved" });
  const officer = await makeUser(db);
  seedOrg(db, 1, "Blockchain at Berkeley", [officer.wallet]);
  const res = await call(handlerFor(db), "POST", ENDPOINT, { token: seller.token, body: invoiceBody({ guarantorWallet: officer.wallet }) });
  assertStatus(res, 400, "guarantor_without_org");
  assertEquals(db.receivables.size, 0);
});

Deno.test("POST wants a due date after today and within the longest term", async () => {
  const db = new MemoryDb(() => FIXED_NOW);
  const seller = await makeUser(db, { kyc: "approved" });
  const handler = handlerFor(db);
  const post = (dueDate: string) => call(handler, "POST", ENDPOINT, { token: seller.token, body: invoiceBody({ dueDate }) });
  assertStatus(await post("2026-10-01"), 400, "due_in_past");
  assertStatus(await post("2026-10-11"), 400, "due_in_past");
  assertStatus(await post("2027-06-01"), 400, "due_too_far");
  assertStatus(await post("not-a-date"), 400);
  assertStatus(await post("2026-10-12"), 201);
});

Deno.test("a reference is unique per seller, but another seller can use the same one", async () => {
  const db = new MemoryDb(() => FIXED_NOW);
  const one = await makeUser(db, { kyc: "approved" });
  const two = await makeUser(db, { kyc: "approved" });
  const handler = handlerFor(db);
  assertStatus(await call(handler, "POST", ENDPOINT, { token: one.token, body: invoiceBody() }), 201);
  assertStatus(await call(handler, "POST", ENDPOINT, { token: one.token, body: invoiceBody() }), 409, "duplicate_reference");
  assertStatus(await call(handler, "POST", ENDPOINT, { token: two.token, body: invoiceBody() }), 201);
});

Deno.test("a finance agent sees a teammate's request that is waiting on finance", async () => {
  const w = await draftWorld();
  const stranger = await makeUser(w.db);
  await w.db.updateReceivable(w.receivable.id, { status: "FinanceReview", guarantorWallet: null, submittedAt: FIXED_NOW.toISOString() });
  await w.db.insertMember({ orgId: 1, wallet: w.seller.wallet, financeAgent: false, roleTitle: "Buyer" });
  await w.db.insertMember({ orgId: 1, wallet: w.outsider.wallet, financeAgent: true, roleTitle: null });
  const handler = handlerFor(w.db);
  const list = await call(handler, "GET", ENDPOINT, { token: w.outsider.token });
  assertEquals((list.body.receivables as Array<{ id: string }>).some((c) => c.id === w.receivable.id), true);
  assertEquals((await call(handler, "GET", ENDPOINT, { token: stranger.token })).body.receivables, []);
  assertStatus(await call(handler, "GET", `${ENDPOINT}?id=${w.receivable.id}`, { token: w.outsider.token }), 200);
  assertStatus(await call(handler, "GET", `${ENDPOINT}?id=${w.receivable.id}`, { token: stranger.token }), 404);
});

Deno.test("POST refuses the seller as their own payer", async () => {
  const db = new MemoryDb(() => FIXED_NOW);
  const seller = await makeUser(db, { kyc: "approved" });
  const res = await call(handlerFor(db), "POST", ENDPOINT, { token: seller.token, body: invoiceBody({ payerWallet: seller.wallet }) });
  assertStatus(res, 400, "self_payer");
});
