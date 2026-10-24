import { rippleTime } from "@app/adapters";
import type { NetworkConfig } from "@app/config";
import { assertEquals } from "@std/assert";
import type { Payment, VaultDeposit } from "xrpl";
import { Wallet as XrplWallet } from "xrpl";
import type { Env } from "../_shared/env.ts";
import { assertStatus } from "../_shared/fixtures.ts";
import { FakeLedger } from "../_shared/ledger.ts";
import { FIXED_NOW, MemoryDb, assertRejectsBadTokens, call, makeUser, testConfig, testCustody, verifier } from "../_shared/testing.ts";
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
      vaultId: "B".repeat(64),
      loanBrokerId: "C".repeat(64),
      repaymentAccount: broker as `r${string}`,
    },
  };
}

async function world(phase: "subscription" | "lending") {
  const ops = operators();
  const db = new MemoryDb();
  const user = await makeUser(db, { kyc: "approved" });
  const config = readyConfig(ops.broker.address, ops.issuer.address);
  const ledger = new FakeLedger();
  ledger.balanceOf.set(user.wallet, { exists: true, xrpDrops: "100000000", asset: "5000000000" });
  const subscription = phase === "subscription" ? UNIX + 86_400 : UNIX - 10;
  ledger.entries.set("B".repeat(64), {
    SubscriptionDate: rippleTime(subscription),
    RedemptionDate: rippleTime(UNIX + 365 * 24 * 60 * 60),
    AssetsTotal: "1000",
    AssetsAvailable: "1000",
  });
  const env: Env = { get: (name) => (name === "BROKER_SEED" ? ops.brokerSeed : name === "ISSUER_SEED" ? ops.issuerSeed : undefined) };
  const handler = createVaultHandler({ auth: verifier, db, ledger, custody: testCustody(db), config, env, now: () => FIXED_NOW });
  return { user, config, ledger, handler };
}

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

Deno.test("a verified lender can see the vault, deposit while subscriptions are open, and withdraw", async () => {
  const w = await world("subscription");
  const viewed = await call(w.handler, "GET", ENDPOINT, { token: w.user.token });
  assertStatus(viewed, 200);
  assertEquals(viewed.body.phase, "subscription");
  assertEquals(viewed.body.balance, "5000000000");
  assertEquals(viewed.body.assetsTotal, "1000000000");

  const deposited = await call(w.handler, "POST", ENDPOINT, { token: w.user.token, body: { action: "deposit", amount: "1000000000" } });
  assertStatus(deposited, 200);
  const deposit = w.ledger.submitted.find((entry) => entry.tx.TransactionType === "VaultDeposit")?.tx as VaultDeposit | undefined;
  assertEquals(deposit?.VaultID, "B".repeat(64));
  assertEquals(deposit?.Amount, { currency: w.config.asset.currency, issuer: w.config.asset.issuer ?? "", value: "1000" });

  const withdrawn = await call(w.handler, "POST", ENDPOINT, { token: w.user.token, body: { action: "withdraw", amount: "1000000" } });
  assertStatus(withdrawn, 200);
  assertEquals(w.ledger.submitted.some((entry) => entry.tx.TransactionType === "VaultWithdraw"), true);
});

Deno.test("deposits close once the subscription window ends, and an empty wallet is told to get test RLUSD", async () => {
  const w = await world("lending");
  assertStatus(
    await call(w.handler, "POST", ENDPOINT, { token: w.user.token, body: { action: "deposit", amount: "1000000" } }),
    409,
    "vault_phase",
  );
  assertEquals(w.ledger.submitted.length, 0);

  const open = await world("subscription");
  open.ledger.balanceOf.set(open.user.wallet, { exists: true, xrpDrops: "100000000", asset: "0" });
  assertStatus(
    await call(open.handler, "POST", ENDPOINT, { token: open.user.token, body: { action: "deposit", amount: "1000000" } }),
    409,
    "insufficient_funds",
  );

  const drawn = await call(open.handler, "POST", ENDPOINT, { token: open.user.token, body: { action: "draw" } });
  assertStatus(drawn, 200);
  const payment = open.ledger.submitted.find((entry) => entry.tx.TransactionType === "Payment")?.tx as Payment | undefined;
  assertEquals(payment?.Destination, open.user.wallet);
  assertEquals(payment?.Amount, { currency: open.config.asset.currency, issuer: open.config.asset.issuer ?? "", value: "1000" });
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
