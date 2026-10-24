/**
 * One suite, two implementations: `MemoryDb` (what the function tests use) and `SupabaseDb` against the local stack
 * with the real migrations. If they ever disagree, the function tests stop meaning anything, so this keeps them honest.
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { LOCAL_STACK } from "../local-stack.ts";
import type { Database } from "./database.types.ts";
import { MemoryDb } from "./memory.ts";
import { SupabaseDb } from "./supabase.ts";
import { type Db, UniqueViolation, type Wallet } from "./types.ts";

const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const wallet = () => `0x${hex(20)}` as Wallet;
const WEI = "1000000000000000000000000000001"; // 10^30 + 1: loses precision as a JSON number

type Cleanup = { wallets: Wallet[]; orgIds: number[]; syncKeys: string[] };

async function suite(db: Db, t: Deno.TestContext, cleanup: Cleanup) {
  const claimant = wallet();
  const officer = wallet();
  const orgId = 1_000_000 + Math.floor(Math.random() * 1_000_000_000);
  cleanup.wallets.push(claimant, officer);
  cleanup.orgIds.push(orgId);

  await t.step("profiles: insert, look up, unique, update", async () => {
    const privy = `did:privy:${hex(8)}`;
    const p = await db.insertProfile({ wallet: claimant, privyUserId: privy, email: "a@example.test", displayName: "Ada" });
    assertEquals([p.kycStatus, p.kycSource], ["not_started", null]);
    assertEquals((await db.getProfileByPrivyId(privy))?.wallet, claimant);
    await assertRejects(() => db.insertProfile({ wallet: claimant, privyUserId: `did:privy:${hex(8)}`, email: null, displayName: null }), UniqueViolation);
    await assertRejects(() => db.insertProfile({ wallet: wallet(), privyUserId: privy, email: null, displayName: null }), UniqueViolation);
    const updated = await db.updateProfile(claimant, { kycStatus: "approved", kycSource: "manual", kycUpdatedBy: officer, kycUpdatedAt: new Date().toISOString() });
    assertEquals([updated.kycStatus, updated.kycSource, updated.kycUpdatedBy], ["approved", "manual", officer]);
    await db.insertProfile({ wallet: officer, privyUserId: `did:privy:${hex(8)}`, email: "o@example.test", displayName: null });
    assertEquals(await db.getProfile(wallet()), null);
    assertEquals(await db.getStaffRole(claimant), null);
  });

  await t.step("fraxnet: a sign-in state works once and only for its wallet; one FraxNet user per wallet", async () => {
    const state = hex(24);
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    await db.insertFraxnetState({ state, wallet: claimant, codeVerifier: "v".repeat(43), nonce: "n", expiresAt });
    await assertRejects(() => db.insertFraxnetState({ state, wallet: claimant, codeVerifier: "v".repeat(43), nonce: "n", expiresAt }), UniqueViolation);
    assertEquals(await db.takeFraxnetState(state, officer), null);
    const taken = await db.takeFraxnetState(state, claimant);
    assertEquals([taken?.wallet, taken?.codeVerifier, taken?.nonce, taken && Date.parse(taken.expiresAt)], [claimant, "v".repeat(43), "n", Date.parse(expiresAt)]);
    assertEquals(await db.takeFraxnetState(state, claimant), null);

    const fraxnetUserId = `usr_${hex(6)}`;
    const conn = {
      wallet: claimant,
      fraxnetUserId,
      orgId: "org_1",
      orgName: "Ada Lovelace",
      orgVerified: false,
      orgVerifiedAt: null,
      orgIsBusiness: false,
      email: "ada@example.test",
      scopes: ["openid", "org:read", "offline_access"],
      refreshToken: "rt",
      accessToken: "at",
      accessExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      needsReconnect: false,
      walletAddedAt: null,
    };
    const saved = await db.upsertFraxnetConnection(conn);
    assertEquals([saved.fraxnetUserId, saved.scopes, saved.orgVerified, saved.needsReconnect], [fraxnetUserId, conn.scopes, false, false]);
    await assertRejects(() => db.upsertFraxnetConnection({ ...conn, wallet: officer }), UniqueViolation);
    const verifiedAt = new Date().toISOString();
    const updated = await db.updateFraxnetConnection(claimant, { orgVerified: true, orgVerifiedAt: verifiedAt, refreshToken: "rt2", needsReconnect: true, walletAddedAt: verifiedAt });
    assertEquals([updated.orgVerified, updated.refreshToken, updated.needsReconnect, updated.email], [true, "rt2", true, "ada@example.test"]);
    assertEquals(Date.parse(updated.walletAddedAt ?? ""), Date.parse(verifiedAt));
    const switched = await db.upsertFraxnetConnection({ ...conn, fraxnetUserId: `usr_${hex(6)}`, refreshToken: "rt3" });
    assertEquals([switched.refreshToken, switched.needsReconnect, switched.walletAddedAt], ["rt3", false, null]);
    assertEquals((await db.getFraxnetConnection(claimant))?.fraxnetUserId, switched.fraxnetUserId);
    assertEquals(await db.getFraxnetConnection(officer), null);
  });

  await t.step("orgs and officers", async () => {
    await db.upsertOrg({ id: orgId, name: "Blockchain at Berkeley", active: true });
    await db.setOrgActive(orgId, false);
    assertEquals(await db.getOrg(orgId), { id: orgId, name: "Blockchain at Berkeley", active: false });
    await db.setOrgActive(orgId, true);
    await db.upsertOfficer({ orgId, wallet: officer, active: true });
    assert(await db.isActiveOfficer(orgId, officer));
    assertEquals(await db.listOfficerOrgs(officer), [{ orgId, name: "Blockchain at Berkeley", title: null }]);
    await db.upsertOfficer({ orgId, wallet: officer, active: false });
    assert(!(await db.isActiveOfficer(orgId, officer)));
    assertEquals(await db.listOfficerOrgs(officer), []);
    await db.upsertOfficer({ orgId, wallet: officer, active: true });
    const listed = (await db.listActiveOrgsWithOfficers()).find((o) => o.id === orgId);
    assertEquals(listed?.officers, [{ wallet: officer, title: null, displayName: null }]);
  });

  let claimId = "";
  await t.step("claims: insert, exact wei, unique CalLink, update, scopes, lookups", async () => {
    const callink = `PR-${hex(4)}`;
    const claim = await db.insertClaim({
      orgId,
      recipientWallet: claimant,
      recipientType: "member",
      faceValue: WEI,
      requestedAmount: WEI,
      callinkPrNumber: callink,
      description: null,
      guarantorWallet: officer,
    });
    claimId = claim.id;
    assertEquals([claim.faceValue, claim.requestedAmount, claim.statusCache, claim.asucOutcome], [WEI, WEI, "Draft", "none"]);
    await assertRejects(
      () => db.insertClaim({ ...claim, callinkPrNumber: callink, description: null }),
      UniqueViolation,
    );
    const packetHash = `0x${hex(32)}` as const;
    const frozen = await db.updateClaim(claim.id, {
      packetJson: { documentHashes: ["a"] },
      packetHash,
      guarantySignature: `0x${hex(65)}`,
      guarantyNonce: WEI,
      guarantyDeadline: 1_900_000_000,
      onchainClaimId: orgId,
      statusCache: "Funded",
    });
    assertEquals([frozen.guarantyNonce, frozen.guarantyDeadline, frozen.statusCache], [WEI, 1_900_000_000, "Funded"]);
    assertEquals(frozen.packetJson, { documentHashes: ["a"] });
    assertEquals((await db.getClaimByPacketHash(packetHash))?.id, claim.id);
    assertEquals((await db.getClaimByOnchainId(orgId))?.id, claim.id);
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

  await t.step("gas drips: one per window, released reservations don't count", async () => {
    const first = await db.reserveGasDrip(claimant, 86_400);
    assert(first !== null);
    assertEquals(await db.reserveGasDrip(claimant, 86_400), null);
    await db.releaseGasDrip(first);
    const second = await db.reserveGasDrip(claimant, 86_400);
    assert(second !== null);
    await db.confirmGasDrip(second, { txHash: `0x${hex(32)}`, amountWei: 10n ** 15n });
    await db.releaseGasDrip(second); // confirmed rows are never released
    assertEquals(await db.reserveGasDrip(claimant, 86_400), null);
  });

  await t.step("admin actions and the notification outbox", async () => {
    await db.insertAdminAction({ actorWallet: officer, action: "kyc_manual", target: claimant, payload: { note: "x" } });
    const key = { wallet: claimant, kind: "claim_funded" as const, claimId };
    assert(await db.enqueueNotification(key, { price: WEI, dueAt: 1_900_000_000, link: "https://x" }));
    assert(!(await db.enqueueNotification(key, {})));
    let pending = (await db.listPendingNotifications(500)).filter((n) => n.claimId === claimId);
    assertEquals(pending.map((n) => [n.kind, n.data, n.attempts]), [["claim_funded", { price: WEI, dueAt: 1_900_000_000, link: "https://x" }, 0]]);
    await db.markNotificationFailed(pending[0]?.id as string, "mail down");
    pending = (await db.listPendingNotifications(500)).filter((n) => n.claimId === claimId);
    assertEquals(pending.map((n) => n.attempts), [1]);
    await db.markNotificationSent(pending[0]?.id as string);
    assertEquals((await db.listPendingNotifications(500)).filter((n) => n.claimId === claimId), []);
    const sent = { wallet: officer, kind: "guaranty_requested" as const, claimId };
    assert(await db.recordNotification(sent));
    assert(!(await db.recordNotification(sent)));
    assertEquals((await db.listPendingNotifications(500)).filter((n) => n.claimId === claimId), []);
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
    assertEquals(await db.getSyncBlock(key), null);
    await db.setSyncBlock(key, 123);
    await db.setSyncBlock(key, 456);
    assertEquals(await db.getSyncBlock(key), 456);
  });
}

Deno.test("Db contract: MemoryDb", async (t) => {
  await suite(new MemoryDb(), t, { wallets: [], orgIds: [], syncKeys: [] });
});

Deno.test({
  name: "Db contract: SupabaseDb against the local stack and real migrations",
  ignore: LOCAL_STACK === null,
  async fn(t) {
    const stack = LOCAL_STACK!;
    const client = createClient<Database>(stack.url, stack.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const cleanup: Cleanup = { wallets: [], orgIds: [], syncKeys: [] };
    try {
      await suite(new SupabaseDb(client), t, cleanup);
    } finally {
      await client.from("claims").delete().in("recipient_wallet", cleanup.wallets);
      await client.from("org_officers").delete().in("org_id", cleanup.orgIds);
      await client.from("orgs").delete().in("id", cleanup.orgIds);
      await client.from("gas_drips").delete().in("wallet_address", cleanup.wallets);
      await client.from("admin_actions").delete().in("actor_wallet", cleanup.wallets);
      await client.from("profiles").delete().in("wallet_address", cleanup.wallets);
      await client.from("sync_state").delete().in("key", cleanup.syncKeys);
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
