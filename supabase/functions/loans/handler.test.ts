import { amountDue, rippleTime, unitsToValue } from "@app/adapters";
import type { NetworkConfig } from "@app/config";
import { assertEquals } from "@std/assert";
import { type LoanManage, LoanManageFlags, type LoanPay, type LoanSet } from "xrpl";
import { Wallet as XrplWallet } from "xrpl";
import type { Env } from "../_shared/env.ts";
import { assertStatus, draftWorld } from "../_shared/fixtures.ts";
import { FakeLedger } from "../_shared/ledger.ts";
import { FIXED_NOW, assertRejectsBadTokens, call, makeUser, seedSeries, testCustody, verifier } from "../_shared/testing.ts";
import { createLoansHandler, loanTermSeconds } from "./handler.ts";

const ENDPOINT = "http://localhost/loans";
const UNIX = Math.floor(FIXED_NOW.getTime() / 1000);
const VAULT = "1".repeat(64);
const LOAN_BROKER = "C".repeat(64);

function operators() {
  const broker = XrplWallet.generate();
  const issuer = XrplWallet.generate();
  if (!broker.seed || !issuer.seed) throw new Error("wallet had no seed");
  return { broker, issuer, brokerSeed: broker.seed, issuerSeed: issuer.seed };
}

function readyConfig(base: NetworkConfig, broker: string, issuer: string): NetworkConfig {
  return {
    ...base,
    asset: { ...base.asset, issuer: issuer as `r${string}` },
    ledger: {
      broker: broker as `r${string}`,
      credentialIssuer: broker as `r${string}`,
      credentialType: "496E7374616C6C",
      domainId: "A".repeat(64),
      repaymentAccount: broker as `r${string}`,
    },
  };
}

function envFor(brokerSeed: string): Env {
  return { get: (name) => (name === "BROKER_SEED" ? brokerSeed : undefined) };
}

async function approvedWorld() {
  const ops = operators();
  const w = await draftWorld();
  const config = readyConfig(w.config, ops.broker.address, ops.issuer.address);
  const ledger = new FakeLedger();
  ledger.balanceOf.set(w.seller.wallet, { exists: true, xrpDrops: "100000000", asset: null });
  seedSeries(ledger, config, [{ vaultId: VAULT, loanBrokerId: LOAN_BROKER, subscriptionAt: UNIX - 10, redemptionAt: UNIX + 365 * 86_400, assetsTotal: "25000" }]);
  await w.db.updateReceivable(w.receivable.id, {
    status: "Approved",
    approvedAmount: "350000000",
    approvalExpiresAt: new Date(FIXED_NOW.getTime() + 86_400_000).toISOString(),
    feeBps: 500,
  });
  const handler = createLoansHandler({
    auth: verifier,
    db: w.db,
    ledger,
    custody: testCustody(w.db),
    config,
    env: envFor(ops.brokerSeed),
    now: () => FIXED_NOW,
  });
  return { ...w, config, ledger, handler, broker: ops.broker };
}

Deno.test("loans rejects requests without a valid Privy token", async () => {
  const w = await draftWorld();
  const ops = operators();
  const handler = createLoansHandler({
    auth: verifier,
    db: w.db,
    ledger: new FakeLedger(),
    custody: testCustody(w.db),
    config: readyConfig(w.config, ops.broker.address, ops.issuer.address),
    env: envFor(ops.brokerSeed),
  });
  await assertRejectsBadTokens(handler, ENDPOINT, ["POST"]);
});

