/**
 * One suite, two implementations: `MemoryDb` (what the function tests use) and `SupabaseDb` against the local stack
 * with the real migrations. If they ever disagree, the function tests stop meaning anything, so this keeps them honest.
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { Wallet as XrplWallet } from "xrpl";
import { LOCAL_STACK } from "../local-stack.ts";
import type { Database } from "./database.types.ts";
import { MemoryDb } from "./memory.ts";
import { SupabaseDb } from "./supabase.ts";
import { type Db, UniqueViolation, type Wallet } from "./types.ts";

const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const wallet = () => XrplWallet.generate().classicAddress as Wallet;
const BIG = "1000000000000000000000000000001"; // 10^30 + 1: loses precision as a JSON number
const SEALED = `v1.${"A".repeat(16)}.${"B".repeat(40)}`;

type Cleanup = { wallets: Wallet[]; orgIds: number[]; syncKeys: string[]; txHashes: string[] };

async function suite(db: Db, t: Deno.TestContext, cleanup: Cleanup) {
  const claimant = wallet();
  const officer = wallet();
  cleanup.wallets.push(claimant, officer);

  await t.step("wallets: insert, unique, funded", async () => {
    const row = await db.insertWallet({ address: claimant, encryptedSeed: SEALED });
    assertEquals([row.address, row.encryptedSeed, row.fundedTx], [claimant, SEALED, null]);
    await assertRejects(() => db.insertWallet({ address: claimant, encryptedSeed: SEALED }), UniqueViolation);
    await db.setWalletFunded(claimant, "F".repeat(64));
    assertEquals((await db.getWallet(claimant))?.fundedTx, "F".repeat(64));
    assertEquals(await db.getWallet(wallet()), null);
    await db.insertWallet({ address: officer, encryptedSeed: SEALED });
  });

  await t.step("profiles: insert, look up, unique, update, list by KYC", async () => {
    const privy = `did:privy:${hex(8)}`;
    const p = await db.insertProfile({ wallet: claimant, privyUserId: privy, email: "a@example.test", emailVerified: true, displayName: "Ada" });
    assertEquals([p.kycStatus, p.kycSource, p.emailVerified], ["not_started", null, true]);
    assertEquals((await db.getProfileByPrivyId(privy))?.wallet, claimant);
    await assertRejects(
      () => db.insertProfile({ wallet: claimant, privyUserId: `did:privy:${hex(8)}`, email: null, emailVerified: false, displayName: null }),
      UniqueViolation,
    );
    const updated = await db.updateProfile(claimant, { kycStatus: "approved", kycSource: "manual", kycUpdatedBy: officer, kycUpdatedAt: new Date().toISOString() });
    assertEquals([updated.kycStatus, updated.kycSource, updated.kycUpdatedBy], ["approved", "manual", officer]);
    await db.insertProfile({ wallet: officer, privyUserId: `did:privy:${hex(8)}`, email: "o@example.test", emailVerified: false, displayName: null });
    await db.updateProfile(officer, { kycStatus: "pending" });
    assert((await db.listProfilesByKyc(["pending"])).some((x) => x.wallet === officer));
    assert(!(await db.listProfilesByKyc(["pending"])).some((x) => x.wallet === claimant));
    assertEquals(await db.getProfile(wallet()), null);
    assertEquals(await db.getStaffRole(claimant), null);
  });

  let orgId = 0;
  await t.step("orgs and officers", async () => {
    const name = `Club ${hex(4)}`;
    const org = await db.insertOrg(name);
    orgId = org.id;
    cleanup.orgIds.push(orgId);
    assertEquals(org, { id: orgId, name, active: true });
    await assertRejects(() => db.insertOrg(name), UniqueViolation);
    await db.setOrgActive(orgId, false);
    assertEquals(await db.getOrg(orgId), { id: orgId, name, active: false });
    assert((await db.listOrgs()).some((o) => o.id === orgId));
    await db.setOrgActive(orgId, true);
    await db.upsertOfficer({ orgId, wallet: officer, title: "Treasurer", active: true });
    assert(await db.isActiveOfficer(orgId, officer));
    assertEquals(await db.listOfficerOrgs(officer), [{ orgId, name, title: "Treasurer" }]);
    await db.upsertOfficer({ orgId, wallet: officer, title: null, active: false });
    assert(!(await db.isActiveOfficer(orgId, officer)));
    assertEquals(await db.listOfficerOrgs(officer), []);
    await db.upsertOfficer({ orgId, wallet: officer, title: null, active: true });
    const listed = (await db.listActiveOrgsWithOfficers()).find((o) => o.id === orgId);
    assertEquals(listed?.officers, [{ wallet: officer, title: null, displayName: null }]);
  });

  let claimId = "";
  await t.step("claims: insert, exact amounts, unique CalLink, update, transitions, scopes", async () => {
    const callink = `PR-${hex(4)}`;
    const claim = await db.insertClaim({
      orgId,
      recipientWallet: claimant,
      recipientType: "member",
      faceValue: BIG,
      requestedAmount: BIG,
      callinkPrNumber: callink,
      description: null,
      guarantorWallet: officer,
    });
    claimId = claim.id;
    assert(claim.number > 0);
    assertEquals([claim.faceValue, claim.requestedAmount, claim.status, claim.asucOutcome, claim.approvedAmount], [BIG, BIG, "Draft", "none", "0"]);
    await assertRejects(() => db.insertClaim({ ...claim, callinkPrNumber: callink, description: null }), UniqueViolation);
    const packetHash = hex(32);
    const frozen = await db.updateClaim(claim.id, {
      packetJson: { documentHashes: ["a"] },
      packetHash,
      guarantySignedAt: new Date().toISOString(),
    });
    assertEquals(frozen.packetJson, { documentHashes: ["a"] });
    assert(frozen.guarantySignedAt);

    const submitted = await db.transitionClaim(claim.id, ["Draft"], { status: "Submitted", submittedAt: new Date().toISOString() });
    assertEquals(submitted?.status, "Submitted");
    assertEquals(await db.transitionClaim(claim.id, ["Draft"], { status: "Cancelled" }), null);
    const funded = await db.transitionClaim(claim.id, ["Submitted"], {
      status: "Funded",
      approvedAmount: BIG,
      purchasePrice: BIG,
      amountDue: BIG,
      amountPaid: "1",
      loanId: "C".repeat(64),
      callReason: "none",
    });
    assertEquals([funded?.approvedAmount, funded?.amountDue, funded?.amountPaid, funded?.loanId], [BIG, BIG, "1", "C".repeat(64)]);
    assert((await db.listClaimsByStatus(["Funded"])).some((c) => c.id === claim.id));

    const stranger = wallet();
    assertEquals((await db.listClaims({ kind: "wallet", wallet: claimant, officerOrgIds: [] })).map((c) => c.id), [claim.id]);
    assertEquals((await db.listClaims({ kind: "wallet", wallet: officer, officerOrgIds: [] })).map((c) => c.id), [claim.id]);
    assertEquals((await db.listClaims({ kind: "wallet", wallet: stranger, officerOrgIds: [orgId] })).map((c) => c.id), [claim.id]);
    assertEquals((await db.listClaims({ kind: "wallet", wallet: stranger, officerOrgIds: [] })).length, 0);
    assert(!(await db.listClaims({ kind: "reported" })).some((c) => c.id === claim.id));
    await db.updateClaim(claim.id, { asucOutcome: "short_paid", asucOutcomeNote: "paid less", asucOutcomeAt: new Date().toISOString() });
    assert((await db.listClaims({ kind: "reported" })).some((c) => c.id === claim.id));
    assert((await db.listClaims({ kind: "all" })).some((c) => c.id === claim.id));
  });

  await t.step("documents", async () => {
    const id = crypto.randomUUID();
    const doc = await db.insertDocument({ id, claimId, storagePath: `${claimId}/${id}`, mimeType: "application/pdf", sizeBytes: 10, uploadedBy: claimant });
    assertEquals([doc.id, doc.sha256], [id, null]);
    const hashed = await db.setDocumentHash(id, "f".repeat(64));
    assertEquals(hashed.sha256, "f".repeat(64));
    assertEquals((await db.listDocuments(claimId)).map((d) => d.id), [id]);
    assertEquals((await db.getDocument(id))?.storagePath, `${claimId}/${id}`);
  });

  await t.step("invites", async () => {
    const tokenHash = hex(32);
    const invite = await db.insertInvite({ claimId, guarantorWallet: officer, tokenHash, expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    assertEquals((await db.getInviteByTokenHash(tokenHash))?.id, invite.id);
    await db.markInviteUsed(invite.id);
    assert((await db.getInviteByTokenHash(tokenHash))?.usedAt);
    assertEquals(await db.countInvitesSince(claimId, new Date(Date.parse(invite.createdAt) - 1000).toISOString()), 1);
    assertEquals(await db.countInvitesSince(claimId, new Date(Date.parse(invite.createdAt) + 1000).toISOString()), 0);
  });

  await t.step("ledger transactions: recorded once, listed by claim and account", async () => {
    const txHash = hex(32).toUpperCase();
    cleanup.txHashes.push(txHash);
    const tx = { txHash, txType: "LoanSet", account: claimant, claimId, purpose: "loan_set", result: "tesSUCCESS" };
    await db.recordLedgerTx(tx);
    await db.recordLedgerTx(tx);
    assertEquals((await db.listLedgerTxs({ claimId })).map((t) => [t.txHash, t.purpose, t.result]), [[txHash, "loan_set", "tesSUCCESS"]]);
    assertEquals((await db.listLedgerTxs({ account: claimant })).length, 1);
    assertEquals((await db.listLedgerTxs({ account: officer })).length, 0);
  });

  await t.step("admin actions and notifications", async () => {
    await db.insertAdminAction({ actorWallet: officer, action: "kyc_manual", target: claimant, payload: { note: "x" } });
    const sent = { wallet: officer, kind: "guaranty_requested" as const, claimId };
    assert(await db.recordNotification(sent));
    assert(!(await db.recordNotification(sent)));
  });

  await t.step("once keys: the first claim wins, a released key can be claimed again", async () => {
    const key = `test-${hex(8)}`;
    assert(await db.claimOnce(key));
    assert(!(await db.claimOnce(key)));
    await db.releaseOnce(key);
    assert(await db.claimOnce(key));
    await db.releaseOnce(key);
  });

  await t.step("sync cursor", async () => {
    const key = `test-${hex(4)}`;
    cleanup.syncKeys.push(key);
    assertEquals(await db.getSyncLedger(key), null);
    await db.setSyncLedger(key, 123);
    await db.setSyncLedger(key, 456);
    assertEquals(await db.getSyncLedger(key), 456);
  });
}

Deno.test("Db contract: MemoryDb", async (t) => {
  await suite(new MemoryDb(), t, { wallets: [], orgIds: [], syncKeys: [], txHashes: [] });
});

Deno.test({
  name: "Db contract: SupabaseDb against the local stack and real migrations",
  ignore: LOCAL_STACK === null,
  async fn(t) {
    const stack = LOCAL_STACK!;
    const client = createClient<Database>(stack.url, stack.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const cleanup: Cleanup = { wallets: [], orgIds: [], syncKeys: [], txHashes: [] };
    try {
      await suite(new SupabaseDb(client), t, cleanup);
    } finally {
      await client.from("ledger_txs").delete().in("tx_hash", cleanup.txHashes);
      await client.from("claims").delete().in("recipient_wallet", cleanup.wallets);
      await client.from("org_officers").delete().in("org_id", cleanup.orgIds);
      await client.from("orgs").delete().in("id", cleanup.orgIds);
      await client.from("admin_actions").delete().in("actor_wallet", cleanup.wallets);
      await client.from("profiles").delete().in("wallet_address", cleanup.wallets);
      await client.from("wallets").delete().in("address", cleanup.wallets);
      await client.from("sync_state").delete().in("key", cleanup.syncKeys);
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
