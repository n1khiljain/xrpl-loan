import type { NetworkConfig } from "@app/config";
import { assertEquals } from "@std/assert";
import type { Payment, VaultDeposit } from "xrpl";
import { Wallet as XrplWallet } from "xrpl";
import type { Env } from "../_shared/env.ts";
import { assertStatus } from "../_shared/fixtures.ts";
import { FakeLedger } from "../_shared/ledger.ts";
import { FIXED_NOW, MemoryDb, assertRejectsBadTokens, call, makeUser, seedSeries, testConfig, testCustody, verifier } from "../_shared/testing.ts";
import { createVaultHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/vault";
const UNIX = Math.floor(FIXED_NOW.getTime() / 1000);

function operators() {
  const broker = XrplWallet.generate();
  const issuer = XrplWallet.generate();
  if (!broker.seed || !issuer.seed) throw new Error("wallet had no seed");
  return { broker, issuer, brokerSeed: broker.seed, issuerSeed: issuer.seed };
}

function readyConfig(broker: string, issuer: string, standIn = true): NetworkConfig {
  const base = testConfig();
  return {
    ...base,
    asset: { ...base.asset, issuer: issuer as `r${string}`, standIn },
    ledger: {
      broker: broker as `r${string}`,
      credentialIssuer: broker as `r${string}`,
      credentialType: "496E7374616C6C",
      domainId: "A".repeat(64),
      repaymentAccount: broker as `r${string}`,
    },
  };
}

const LENDING = "1".repeat(64);
const DEPOSITS = "2".repeat(64);
const PAYOUT = "3".repeat(64);

/** A lender with 5,000 RLUSD and three series: one lending, one taking deposits, one paying out. */
async function world() {
  const ops = operators();
  const db = new MemoryDb();
  const user = await makeUser(db, { kyc: "approved" });
  const config = readyConfig(ops.broker.address, ops.issuer.address);
  const ledger = new FakeLedger();
  ledger.balanceOf.set(user.wallet, { exists: true, xrpDrops: "100000000", asset: "5000000000" });
  seedSeries(ledger, config, [
    { vaultId: LENDING, subscriptionAt: UNIX - 10, redemptionAt: UNIX + 365 * 86_400, assetsTotal: "1000", assetsAvailable: "400", debtTotal: "600", shareMptId: "S1" },
    { vaultId: DEPOSITS, subscriptionAt: UNIX + 86_400, redemptionAt: UNIX + 400 * 86_400, assetsTotal: "0", shareMptId: "S2" },
    { vaultId: PAYOUT, subscriptionAt: UNIX - 300 * 86_400, redemptionAt: UNIX - 10, assetsTotal: "500", shareMptId: "S3" },
  ]);
  // the lender holds a quarter of the lending series' shares and half of the paying-out one's
  ledger.shares.set("S1", "4000").set(`S1:${user.wallet}`, "1000").set("S3", "1000").set(`S3:${user.wallet}`, "500");
  const env: Env = { get: (name) => (name === "BROKER_SEED" ? ops.brokerSeed : name === "ISSUER_SEED" ? ops.issuerSeed : undefined) };
  const handler = createVaultHandler({ auth: verifier, db, ledger, custody: testCustody(db), config, env, now: () => FIXED_NOW });
  return { db, user, config, ledger, handler };
}

type SeriesBody = { vaultId: string; phase: string; assetsTotal: string; yourValue: string; debtTotal: string };

Deno.test("vault rejects requests without a valid Privy token", async () => {
  const ops = operators();
  const db = new MemoryDb();
  const handler = createVaultHandler({
    auth: verifier,
    db,
    ledger: new FakeLedger(),
    custody: testCustody(db),
    config: readyConfig(ops.broker.address, ops.issuer.address),
    env: { get: () => undefined },
  });
  await assertRejectsBadTokens(handler, ENDPOINT, ["GET", "POST"]);
});

Deno.test("GET lists every series with its phase, the lender's share, and totals with interest", async () => {
  const w = await world();
  // one loan closed out with 10 of interest, one open with 15 still due, one defaulted (counted, no interest)
  const borrower = await makeUser(w.db, { kyc: "approved" });
  const loan = async (reference: string, patch: Record<string, unknown>) => {
    const r = await w.db.insertReceivable({
      type: "invoice", recipientWallet: borrower.wallet, payerName: "Acme", payerEmail: null, payerWallet: null, dueDate: "2026-12-01",
      orgId: null, faceValue: "500000000", requestedAmount: "500000000", reference, description: null, guarantorWallet: null,
    });
    await w.db.updateReceivable(r.id, { approvedAmount: "500000000", loanId: "E".repeat(63) + reference.slice(-1), ...patch });
  };
  await loan("L1", { status: "Settled", purchasePrice: "100000000", amountDue: "110000000", amountPaid: "110000000" });
  await loan("L2", { status: "Funded", purchasePrice: "200000000", amountDue: "215000000", amountPaid: "0", impairedAt: FIXED_NOW.toISOString() });
  await loan("L3", { status: "WrittenOff", purchasePrice: "50000000", amountDue: "52000000", amountPaid: "0", defaultedAt: FIXED_NOW.toISOString() });

  const viewed = await call(w.handler, "GET", ENDPOINT, { token: w.user.token });
  assertStatus(viewed, 200);
  const series = viewed.body.series as SeriesBody[];
  assertEquals(series.map((s) => [s.vaultId, s.phase]), [[PAYOUT, "closed"], [LENDING, "lending"], [DEPOSITS, "subscription"]]);
  assertEquals(series.find((s) => s.vaultId === LENDING)?.yourValue, "250000000");
  assertEquals(series.find((s) => s.vaultId === PAYOUT)?.yourValue, "250000000");
  assertEquals(series.find((s) => s.vaultId === DEPOSITS)?.yourValue, "0");
  assertEquals(viewed.body.balance, "5000000000");
  assertEquals(viewed.body.totals, {
    assetsTotal: "1500000000",
    assetsAvailable: "900000000",
    debtTotal: "600000000",
    coverAvailable: "15000000000",
    lossUnrealized: "0",
    interestEarned: "10000000",
    interestExpected: "15000000",
    loansOutstanding: 1,
    loansImpaired: 1,
    loansDefaulted: 1,
  });
});

Deno.test("deposits go to the series taking deposits, or the one named, never a lending series", async () => {
  const w = await world();
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.user.token, body: { action: "deposit", amount: "1000000000" } }), 200);
  const deposit = w.ledger.submitted.find((entry) => entry.tx.TransactionType === "VaultDeposit")?.tx as VaultDeposit | undefined;
  assertEquals(deposit?.VaultID, DEPOSITS);
  assertEquals(deposit?.Amount, { currency: w.config.asset.currency, issuer: w.config.asset.issuer ?? "", value: "1000" });

  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.user.token, body: { action: "deposit", amount: "1000000", vaultId: DEPOSITS } }), 200);
  const before = w.ledger.submitted.length;
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.user.token, body: { action: "deposit", amount: "1000000", vaultId: LENDING } }), 409, "vault_phase");
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.user.token, body: { action: "deposit", amount: "1000000", vaultId: "9".repeat(64) } }), 409, "no_series");
  assertEquals(w.ledger.submitted.length, before);
});

