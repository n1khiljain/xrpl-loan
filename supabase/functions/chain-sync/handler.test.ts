import type { ChainEvent } from "@app/adapters";
import { assert, assertEquals } from "@std/assert";
import { FakeChain } from "../_shared/fake-chain.ts";
import { assertStatus, draftWorld } from "../_shared/fixtures.ts";
import { MemoryMailer } from "../_shared/mail.ts";
import { FIXED_NOW, MemoryDb, assertRejectsBadTokens, call, localConfig, makeUser, verifier } from "../_shared/testing.ts";
import { createChainSyncHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/chain-sync";
const SECRET = crypto.randomUUID();
const USD = 10n ** 18n;
const TX = `0x${"ee".repeat(32)}` as const;

let logIndex = 0;
function claimEvent(block: bigint, name: Extract<ChainEvent, { contract: "ClaimRegistry" }>["name"], claimId: bigint, args: Record<string, bigint | number | string | boolean> = {}): ChainEvent {
  return { contract: "ClaimRegistry", name, claimId, blockNumber: block, logIndex: logIndex++, transactionHash: TX, args: { claimId, ...args } };
}
function orgEvent(block: bigint, name: Extract<ChainEvent, { contract: "OrgRegistry" }>["name"], orgId: bigint, args: Record<string, bigint | number | string | boolean>): ChainEvent {
  return { contract: "OrgRegistry", name, orgId, blockNumber: block, logIndex: logIndex++, transactionHash: TX, args: { orgId, ...args } };
}

function handlerFor(db: MemoryDb, chain: FakeChain, mailer = new MemoryMailer(), maxBlocks?: number) {
  return createChainSyncHandler({
    auth: verifier,
    db,
    chain,
    mailer,
    config: localConfig(),
    appBaseUrl: "https://college.frax.com",
    cronSecret: SECRET,
    now: () => FIXED_NOW,
    ...(maxBlocks ? { maxBlocks } : {}),
  });
}

Deno.test("chain-sync rejects requests without a valid Privy token or the cron secret", async () => {
  const db = new MemoryDb();
  const chain = new FakeChain();
  const handler = handlerFor(db, chain);
  await assertRejectsBadTokens(handler, ENDPOINT, ["POST"]);
  assertStatus(await call(handler, "POST", ENDPOINT, { token: "not-the-secret" }), 401);
  const user = await makeUser(db);
  assertStatus(await call(handler, "POST", ENDPOINT, { token: user.token }), 403);
  assertEquals(chain.ranges.length, 0);
});

Deno.test("the cron secret or a staff token runs a sync", async () => {
  const db = new MemoryDb();
  const staff = await makeUser(db, { staff: "attester" });
  const chain = new FakeChain();
  chain.head = 5n;
  const handler = handlerFor(db, chain);
  assertStatus(await call(handler, "POST", ENDPOINT, { token: SECRET }), 200);
  assertStatus(await call(handler, "POST", ENDPOINT, { token: staff.token }), 200);
});

Deno.test("chain-sync mirrors orgs and officers, links the draft by packetHash, tracks state, and emails once (FR-B9)", async () => {
  const w = await draftWorld();
  await w.db.updateClaim(w.claim.id, { packetHash: `0x${"ab".repeat(32)}`, packetJson: {} });
  w.db.orgs.clear();
  w.db.officers.clear();
  const newOfficer = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
  const chain = new FakeChain();
  chain.head = 20n;
  chain.set(9n, { state: "Funded", dueAt: Math.floor(FIXED_NOW.getTime() / 1000) + 170 * 86_400 });
  chain.events = [
    orgEvent(2n, "OrgAdded", 1n, { name: "Blockchain at Berkeley" }),
    orgEvent(2n, "OfficerSet", 1n, { officer: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", active: true }),
    orgEvent(3n, "OfficerSet", 1n, { officer: w.guarantor.account.address, active: true }),
    claimEvent(5n, "ClaimSubmitted", 9n, { packetHash: `0x${"AB".repeat(32)}`, recipient: w.claimant.account.address }),
    claimEvent(7n, "ClaimApproved", 9n, { amount: 400n * USD, approvalExpiresAt: 1_791_000_000 }),
    claimEvent(9n, "ClaimPurchased", 9n, { purchasePrice: 400n * USD, amountDue: 400n * USD, feeBps: 0, dueAt: 1_805_652_000 }),
    claimEvent(9n, "ClaimSettlementPaid", 9n, { paid: 10n * USD, amountRemaining: 390n * USD }),
  ];
  const mailer = new MemoryMailer();
  const handler = handlerFor(w.db, chain, mailer);

  const res = await call(handler, "POST", ENDPOINT, { token: SECRET });
  assertStatus(res, 200);
  assertEquals([res.body.fromBlock, res.body.toBlock, res.body.events, res.body.emails], ["0", "20", 7, 2]);

  assertEquals(await w.db.getOrg(1), { id: 1, name: "Blockchain at Berkeley", active: true });
  assert(await w.db.isActiveOfficer(1, newOfficer));
  const claim = await w.db.getClaim(w.claim.id);
  assertEquals([claim?.onchainClaimId, claim?.statusCache], [9, "Funded"]);
  assertEquals(mailer.sent.map((m) => [m.to, m.subject]), [
    [w.claimant.profile.email, "Your reimbursement was approved"],
    [w.claimant.profile.email, "You got paid"],
  ]);
  assert(mailer.sent.every((m) => m.text.includes(`https://college.frax.com/claim?id=${w.claim.id}`)));
  assertEquals(await w.db.getSyncBlock("chain-sync"), 20);

  // replaying the same blocks changes nothing and sends nothing new
  w.db.sync.delete("chain-sync");
  await call(handler, "POST", ENDPOINT, { token: SECRET });
  assertEquals(mailer.sent.length, 2);
});

Deno.test("the next run starts after the saved block and reads at most maxBlocks", async () => {
  const db = new MemoryDb();
  const chain = new FakeChain();
  chain.head = 100n;
  const handler = handlerFor(db, chain, new MemoryMailer(), 40);
  await call(handler, "POST", ENDPOINT, { token: SECRET });
  await call(handler, "POST", ENDPOINT, { token: SECRET });
  await call(handler, "POST", ENDPOINT, { token: SECRET });
  await call(handler, "POST", ENDPOINT, { token: SECRET });
  assertEquals(chain.ranges.map((r) => [r.fromBlock, r.toBlock]), [
    [0n, 39n],
    [40n, 79n],
    [80n, 100n],
    [101n, 100n],
  ]);
  assertEquals(await db.getSyncBlock("chain-sync"), 100);
});

Deno.test("guarantor-called and due-soon emails go to the right people; a failed send is retried next run", async () => {
  const w = await draftWorld();
  await w.db.updateClaim(w.claim.id, { onchainClaimId: 4, statusCache: "Funded" });
  const second = await w.db.insertClaim({
    orgId: 1,
    recipientWallet: w.claimant.wallet,
    recipientType: "member",
    faceValue: "100",
    requestedAmount: "100",
    callinkPrNumber: "PR-2",
    description: null,
    guarantorWallet: w.guarantor.wallet,
  });
  await w.db.updateClaim(second.id, { onchainClaimId: 6, statusCache: "Funded" });
  const nowSeconds = Math.floor(FIXED_NOW.getTime() / 1000);
  const chain = new FakeChain();
  chain.head = 30n;
  chain.set(4n, { state: "GuarantorCalled" });
  chain.set(6n, { state: "Funded", dueAt: nowSeconds + 10 * 86_400, amountRemaining: 100n });
  chain.events = [claimEvent(25n, "GuarantorCalled", 4n, { reason: 1, amountRemaining: 250n * USD, guarantor: w.guarantor.account.address })];

  const mailer = new MemoryMailer();
  mailer.failNext = true;
  const handler = handlerFor(w.db, chain, mailer);
  const first = await call(handler, "POST", ENDPOINT, { token: SECRET });
  assertEquals([first.body.emails, first.body.emailsFailed], [1, 1]);
  assertEquals((await w.db.getClaim(w.claim.id))?.statusCache, "GuarantorCalled");
  assertEquals(mailer.sent.map((m) => [m.to, m.subject]), [[w.claimant.profile.email, "Send your ASUC payment to Frax within 14 days"]]);
  assertEquals(await w.db.getSyncBlock("chain-sync"), 30);

  // the cursor moved past block 25, but the failed guarantor email is still queued, so the next run sends it
  const retry = await call(handler, "POST", ENDPOINT, { token: SECRET });
  assertEquals([retry.body.emails, retry.body.emailsFailed], [1, 0]);
  assertEquals(mailer.sent.map((m) => [m.to, m.subject]).slice(1), [[w.guarantor.profile.email, "You're asked to cover a reimbursement you signed off on"]]);
  assert(mailer.sent[1]?.text.includes("$250.00"));

  // and nothing repeats after that, including the due-soon email
  await call(handler, "POST", ENDPOINT, { token: SECRET });
  assertEquals(mailer.sent.length, 2);
});

Deno.test("an email for someone without an address is closed out, not retried forever", async () => {
  const w = await draftWorld();
  await w.db.updateProfile(w.claimant.wallet, { email: null });
  await w.db.updateClaim(w.claim.id, { packetHash: `0x${"ab".repeat(32)}`, packetJson: {} });
  const chain = new FakeChain();
  chain.head = 3n;
  chain.events = [
    claimEvent(1n, "ClaimSubmitted", 2n, { packetHash: `0x${"ab".repeat(32)}` }),
    claimEvent(2n, "ClaimApproved", 2n, { amount: 1n }),
  ];
  const mailer = new MemoryMailer();
  const handler = handlerFor(w.db, chain, mailer);
  await call(handler, "POST", ENDPOINT, { token: SECRET });
  assertEquals(mailer.sent.length, 0);
  assertEquals(await w.db.listPendingNotifications(10), []);
});