Deno.test("an approved receivable becomes one loan, and paying it settles the receivable", async () => {
  const w = await approvedWorld();
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.outsider.token, body: { action: "fund", receivableId: w.receivable.id } }), 403);
  const funded = await call(w.handler, "POST", ENDPOINT, { token: w.seller.token, body: { action: "fund", receivableId: w.receivable.id } });
  assertStatus(funded, 200);
  const receivable = funded.body.receivable as { status: string; loanId: string; vaultId: string; ledger: { amountDue: string; state: string } };
  assertEquals(receivable.vaultId, VAULT);
  assertEquals((await w.db.getReceivable(w.receivable.id))?.loanBrokerId, LOAN_BROKER);
  // the loan runs to the end of the receivable's due date
  const term = loanTermSeconds(w.receivable.dueDate, FIXED_NOW);
  const due = amountDue(350_000_000n, 500n, term);
  assertEquals([receivable.status, receivable.loanId, receivable.ledger.state, receivable.ledger.amountDue], ["Funded", "D".repeat(64), "Funded", due.toString()]);

  const loan = w.ledger.submitted.find((entry) => entry.tx.TransactionType === "LoanSet")?.tx as LoanSet | undefined;
  assertEquals(loan?.PrincipalRequested, "350");
  assertEquals(loan?.InterestRate, 5_000);
  assertEquals(loan?.LateInterestRate, 0);
  assertEquals(loan?.PaymentTotal, 1);
  assertEquals(loan?.PaymentInterval, term);
  assertEquals(loan?.GracePeriod, Math.min(w.config.params.writeOffGraceSeconds, term));
  assertEquals(loan?.Counterparty, w.broker.address);
  assertEquals(loan?.LoanBrokerID, LOAN_BROKER);
  assertEquals(loan?.Account, w.seller.wallet);
  assertEquals(
    w.ledger.submitted.map((entry) => entry.tx.TransactionType),
    ["TrustSet", "CredentialCreate", "CredentialAccept", "LoanSet"],
  );
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.seller.token, body: { action: "fund", receivableId: w.receivable.id } }), 409, "invalid_state");

  const paid = await call(w.handler, "POST", ENDPOINT, { token: w.seller.token, body: { action: "pay", receivableId: w.receivable.id } });
  assertStatus(paid, 200);
  assertEquals((paid.body.receivable as { status: string }).status, "Settled");
  const payment = w.ledger.submitted.find((entry) => entry.tx.TransactionType === "LoanPay")?.tx as LoanPay | undefined;
  assertEquals(payment?.Amount, { currency: w.config.asset.currency, issuer: w.config.asset.issuer ?? "", value: unitsToValue(due) });
  assertEquals(payment?.Flags, undefined);
});

Deno.test("funding waits for approval, verification, and a series that can lend", async () => {
  const w = await approvedWorld();
  await w.db.updateReceivable(w.receivable.id, { status: "Draft" });
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.seller.token, body: { action: "fund", receivableId: w.receivable.id } }), 409, "invalid_state");

  await w.db.updateReceivable(w.receivable.id, { status: "Approved" });
  await w.db.updateProfile(w.seller.wallet, { kycStatus: "pending" });
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.seller.token, body: { action: "fund", receivableId: w.receivable.id } }), 409, "kyc_required");
  await w.db.updateProfile(w.seller.wallet, { kycStatus: "approved" });

  await w.db.updateReceivable(w.receivable.id, { approvalExpiresAt: FIXED_NOW.toISOString() });
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.seller.token, body: { action: "fund", receivableId: w.receivable.id } }), 409, "approval_expired");
  await w.db.updateReceivable(w.receivable.id, { approvalExpiresAt: new Date(FIXED_NOW.getTime() + 86_400_000).toISOString() });

  // only a series still taking deposits: nothing can lend yet
  w.ledger.owned.clear();
  seedSeries(w.ledger, w.config, [{ vaultId: VAULT, subscriptionAt: UNIX + 86_400, redemptionAt: UNIX + 365 * 86_400, assetsTotal: "25000" }]);
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.seller.token, body: { action: "fund", receivableId: w.receivable.id } }), 409, "no_series");
  // lending, but it pays out before this loan would be due
  w.ledger.owned.clear();
  seedSeries(w.ledger, w.config, [{ vaultId: VAULT, subscriptionAt: UNIX - 10, redemptionAt: UNIX + 86_400, assetsTotal: "25000" }]);
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.seller.token, body: { action: "fund", receivableId: w.receivable.id } }), 409, "no_series");
  // lending for long enough, but without the principal on hand
  w.ledger.owned.clear();
  seedSeries(w.ledger, w.config, [{ vaultId: VAULT, subscriptionAt: UNIX - 10, redemptionAt: UNIX + 365 * 86_400, assetsTotal: "100" }]);
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.seller.token, body: { action: "fund", receivableId: w.receivable.id } }), 409, "no_series");
  assertEquals(w.ledger.submitted.length, 0);
});

Deno.test("the loan term is the time to the end of the due date", () => {
  assertEquals(loanTermSeconds("2026-10-12", new Date("2026-10-11T23:59:59Z")), 86_400);
  assertEquals(loanTermSeconds("2026-10-11", new Date("2026-10-12T00:00:00Z")), 0);
});

Deno.test("a late payment is flagged, and only the borrower can send it", async () => {
  const w = await approvedWorld();
  await w.db.updateReceivable(w.receivable.id, {
    status: "Funded",
    purchasePrice: "350000000",
    amountDue: "360000000",
    amountPaid: "0",
    loanId: "E".repeat(64),
    dueAt: new Date(FIXED_NOW.getTime() - 86_400_000).toISOString(),
  });
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.guarantor.token, body: { action: "pay", receivableId: w.receivable.id } }), 403);
  const paid = await call(w.handler, "POST", ENDPOINT, { token: w.seller.token, body: { action: "pay", receivableId: w.receivable.id } });
  assertStatus(paid, 200);
  const payment = w.ledger.submitted.find((entry) => entry.tx.TransactionType === "LoanPay")?.tx as LoanPay | undefined;
  assertEquals(payment?.Flags, 262_144);
  assertEquals(payment?.LoanID, "E".repeat(64));
});