Deno.test("with no series taking deposits, a deposit is refused", async () => {
  const w = await world();
  w.ledger.owned.clear();
  seedSeries(w.ledger, w.config, [{ vaultId: LENDING, subscriptionAt: UNIX - 10, redemptionAt: UNIX + 365 * 86_400, assetsTotal: "1000" }]);
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.user.token, body: { action: "deposit", amount: "1000000" } }), 409, "no_series");
});

Deno.test("withdrawals name a series, and wait until it pays out", async () => {
  const w = await world();
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.user.token, body: { action: "withdraw", amount: "1000000" } }), 409, "no_series");
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.user.token, body: { action: "withdraw", amount: "1000000", vaultId: LENDING } }), 409, "vault_phase");
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.user.token, body: { action: "withdraw", amount: "1000000", vaultId: PAYOUT } }), 200);
  const withdrawal = w.ledger.submitted.find((entry) => entry.tx.TransactionType === "VaultWithdraw")?.tx as { VaultID: string } | undefined;
  assertEquals(withdrawal?.VaultID, PAYOUT);
});

Deno.test("an empty wallet is told to get test RLUSD, and can draw it", async () => {
  const w = await world();
  w.ledger.balanceOf.set(w.user.wallet, { exists: true, xrpDrops: "100000000", asset: "0" });
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.user.token, body: { action: "deposit", amount: "1000000" } }), 409, "insufficient_funds");
  const drawn = await call(w.handler, "POST", ENDPOINT, { token: w.user.token, body: { action: "draw" } });
  assertStatus(drawn, 200);
  const payment = w.ledger.submitted.find((entry) => entry.tx.TransactionType === "Payment")?.tx as Payment | undefined;
  assertEquals(payment?.Destination, w.user.wallet);
  assertEquals(payment?.Amount, { currency: w.config.asset.currency, issuer: w.config.asset.issuer ?? "", value: "1000" });
});

Deno.test("test RLUSD is refused for a real asset, and an unverified person can't deposit", async () => {
  const ops = operators();
  const db = new MemoryDb();
  const user = await makeUser(db, { kyc: "approved" });
  const env: Env = { get: (name) => (name === "BROKER_SEED" ? ops.brokerSeed : name === "ISSUER_SEED" ? ops.issuerSeed : undefined) };
  const handler = createVaultHandler({
    auth: verifier,
    db,
    ledger: new FakeLedger(),
    custody: testCustody(db),
    config: readyConfig(ops.broker.address, ops.issuer.address, false),
    env,
    now: () => FIXED_NOW,
  });
  assertStatus(await call(handler, "POST", ENDPOINT, { token: user.token, body: { action: "draw" } }), 403);

  const pendingDb = new MemoryDb();
  const person = await makeUser(pendingDb, { kyc: "pending" });
  const blocked = createVaultHandler({
    auth: verifier,
    db: pendingDb,
    ledger: new FakeLedger(),
    custody: testCustody(pendingDb),
    config: readyConfig(ops.broker.address, ops.issuer.address),
    env,
    now: () => FIXED_NOW,
  });
  assertStatus(await call(blocked, "POST", ENDPOINT, { token: person.token, body: { action: "deposit", amount: "1" } }), 409, "kyc_required");
});
