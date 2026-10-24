import { FraxNetAuthError, type FraxNetClient, type FraxNetIdentity, type FraxNetTokens, UpstreamError, createMockFraxNetClient } from "@app/adapters";
import { assert, assertEquals } from "@std/assert";
import type { FraxnetConnection } from "../_shared/db/types.ts";
import { FIXED_NOW, MemoryDb, type TestUser, assertRejectsBadTokens, call, makeUser, verifier } from "../_shared/testing.ts";
import { createKycStatusHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/kyc-status";
const LATER = new Date(FIXED_NOW.getTime() + 2 * 3_600_000);

function identity(org: Partial<FraxNetIdentity["org"]> = {}): FraxNetIdentity {
  return {
    userId: "usr_1",
    email: "jordan@example.test",
    firstName: "Jordan",
    lastName: "Park",
    org: { id: "org_1", name: "Jordan Park", verified: true, verifiedAt: "2026-09-18T10:00:00.000Z", isBusiness: false, ...org },
  };
}

/** A scripted FraxNet: records calls, rotates refresh tokens, and answers /me + /org with `who()`. */
function fakeFraxnet(opts: { who?: () => FraxNetIdentity; refresh?: (rt: string) => Promise<FraxNetTokens>; identity?: (at: string) => Promise<FraxNetIdentity> } = {}) {
  const calls: string[] = [];
  let n = 0;
  const client: FraxNetClient = {
    kind: "real",
    verifyUrl: () => "https://net-test.frax.com",
    authorizeUrl: () => "unused",
    exchangeCode: () => Promise.reject(new Error("unused")),
    async refresh(rt) {
      calls.push(`refresh ${rt}`);
      if (opts.refresh) return opts.refresh(rt);
      n++;
      return { accessToken: `at${n}`, refreshToken: `rt${n}`, expiresAt: new Date(LATER.getTime() + 3_600_000).toISOString(), scopes: [] };
    },
    async getIdentity(at) {
      calls.push(`identity ${at}`);
      if (opts.identity) return opts.identity(at);
      return (opts.who ?? identity)();
    },
    addWallet: () => Promise.resolve(),
    getLiquidationAddress: () => Promise.resolve(null),
  };
  return { client, calls };
}

async function connected(db: MemoryDb, user: TestUser, patch: Partial<FraxnetConnection> = {}) {
  await db.upsertFraxnetConnection({
    wallet: user.wallet,
    fraxnetUserId: "usr_1",
    orgId: "org_1",
    orgName: "Jordan Park",
    orgVerified: false,
    orgVerifiedAt: null,
    orgIsBusiness: false,
    email: null,
    scopes: ["openid", "org:read", "offline_access", "addresses:manage"],
    refreshToken: "rt0",
    accessToken: "at0",
    accessExpiresAt: new Date(FIXED_NOW.getTime() + 3_600_000).toISOString(),
    needsReconnect: false,
    walletAddedAt: null,
  });
  if (Object.keys(patch).length) await db.updateFraxnetConnection(user.wallet, patch);
  await db.updateProfile(user.wallet, { kycStatus: "pending", kycSource: "fraxnet_api", kycUpdatedAt: "2026-10-01T00:00:00.000Z", fraxnetAccountRef: "usr_1" });
}

const post = (fraxnet: FraxNetClient, db: MemoryDb, user: TestUser, now = FIXED_NOW) =>
  call(createKycStatusHandler({ auth: verifier, db, fraxnet, now: () => now, walletChainId: null }), "POST", ENDPOINT, { token: user.token });

Deno.test("kyc-status rejects requests without a valid Privy token", async () => {
  const db = new MemoryDb();
  await assertRejectsBadTokens(createKycStatusHandler({ auth: verifier, db, fraxnet: createMockFraxNetClient({ appUrl: "https://net.frax.com" }), walletChainId: null }), ENDPOINT, ["POST"]);
});

Deno.test("kyc-status needs a linked wallet", async () => {
  const db = new MemoryDb();
  const user = await makeUser(db, { profile: false });
  const res = await post(createMockFraxNetClient({ appUrl: "https://net.frax.com" }), db, user);
  assertEquals([res.status, res.body.error?.code], [403, "no_profile"]);
});

Deno.test("not connected: the stored (manual) status stands and FraxNet isn't called", async () => {
  const db = new MemoryDb();
  const user = await makeUser(db);
  await db.updateProfile(user.wallet, { kycStatus: "approved", kycSource: "manual", kycUpdatedBy: user.wallet, kycUpdatedAt: FIXED_NOW.toISOString() });
  const { client, calls } = fakeFraxnet();
  const res = await post(client, db, user);
  assertEquals(res.status, 200);
  assertEquals([res.body.status, res.body.source, res.body.fraxnet, res.body.verifyUrl, res.body.stale], ["approved", "manual", null, "https://net-test.frax.com", false]);
  assertEquals(calls, []);
});

Deno.test("connected with a fresh access token: asks FraxNet with it and mirrors a new verification", async () => {
  const db = new MemoryDb();
  const user = await makeUser(db);
  await connected(db, user);
  const { client, calls } = fakeFraxnet();
  const res = await post(client, db, user);
  assertEquals(calls, ["identity at0"]);
  assertEquals([res.body.status, res.body.source, res.body.updatedAt], ["approved", "fraxnet_api", FIXED_NOW.toISOString()]);
  const fraxnet = res.body.fraxnet as Record<string, unknown>;
  assertEquals([fraxnet.verified, fraxnet.reason, fraxnet.orgName, fraxnet.checkedAt], [true, "verified", "Jordan Park", FIXED_NOW.toISOString()]);
  assert(!JSON.stringify(res.body).includes("rt0") && !JSON.stringify(res.body).includes("at0"));
});

Deno.test("an unchanged answer keeps the profile's timestamp", async () => {
  const db = new MemoryDb();
  const user = await makeUser(db);
  await connected(db, user);
  const { client } = fakeFraxnet({ who: () => identity({ verified: false }) });
  const res = await post(client, db, user);
  assertEquals([res.body.status, res.body.updatedAt], ["pending", "2026-10-01T00:00:00.000Z"]);
});

Deno.test("an expired access token is refreshed first, and the rotated pair is stored", async () => {
  const db = new MemoryDb();
  const user = await makeUser(db);
  await connected(db, user);
  const { client, calls } = fakeFraxnet();
  const res = await post(client, db, user, LATER);
  assertEquals(calls, ["refresh rt0", "identity at1"]);
  assertEquals(res.body.status, "approved");
  const conn = await db.getFraxnetConnection(user.wallet);
  assertEquals([conn?.accessToken, conn?.refreshToken], ["at1", "rt1"]);
});

Deno.test("a revoked access token that hadn't expired gets one retry through the refresh token", async () => {
  const db = new MemoryDb();
  const user = await makeUser(db);
  await connected(db, user);
  const { client, calls } = fakeFraxnet({
    identity: (at) => (at === "at0" ? Promise.reject(new FraxNetAuthError("invalid_token", "revoked")) : Promise.resolve(identity())),
  });
  const res = await post(client, db, user);
  assertEquals(calls, ["identity at0", "refresh rt0", "identity at1"]);
  assertEquals([res.body.status, (res.body.fraxnet as Record<string, unknown>).needsReconnect], ["approved", false]);
});

Deno.test("a rejected refresh token asks the member to reconnect and keeps the last status", async () => {
  const db = new MemoryDb();
  const user = await makeUser(db);
  await connected(db, user);
  const { client, calls } = fakeFraxnet({ refresh: () => Promise.reject(new FraxNetAuthError("invalid_grant", "expired")) });
  const res = await post(client, db, user, LATER);
  assertEquals([res.body.status, (res.body.fraxnet as Record<string, unknown>).needsReconnect], ["pending", true]);
  const conn = await db.getFraxnetConnection(user.wallet);
  assertEquals([conn?.needsReconnect, conn?.accessToken], [true, null]);
  // and it stops calling FraxNet until they reconnect
  await post(client, db, user, LATER);
  assertEquals(calls, ["refresh rt0"]);
});

Deno.test("tokens for a different FraxNet user are treated as needing a reconnect", async () => {
  const db = new MemoryDb();
  const user = await makeUser(db);
  await connected(db, user);
  const { client } = fakeFraxnet({ who: () => ({ ...identity(), userId: "usr_other" }) });
  const res = await post(client, db, user);
  assertEquals([res.body.status, (res.body.fraxnet as Record<string, unknown>).needsReconnect], ["pending", true]);
});

Deno.test("FraxNet down: the stored answer stands and the response says it's stale", async () => {
  const db = new MemoryDb();
  const user = await makeUser(db);
  await connected(db, user);
  const { client } = fakeFraxnet({ identity: () => Promise.reject(new UpstreamError("FraxNetClient", 503, "down")) });
  const res = await post(client, db, user);
  assertEquals([res.status, res.body.status, res.body.stale], [200, "pending", true]);
  assertEquals((await db.getFraxnetConnection(user.wallet))?.needsReconnect, false);
});

Deno.test("a check adds the app wallet if connecting couldn't, and stops once it's there (U-78)", async () => {
  const db = new MemoryDb();
  const user = await makeUser(db);
  await connected(db, user);
  const added: string[] = [];
  const { client } = fakeFraxnet();
  client.addWallet = async (at, wallet) => void added.push(`${at} ${wallet.address} ${wallet.chainId}`);
  const handler = createKycStatusHandler({ auth: verifier, db, fraxnet: client, now: () => FIXED_NOW, walletChainId: 252 });
  const res = await call(handler, "POST", ENDPOINT, { token: user.token });
  assertEquals((res.body.fraxnet as Record<string, unknown>).walletAdded, true);
  await call(handler, "POST", ENDPOINT, { token: user.token });
  assertEquals(added, [`at0 ${user.account.address} 252`]);
});