/** A funded loan on the ledger whose payment was due a day ago, with a 2-day grace period. */
async function lateWorld() {
  const w = await approvedWorld();
  const loanId = "E".repeat(64);
  const due = UNIX - 86_400;
  await w.db.updateReceivable(w.receivable.id, {
    status: "Funded",
    purchasePrice: "350000000",
    amountDue: "360000000",
    amountPaid: "100000000",
    loanId,
    vaultId: VAULT,
    loanBrokerId: LOAN_BROKER,
    dueAt: new Date(due * 1000).toISOString(),
  });
  w.ledger.entries.set(loanId, { LedgerEntryType: "Loan", NextPaymentDueDate: rippleTime(due), GracePeriod: 2 * 86_400 });
  const attester = await makeUser(w.db, { staff: "attester", kyc: "approved" });
  const manage = (token: string, action: string) => call(w.handler, "POST", ENDPOINT, { token, body: { action, receivableId: w.receivable.id } });
  return { ...w, loanId, due, attester, manage };
}

Deno.test("missed payments: only attesters and admins manage a loan", async () => {
  const w = await lateWorld();
  assertStatus(await w.manage(w.seller.token, "impair"), 403);
  assertStatus(await w.manage(w.outsider.token, "default"), 403);
  const admin = await makeUser(w.db, { staff: "admin", kyc: "approved" });
  assertStatus(await w.manage(admin.token, "impair"), 200);
});

Deno.test("missed payments: impair after the due date sends LoanManage and records it; unimpair clears it", async () => {
  const w = await lateWorld();
  assertStatus(await w.manage(w.attester.token, "unimpair"), 409, "not_impaired");
  const impaired = await w.manage(w.attester.token, "impair");
  assertStatus(impaired, 200);
  const tx = w.ledger.submitted.at(-1)?.tx as LoanManage;
  assertEquals([tx.TransactionType, tx.LoanID, tx.Flags, tx.Account], ["LoanManage", w.loanId, LoanManageFlags.tfLoanImpair, w.broker.address]);
  assertEquals((impaired.body.receivable as { impairedAt: string }).impairedAt, FIXED_NOW.toISOString());
  assertStatus(await w.manage(w.attester.token, "impair"), 409, "already_impaired");

  const cleared = await w.manage(w.attester.token, "unimpair");
  assertStatus(cleared, 200);
  assertEquals((w.ledger.submitted.at(-1)?.tx as LoanManage).Flags, LoanManageFlags.tfLoanUnimpair);
  assertEquals((cleared.body.receivable as { impairedAt: string | null }).impairedAt, null);
  assertEquals(w.db.adminActions.map((a) => a.action).slice(-2), ["loan_impair", "loan_unimpair"]);
});

Deno.test("missed payments: nothing can be marked before the due date has passed", async () => {
  const w = await lateWorld();
  w.ledger.entries.set(w.loanId, { NextPaymentDueDate: rippleTime(UNIX + 60), GracePeriod: 0 });
  assertStatus(await w.manage(w.attester.token, "impair"), 409, "too_soon");
  assertStatus(await w.manage(w.attester.token, "default"), 409, "too_soon");
  assertEquals(w.ledger.submitted.length, 0);
});

Deno.test("missed payments: default waits for the grace period, then writes the loan off", async () => {
  const w = await lateWorld();
  assertStatus(await w.manage(w.attester.token, "default"), 409, "too_soon");
  w.ledger.entries.set(w.loanId, { NextPaymentDueDate: rippleTime(w.due), GracePeriod: 3_600 });
  const defaulted = await w.manage(w.attester.token, "default");
  assertStatus(defaulted, 200);
  assertEquals((w.ledger.submitted.at(-1)?.tx as LoanManage).Flags, LoanManageFlags.tfLoanDefault);
  const stored = await w.db.getReceivable(w.receivable.id);
  assertEquals([stored?.status, stored?.defaultedAt, stored?.principalWrittenOff, stored?.writtenOffPrincipal], ["WrittenOff", FIXED_NOW.toISOString(), true, "250000000"]);
  assertStatus(await w.manage(w.attester.token, "impair"), 409, "invalid_state");
});

Deno.test("missed payments: a loan that isn't on the ledger can't be managed", async () => {
  const w = await approvedWorld();
  const attester = await makeUser(w.db, { staff: "attester", kyc: "approved" });
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: attester.token, body: { action: "impair", receivableId: w.receivable.id } }), 409, "no_loan");
});
