import { assertEquals } from "@std/assert";
import { FakeLedger, MemoryDb, assertRejectsBadTokens, call, makeUser, testConfig, verifier } from "../_shared/testing.ts";
import { createWalletHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/wallet";

Deno.test("wallet rejects requests without a valid Privy token", async () => {
  await assertRejectsBadTokens(createWalletHandler({ auth: verifier, db: new MemoryDb(), ledger: new FakeLedger(), config: testConfig() }), ENDPOINT, ["GET"]);
});

Deno.test("wallet shows the caller's own balances and transactions with explorer links", async () => {
  const db = new MemoryDb();
  const ledger = new FakeLedger();
  const user = await makeUser(db);
  const other = await makeUser(db);
  ledger.balanceOf.set(user.wallet, { exists: true, xrpDrops: "99000000", asset: "1500000" });
  await db.recordLedgerTx({ txHash: "A".repeat(64), txType: "Payment", account: user.wallet, receivableId: null, purpose: "fund_wallet", result: "faucet" });
  await db.recordLedgerTx({ txHash: "B".repeat(64), txType: "Payment", account: other.wallet, receivableId: null, purpose: "fund_wallet", result: "faucet" });

  const res = await call(createWalletHandler({ auth: verifier, db, ledger, config: testConfig() }), "GET", ENDPOINT, { token: user.token });
  assertEquals(res.status, 200);
  assertEquals([res.body.address, res.body.xrpDrops, res.body.assetUnits, res.body.assetCode, res.body.exists], [user.wallet, "99000000", "1500000", "RLUSD", true]);
  assertEquals(res.body.explorerUrl, `https://devnet.xrpl.org/accounts/${user.wallet}`);
  const txs = res.body.transactions as Array<{ txHash: string; explorerUrl: string }>;
  assertEquals(txs.map((t) => t.explorerUrl), [`https://devnet.xrpl.org/transactions/${"A".repeat(64)}`]);
});
