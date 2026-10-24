import { assertEquals } from "@std/assert";
import { DUE_DATE, addReceipt, assertStatus, draftWorld } from "../_shared/fixtures.ts";
import { MemoryMailer } from "../_shared/mail.ts";
import { FIXED_NOW, MemoryDb, assertRejectsBadTokens, call, makeUser, testConfig, verifier } from "../_shared/testing.ts";
import { createPacketHandler } from "../packet/handler.ts";
import { createReceivableActionsHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/receivable-actions";
const DAY = 86_400_000;

async function world() {
  const w = await draftWorld();
  await w.db.updateReceivable(w.receivable.id, { packetHash: "a".repeat(64), packetJson: {}, guarantySignedAt: FIXED_NOW.toISOString() });
  const underwriter = await makeUser(w.db, { staff: "underwriter" });
  const attester = await makeUser(w.db, { staff: "attester" });
  const mailer = new MemoryMailer();
  let now = FIXED_NOW;
  const handler = createReceivableActionsHandler({ auth: verifier, db: w.db, config: w.config, mailer, appBaseUrl: "http://app", now: () => now });
  const act = (token: string, body: Record<string, unknown>) => call(handler, "POST", ENDPOINT, { token, body: { receivableId: w.receivable.id, ...body } });
  return { ...w, underwriter, attester, mailer, act, setNow: (d: Date) => (now = d) };
}

Deno.test("receivable-actions rejects requests without a valid Privy token", async () => {
  const handler = createReceivableActionsHandler({ auth: verifier, db: new MemoryDb(), config: testConfig(), mailer: new MemoryMailer(), appBaseUrl: "http://x" });
  await assertRejectsBadTokens(handler, ENDPOINT, ["POST"]);
});

Deno.test("the seller submits a signed-off draft, and an underwriter approves it with an expiry and an email", async () => {
  const w = await world();
  assertStatus(await w.act(w.guarantor.token, { action: "submit" }), 403);
  const submitted = await w.act(w.seller.token, { action: "submit" });
  assertStatus(submitted, 200);
  assertEquals((submitted.body.receivable as { status: string }).status, "Submitted");
  assertStatus(await w.act(w.seller.token, { action: "submit" }), 409, "invalid_state");

  assertStatus(await w.act(w.attester.token, { action: "approve", amount: "400000000" }), 403);
  assertStatus(await w.act(w.underwriter.token, { action: "approve", amount: "400000001" }), 400, "over_requested");
  const approved = await w.act(w.underwriter.token, { action: "approve", amount: "350000000" });
  assertStatus(approved, 200);
  const ledger = (approved.body.receivable as { ledger: Record<string, unknown> }).ledger;
  assertEquals([ledger.state, ledger.approvedAmount], ["Approved", "350000000"]);
  assertEquals(ledger.approvalExpiresAt, FIXED_NOW.getTime() / 1000 + w.config.params.approvalExpirySeconds);
  assertEquals(w.mailer.sent.map((m) => m.subject), ["Your loan was approved"]);
  assertEquals(w.db.adminActions.at(-1)?.action, "approve");
});

Deno.test("submit needs a frozen packet, and the officer's sign-off when there's an officer", async () => {
  const w = await draftWorld();
  const handler = createReceivableActionsHandler({ auth: verifier, db: w.db, config: w.config, mailer: new MemoryMailer(), appBaseUrl: "http://x" });
  const submit = () => call(handler, "POST", ENDPOINT, { token: w.seller.token, body: { action: "submit", receivableId: w.receivable.id } });
  assertStatus(await submit(), 409, "not_frozen");
  await w.db.updateReceivable(w.receivable.id, { packetHash: "b".repeat(64), packetJson: {} });
  assertStatus(await submit(), 409, "not_signed");
});

Deno.test("a receivable without a guarantor goes from packet straight to Submitted", async () => {
  const w = await draftWorld();
  const invoice = await w.db.insertReceivable({
    type: "invoice",
    recipientWallet: w.seller.wallet,
    payerName: "Acme Supply Co.",
    payerEmail: null,
    payerWallet: null,
    dueDate: DUE_DATE,
    orgId: null,
    faceValue: "900000000",
    requestedAmount: "800000000",
    reference: "INV-77",
    description: null,
    guarantorWallet: null,
  });
  await addReceipt(w.db, w.storage, invoice, w.seller, "invoice pdf");
  const packet = createPacketHandler({ auth: verifier, db: w.db });
  assertStatus(await call(packet, "POST", "http://localhost/packet", { token: w.seller.token, body: { receivableId: invoice.id } }), 200);
  const handler = createReceivableActionsHandler({ auth: verifier, db: w.db, config: w.config, mailer: new MemoryMailer(), appBaseUrl: "http://x" });
  const res = await call(handler, "POST", ENDPOINT, { token: w.seller.token, body: { action: "submit", receivableId: invoice.id } });
  assertStatus(res, 200);
  assertEquals((res.body.receivable as { status: string }).status, "Submitted");
});

Deno.test("underwriters can't approve their own receivable or one from an unverified seller", async () => {
  const w = await world();
  await w.act(w.seller.token, { action: "submit" });
  w.db.staff.set(w.seller.wallet, "underwriter");
  assertStatus(await w.act(w.seller.token, { action: "approve", amount: "1" }), 409, "self_approval");
  w.db.staff.delete(w.seller.wallet);
  await w.db.updateProfile(w.seller.wallet, { kycStatus: "rejected" });
  assertStatus(await w.act(w.underwriter.token, { action: "approve", amount: "1" }), 409, "kyc_required");
});

Deno.test("reject records the reason; the seller can cancel before it's paid", async () => {
  const w = await world();
  await w.act(w.seller.token, { action: "submit" });
  const rejected = await w.act(w.underwriter.token, { action: "reject", reason: "receipt_unreadable" });
  assertEquals((rejected.body.receivable as { status: string; rejectReason: string }).rejectReason, "receipt_unreadable");
  assertStatus(await w.act(w.seller.token, { action: "cancel" }), 409, "invalid_state");

  const v = await world();
  await v.act(v.seller.token, { action: "submit" });
  assertEquals(((await v.act(v.seller.token, { action: "cancel" })).body.receivable as { status: string }).status, "Cancelled");
});

Deno.test("a paid receivable can be reported, the guarantor called, and after the grace period written off", async () => {
  const w = await world();
  await w.db.updateReceivable(w.receivable.id, {
    status: "Funded",
    purchasePrice: "400000000",
    amountDue: "400000000",
    amountPaid: "100000000",
    dueAt: new Date(FIXED_NOW.getTime() + 30 * DAY).toISOString(),
  });
  assertStatus(await w.act(w.guarantor.token, { action: "report-outcome", outcome: "rejected" }), 403);
  const reported = await w.act(w.seller.token, { action: "report-outcome", outcome: "short_paid", note: "paid $100" });
  assertEquals((reported.body.receivable as { payerOutcome: string }).payerOutcome, "short_paid");

  assertStatus(await w.act(w.underwriter.token, { action: "call-guarantor", reason: "partial_shortfall" }), 403);
  assertStatus(await w.act(w.attester.token, { action: "call-guarantor", reason: "overdue" }), 409, "not_overdue");
  const called = await w.act(w.attester.token, { action: "call-guarantor", reason: "partial_shortfall" });
  const ledger = (called.body.receivable as { ledger: Record<string, unknown> }).ledger;
  assertEquals([ledger.state, ledger.callReason, ledger.amountRemaining], ["GuarantorCalled", "PartialShortfall", "300000000"]);

  assertStatus(await w.act(w.attester.token, { action: "write-off" }), 409, "too_early");
  w.setNow(new Date(FIXED_NOW.getTime() + w.config.params.writeOffGraceSeconds * 1000));
  const written = await w.act(w.attester.token, { action: "write-off" });
  const after = (written.body.receivable as { ledger: Record<string, unknown> }).ledger;
  assertEquals([after.state, after.principalWrittenOff, after.writtenOffPrincipal], ["WrittenOff", true, "300000000"]);
});

Deno.test("two approvals racing apply once", async () => {
  const w = await world();
  await w.act(w.seller.token, { action: "submit" });
  const [a, b] = await Promise.all([
    w.act(w.underwriter.token, { action: "approve", amount: "400000000" }),
    w.act(w.underwriter.token, { action: "approve", amount: "400000000" }),
  ]);
  assertEquals([a.status, b.status].sort(), [200, 409]);
  assertEquals(w.mailer.sent.length, 1);
});
