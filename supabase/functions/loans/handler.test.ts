import { amountDue, rippleTime, unitsToValue } from "@app/adapters";
import type { NetworkConfig } from "@app/config";
import { assertEquals } from "@std/assert";
import type { LoanPay, LoanSet } from "xrpl";
import { Wallet as XrplWallet } from "xrpl";
import type { Env } from "../_shared/env.ts";
import { assertStatus, draftWorld } from "../_shared/fixtures.ts";
import { FakeLedger } from "../_shared/ledger.ts";
import { FIXED_NOW, assertRejectsBadTokens, call, testCustody, verifier } from "../_shared/testing.ts";
import { createLoansHandler, loanTermSeconds } from "./handler.ts";

const ENDPOINT = "http://localhost/loans";
const UNIX = Math.floor(FIXED_NOW.getTime() / 1000);

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
      vaultId: "B".repeat(64),
      loanBrokerId: "C".repeat(64),
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
  ledger.entries.set("B".repeat(64), {
    SubscriptionDate: rippleTime(UNIX - 10),
    RedemptionDate: rippleTime(UNIX + 365 * 24 * 60 * 60),
  });
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
  const receivable = funded.body.receivable as { status: string; loanId: string; ledger: { amountDue: string; state: string } };
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

Deno.test("funding waits for approval, verification, and the lending window", async () => {
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

  w.ledger.entries.set("B".repeat(64), {
    SubscriptionDate: rippleTime(UNIX + 86_400),
    RedemptionDate: rippleTime(UNIX + 365 * 24 * 60 * 60),
  });
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.seller.token, body: { action: "fund", receivableId: w.receivable.id } }), 409, "vault_phase");
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
