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
  const seller = wallet();
  const officer = wallet();
  cleanup.wallets.push(seller, officer);

  await t.step("wallets: insert, unique, funded", async () => {
    const row = await db.insertWallet({ address: seller, encryptedSeed: SEALED });
    assertEquals([row.address, row.encryptedSeed, row.fundedTx], [seller, SEALED, null]);
    await assertRejects(() => db.insertWallet({ address: seller, encryptedSeed: SEALED }), UniqueViolation);
    await db.setWalletFunded(seller, "F".repeat(64));
    assertEquals((await db.getWallet(seller))?.fundedTx, "F".repeat(64));
    assertEquals(await db.getWallet(wallet()), null);
    await db.insertWallet({ address: officer, encryptedSeed: SEALED });
  });

  await t.step("profiles: insert, look up, unique, update, list by KYC", async () => {
    const privy = `did:privy:${hex(8)}`;
    const p = await db.insertProfile({ wallet: seller, privyUserId: privy, email: "a@example.test", emailVerified: true, displayName: "Ada" });
    assertEquals([p.kycStatus, p.kycSource, p.emailVerified], ["not_started", null, true]);
    assertEquals((await db.getProfileByPrivyId(privy))?.wallet, seller);
    await assertRejects(
      () => db.insertProfile({ wallet: seller, privyUserId: `did:privy:${hex(8)}`, email: null, emailVerified: false, displayName: null }),
      UniqueViolation,
    );
    const updated = await db.updateProfile(seller, { kycStatus: "approved", kycSource: "manual", kycUpdatedBy: officer, kycUpdatedAt: new Date().toISOString() });
    assertEquals([updated.kycStatus, updated.kycSource, updated.kycUpdatedBy], ["approved", "manual", officer]);
    await db.insertProfile({ wallet: officer, privyUserId: `did:privy:${hex(8)}`, email: "o@example.test", emailVerified: false, displayName: null });
    await db.updateProfile(officer, { kycStatus: "pending" });
    assert((await db.listProfilesByKyc(["pending"])).some((x) => x.wallet === officer));
    assert(!(await db.listProfilesByKyc(["pending"])).some((x) => x.wallet === seller));
    assertEquals(await db.getProfile(wallet()), null);
    assertEquals(await db.getStaffRole(seller), null);
  });

  let orgId = 0;
  await t.step("orgs and officers", async () => {
    const name = `Club ${hex(4)}`;
    const org = await db.insertOrg(name);
    orgId = org.id;
    cleanup.orgIds.push(orgId);
    assertEquals(org.name, name);
    assertEquals(org.active, true);
    assert(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(org.joinCode));
    assertEquals(await db.getOrgByJoinCode(org.joinCode), org);
    await assertRejects(() => db.insertOrg(name), UniqueViolation);
    await db.setOrgActive(orgId, false);
    assertEquals(await db.getOrg(orgId), { ...org, active: false });
    assert((await db.listOrgs()).some((o) => o.id === orgId));
    await db.setOrgActive(orgId, true);
    await db.upsertOfficer({ orgId, wallet: officer, title: "Treasurer", active: true });
    assert(await db.isActiveOfficer(orgId, officer));
    assertEquals(await db.listOfficerOrgs(officer), [{ orgId, name, title: "Treasurer" }]);
    await db.upsertOfficer({ orgId, wallet: officer, title: null, active: false });
    assert(!(await db.isActiveOfficer(orgId, officer)));
    assertEquals(await db.listOfficerOrgs(officer), []);
    await db.upsertOfficer({ orgId, wallet: officer, title: null, active: true });
    await db.insertMember({ orgId, wallet: officer, financeAgent: true, roleTitle: null });
    assertEquals(await db.listFinanceAgents(orgId), [officer]);
    await db.insertMember({ orgId, wallet: seller, financeAgent: false, roleTitle: "Buyer" });
    assertEquals(await db.getMember(seller), { orgId, wallet: seller, financeAgent: false, roleTitle: "Buyer" });
    await assertRejects(() => db.insertMember({ orgId, wallet: seller, financeAgent: true, roleTitle: null }), UniqueViolation);
    const listed = (await db.listActiveOrgsWithOfficers()).find((o) => o.id === orgId);
    assertEquals(listed?.officers, [{ wallet: officer, title: null, displayName: null }]);
  });

  let receivableId = "";
  await t.step("receivables: insert, exact amounts, unique reference per seller, update, transitions, scopes", async () => {
    const reference = `PR-${hex(4)}`;
    const receivable = await db.insertReceivable({
      type: "reimbursement",
      recipientWallet: seller,
      payerName: "ASUC",
      payerEmail: null,
      payerWallet: null,
      dueDate: "2027-01-15",
      orgId,
      faceValue: BIG,
      requestedAmount: BIG,
      reference,
      description: null,
      guarantorWallet: officer,
    });
    receivableId = receivable.id;
    assert(receivable.number > 0);
    assertEquals([receivable.faceValue, receivable.requestedAmount, receivable.status, receivable.payerOutcome, receivable.approvedAmount], [BIG, BIG, "Draft", "none", "0"]);
    assertEquals([receivable.type, receivable.payerName, receivable.dueDate, receivable.orgId], ["reimbursement", "ASUC", "2027-01-15", orgId]);
    await assertRejects(() => db.insertReceivable({ ...receivable, reference, description: null }), UniqueViolation);
    const packetHash = hex(32);
    const frozen = await db.updateReceivable(receivable.id, {
      packetJson: { documentHashes: ["a"] },
      packetHash,
      guarantySignedAt: new Date().toISOString(),
    });
    assertEquals(frozen.packetJson, { documentHashes: ["a"] });
    assert(frozen.guarantySignedAt);

    const submitted = await db.transitionReceivable(receivable.id, ["Draft"], { status: "Submitted", submittedAt: new Date().toISOString() });
    assertEquals(submitted?.status, "Submitted");
    assertEquals(await db.transitionReceivable(receivable.id, ["Draft"], { status: "Cancelled" }), null);
    const funded = await db.transitionReceivable(receivable.id, ["Submitted"], {
      status: "Funded",
      approvedAmount: BIG,
      purchasePrice: BIG,
      amountDue: BIG,
      amountPaid: "1",
      loanId: "C".repeat(64),
      callReason: "none",
    });
    assertEquals([funded?.approvedAmount, funded?.amountDue, funded?.amountPaid, funded?.loanId], [BIG, BIG, "1", "C".repeat(64)]);
    assert((await db.listReceivablesByStatus(["Funded"])).some((c) => c.id === receivable.id));

    const stranger = wallet();
    const agent = wallet();
    cleanup.wallets.push(agent);
    await db.insertWallet({ address: agent, encryptedSeed: SEALED });
    await db.insertProfile({ wallet: agent, privyUserId: `did:privy:${hex(8)}`, email: null, emailVerified: false, displayName: "Finn" });
    await db.insertMember({ orgId, wallet: agent, financeAgent: true, roleTitle: null });
    await db.updateReceivable(receivable.id, { status: "FinanceReview" });
    assert((await db.listReceivables({ kind: "wallet", wallet: agent, officerOrgIds: [], financeOrgId: orgId })).some((c) => c.id === receivable.id));
    assertEquals((await db.listReceivables({ kind: "wallet", wallet: agent, officerOrgIds: [], financeOrgId: null })).length, 0);
    await db.updateReceivable(receivable.id, { status: "Funded" });
    assertEquals((await db.listReceivables({ kind: "wallet", wallet: seller, officerOrgIds: [], financeOrgId: null })).map((c) => c.id), [receivable.id]);
    assertEquals((await db.listReceivables({ kind: "wallet", wallet: officer, officerOrgIds: [], financeOrgId: null })).map((c) => c.id), [receivable.id]);
    assertEquals((await db.listReceivables({ kind: "wallet", wallet: stranger, officerOrgIds: [orgId], financeOrgId: null })).map((c) => c.id), [receivable.id]);
    assertEquals((await db.listReceivables({ kind: "wallet", wallet: stranger, officerOrgIds: [], financeOrgId: null })).length, 0);
    assert(!(await db.listReceivables({ kind: "reported" })).some((c) => c.id === receivable.id));
    await db.updateReceivable(receivable.id, { payerOutcome: "short_paid", payerOutcomeNote: "paid less", payerOutcomeAt: new Date().toISOString() });
    assert((await db.listReceivables({ kind: "reported" })).some((c) => c.id === receivable.id));
    assert((await db.listReceivables({ kind: "all" })).some((c) => c.id === receivable.id));
  });

  await t.step("documents", async () => {
    const id = crypto.randomUUID();
    const doc = await db.insertDocument({ id, receivableId, storagePath: `${receivableId}/${id}`, mimeType: "application/pdf", sizeBytes: 10, uploadedBy: seller });
    assertEquals([doc.id, doc.sha256], [id, null]);
    const hashed = await db.setDocumentHash(id, "f".repeat(64));
    assertEquals(hashed.sha256, "f".repeat(64));
    assertEquals((await db.listDocuments(receivableId)).map((d) => d.id), [id]);
    assertEquals((await db.getDocument(id))?.storagePath, `${receivableId}/${id}`);
  });

  await t.step("invites", async () => {
    const tokenHash = hex(32);
    const invite = await db.insertInvite({ receivableId, guarantorWallet: officer, tokenHash, expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    assertEquals((await db.getInviteByTokenHash(tokenHash))?.id, invite.id);
    await db.markInviteUsed(invite.id);
    assert((await db.getInviteByTokenHash(tokenHash))?.usedAt);
    assertEquals(await db.countInvitesSince(receivableId, new Date(Date.parse(invite.createdAt) - 1000).toISOString()), 1);
    assertEquals(await db.countInvitesSince(receivableId, new Date(Date.parse(invite.createdAt) + 1000).toISOString()), 0);
  });

  await t.step("ledger transactions: recorded once, listed by receivable and account", async () => {
    const txHash = hex(32).toUpperCase();
    cleanup.txHashes.push(txHash);
    const tx = { txHash, txType: "LoanSet", account: seller, receivableId, purpose: "loan_set", result: "tesSUCCESS" };
    await db.recordLedgerTx(tx);
    await db.recordLedgerTx(tx);
    assertEquals((await db.listLedgerTxs({ receivableId })).map((t) => [t.txHash, t.purpose, t.result]), [[txHash, "loan_set", "tesSUCCESS"]]);
    assertEquals((await db.listLedgerTxs({ account: seller })).length, 1);
    assertEquals((await db.listLedgerTxs({ account: officer })).length, 0);
  });

  await t.step("admin actions and notifications", async () => {
    await db.insertAdminAction({ actorWallet: officer, action: "kyc_manual", target: seller, payload: { note: "x" } });
    const sent = { wallet: officer, kind: "guaranty_requested" as const, receivableId };
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
      await client.from("receivables").delete().in("recipient_wallet", cleanup.wallets);
      await client.from("org_officers").delete().in("org_id", cleanup.orgIds);
      await client.from("org_members").delete().in("org_id", cleanup.orgIds);
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
