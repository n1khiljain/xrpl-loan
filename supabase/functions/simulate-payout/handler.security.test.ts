/**
 * Security campaign E4: can the testnet payout wallet be drained, or the simulation run on mainnet? Each test
 * asserts the safe property.
 */
import { type NetworkConfig, RAW_CONFIGS } from "@app/config";
import { assert, assertEquals } from "@std/assert";
import type { Address, Hash } from "viem";
import type { Payout, RegistryReads } from "../_shared/chain.ts";
import { FakeChain } from "../_shared/fake-chain.ts";
import { draftWorld } from "../_shared/fixtures.ts";
import { call, localConfig, verifier } from "../_shared/testing.ts";
import { createSimulatePayoutHandler, payoutAllowed } from "./handler.ts";

const ENDPOINT = "http://localhost/simulate-payout";
const USD = 10n ** 18n;

// E-4b (fixed): each claim gets at most one simulated payout, so cashing out in between doesn't reset anything
Deno.test({
  name: "E4: one claim can't draw more than its amount due from the payout wallet across calls",
  async fn() {
    const w = await draftWorld();
    await w.db.updateClaim(w.claim.id, { onchainClaimId: 8, statusCache: "Funded" });
    const chain = new FakeChain();
    chain.set(8n, { state: "Funded", recipient: w.claimant.account.address, amountDue: 300n * USD, amountPaid: 0n, amountRemaining: 300n * USD });
    let balance = 0n;
    const registry: RegistryReads = { guarantyNonce: () => Promise.resolve(0n), tokenBalance: () => Promise.resolve(balance) };
    const paid: bigint[] = [];
    const payout: Payout = {
      kind: "transfer",
      available: () => Promise.resolve(1_000_000n * USD),
      pay: (_to: Address, amount: bigint) => {
        paid.push(amount);
        balance += amount;
        return Promise.resolve(`0x${"cd".repeat(32)}` as Hash);
      },
    };
    const handler = createSimulatePayoutHandler({ auth: verifier, db: w.db, config: localConfig(), chain, registry, payout: () => payout });
    for (let round = 0; round < 3; round++) {
      await call(handler, "POST", ENDPOINT, { token: w.claimant.token, body: { claimId: w.claim.id } });
      balance = 0n; // the claimant cashes out (or transfers the frxUSD to another wallet) and asks again
    }
    const total = paid.reduce((a, b) => a + b, 0n);
    assert(total <= 300n * USD, `paid ${total / USD} frxUSD for a claim with 300 due`);
  },
});

// E-4c (fixed): payoutAllowed derives testnet from the chain ID; a stray isTestnet in the object changes nothing
Deno.test("E4: simulate-payout never runs on Fraxtal mainnet (chain 252), whatever isTestnet says", () => {
  const mainnet = { ...localConfig(), network: "fraxtal" as const, chainId: 252, isTestnet: true, features: { simulateAsucPayout: true, testnetBanner: false } };
  assertEquals(payoutAllowed(mainnet), false);
});

Deno.test("E4: the committed mainnet config can't run simulate-payout", () => {
  // fraxtal.json doesn't pass the full schema until Frax's endpoints are filled in, so read it raw
  assertEquals(payoutAllowed(RAW_CONFIGS.fraxtal as NetworkConfig), false);
});
