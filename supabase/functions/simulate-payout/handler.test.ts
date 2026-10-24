import { assertEquals } from "@std/assert";
import type { NetworkConfig } from "@app/config";
import type { Address, Hash } from "viem";
import type { Payout, RegistryReads } from "../_shared/chain.ts";
import { FakeChain } from "../_shared/fake-chain.ts";
import { assertStatus, draftWorld } from "../_shared/fixtures.ts";
import { MemoryDb, assertRejectsBadTokens, call, localConfig, verifier } from "../_shared/testing.ts";
import { createSimulatePayoutHandler, payoutAllowed } from "./handler.ts";

const ENDPOINT = "http://localhost/simulate-payout";
const USD = 10n ** 18n;

/** Records every payout. `wallet` is the payout wallet's frxUSD when it transfers, or null when it mints. */
class RecordingPayout implements Payout {
  readonly mints: Array<[Address, bigint]> = [];
  built = 0;
  constructor(readonly wallet: bigint | null = null) {}
  get kind() {
    return this.wallet === null ? ("mint" as const) : ("transfer" as const);
  }
  available() {
    return Promise.resolve(this.wallet);
  }
  pay(to: Address, amount: bigint): Promise<Hash> {
    this.mints.push([to, amount]);
    return Promise.resolve(`0x${"cd".repeat(32)}` as Hash);
  }
}

const REAL_FRXUSD = "0xfc00000000000000000000000000000000000001" as const;

async function world(config: NetworkConfig, balance = 0n, wallet: bigint | null = null) {
  const w = await draftWorld();
  await w.db.updateClaim(w.claim.id, { onchainClaimId: 8, statusCache: "Funded" });
  const chain = new FakeChain();
  chain.set(8n, { state: "Funded", recipient: w.claimant.account.address, amountDue: 400n * USD, amountPaid: 100n * USD, amountRemaining: 300n * USD });
  const registry: RegistryReads = { guarantyNonce: async () => 0n, tokenBalance: async () => balance };
  const minter = new RecordingPayout(wallet);
  const handler = createSimulatePayoutHandler({
    auth: verifier,
    db: w.db,
    config,
    chain,
    registry,
    payout: () => {
      minter.built++;
      return minter;
    },
  });
  return { ...w, chain, minter, handler };
}

Deno.test("simulate-payout rejects requests without a valid Privy token", async () => {
  const minter = new RecordingPayout();
  const registry: RegistryReads = { guarantyNonce: async () => 0n, tokenBalance: async () => 0n };
  const handler = createSimulatePayoutHandler({ auth: verifier, db: new MemoryDb(), config: localConfig(), chain: new FakeChain(), registry, payout: () => minter });
  await assertRejectsBadTokens(handler, ENDPOINT, ["POST"]);
  assertEquals(minter.mints.length, 0);
});

Deno.test("simulate-payout refuses to run on Fraxtal mainnet's chain (FR-B10)", async () => {
  // the schema won't load a config like this; the handler refuses it anyway, even with the feature flag on
  const mainnetLike = { ...localConfig(), chainId: 252, features: { simulateAsucPayout: true, testnetBanner: false } };
  const w = await world(mainnetLike);
  const res = await call(w.handler, "POST", ENDPOINT, { token: w.claimant.token, body: { claimId: w.claim.id } });
  assertStatus(res, 403, "testnet_only");
  assertEquals([w.minter.mints.length, w.minter.built], [0, 0]);
  assertEquals(payoutAllowed(mainnetLike), false);

  const flagOff = await world({ ...localConfig(), features: { simulateAsucPayout: false, testnetBanner: false } });
  assertStatus(await call(flagOff.handler, "POST", ENDPOINT, { token: flagOff.claimant.token, body: { claimId: flagOff.claim.id } }), 403, "testnet_only");
  assertEquals(flagOff.minter.mints.length, 0);
});

Deno.test("on a testnet with MockFrxUSD it mints the amount still due to the claimant", async () => {
  const w = await world(localConfig(), 50n * USD);
  const res = await call(w.handler, "POST", ENDPOINT, { token: w.claimant.token, body: { claimId: w.claim.id } });
  assertStatus(res, 200);
  assertEquals(res.body.minted, (250n * USD).toString());
  assertEquals(w.minter.mints, [[w.claimant.account.address, 250n * USD]]);
  // a second ask for the same claim is refused, even after the frxUSD has left the wallet (E-4b)
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.claimant.token, body: { claimId: w.claim.id } }), 409, "already_paid");
  assertEquals(w.minter.mints.length, 1);
});

Deno.test("it won't pay twice, for someone else's claim, or for a settled claim", async () => {
  const funded = await world(localConfig(), 300n * USD);
  assertStatus(await call(funded.handler, "POST", ENDPOINT, { token: funded.claimant.token, body: { claimId: funded.claim.id } }), 409, "already_funded");
  assertStatus(await call(funded.handler, "POST", ENDPOINT, { token: funded.guarantor.token, body: { claimId: funded.claim.id } }), 403);

  const settled = await world(localConfig());
  settled.chain.set(8n, { state: "Settled", amountRemaining: 0n });
  assertStatus(await call(settled.handler, "POST", ENDPOINT, { token: settled.claimant.token, body: { claimId: settled.claim.id } }), 409, "nothing_due");
  assertEquals([funded.minter.mints.length, settled.minter.mints.length], [0, 0]);
});

Deno.test("with Frax's test frxUSD it transfers from the payout wallet Frax funds (U-67)", async () => {
  const w = await world({ ...localConfig(), frxUSD: REAL_FRXUSD }, 50n * USD, 1_000n * USD);
  const res = await call(w.handler, "POST", ENDPOINT, { token: w.claimant.token, body: { claimId: w.claim.id } });
  assertStatus(res, 200);
  assertEquals([res.body.minted, res.body.method], [(250n * USD).toString(), "transfer"]);
  assertEquals(w.minter.mints, [[w.claimant.account.address, 250n * USD]]);
});

Deno.test("with Frax's test frxUSD it says so when the payout wallet can't cover the amount due (U-67)", async () => {
  const w = await world({ ...localConfig(), frxUSD: REAL_FRXUSD }, 0n, 100n * USD);
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: w.claimant.token, body: { claimId: w.claim.id } }), 409, "payout_empty");
  assertEquals(w.minter.mints.length, 0);
});
