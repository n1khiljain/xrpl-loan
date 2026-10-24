import { AdapterConfigError, FraxNetAuthError, type FraxNetClient, UpstreamError, createMockFraxNetClient, pkceChallenge } from "@app/adapters";
import { assert, assertEquals } from "@std/assert";
import { FIXED_NOW, MemoryDb, assertRejectsBadTokens, call, makeUser, verifier } from "../_shared/testing.ts";
import { type FraxnetConnectDeps, createFraxnetConnectHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/fraxnet-connect";
const APP = "https://app.example.test/";
const CALLBACK = "https://app.example.test/fraxnet/callback/";

function handlerWith(db: MemoryDb, fraxnet: FraxNetClient, extra: Partial<FraxnetConnectDeps> = {}) {
  return createFraxnetConnectHandler({ auth: verifier, db, fraxnet, appBaseUrl: APP, walletChainId: 252, now: () => FIXED_NOW, ...extra });
}

/** Runs `start`, then follows the mock's redirect back to the callback like the browser would. */
async function connect(handler: ReturnType<typeof handlerWith>, token: string) {
  const started = await call(handler, "POST", ENDPOINT, { token, body: { action: "start" } });
  assertEquals(started.status, 200);
  const back = new URL(started.body.authorizeUrl as string);
  const code = back.searchParams.get("code") ?? "";
  const state = back.searchParams.get("state") ?? "";
  return { back, code, state, finish: () => call(handler, "POST", ENDPOINT, { token, body: { action: "finish", code, state } }) };
}

Deno.test("fraxnet-connect rejects requests without a valid Privy token", async () => {
  const db = new MemoryDb();
  await assertRejectsBadTokens(handlerWith(db, createMockFraxNetClient({ appUrl: "https://net.frax.com" })), ENDPOINT, ["POST"], '{"action":"start"}');
});

Deno.test("fraxnet-connect needs a linked wallet and a known action", async () => {
  const db = new MemoryDb();
  const handler = handlerWith(db, createMockFraxNetClient({ appUrl: "https://net.frax.com" }));
  const ghost = await makeUser(db, { profile: false });
  assertEquals((await call(handler, "POST", ENDPOINT, { token: ghost.token, body: { action: "start" } })).body.error?.code, "no_profile");
  const user = await makeUser(db);
  const bad = await call(handler, "POST", ENDPOINT, { token: user.token, body: { action: "link" } });
  assertEquals([bad.status, bad.body.error?.code], [400, "bad_request"]);
  const get = await call(handler, "GET", ENDPOINT, { token: user.token });
  assertEquals(get.status, 405);
});

Deno.test("start saves the PKCE verifier server side and sends FraxNet only its challenge", async () => {
  const db = new MemoryDb();
  const user = await makeUser(db);
  let request: Parameters<FraxNetClient["authorizeUrl"]>[0] | undefined;
  const mock = createMockFraxNetClient({ appUrl: "https://net.frax.com" });
  const handler = handlerWith(db, { ...mock, authorizeUrl: (r) => ((request = r), "https://net-test-oauth.frax.com/oauth2/auth?x=1") });
  const res = await call(handler, "POST", ENDPOINT, { token: user.token, body: { action: "start" } });
  assertEquals(res.body, { authorizeUrl: "https://net-test-oauth.frax.com/oauth2/auth?x=1" });
  assert(request);
  assertEquals(request.redirectUri, CALLBACK);
  const saved = db.fraxnetStates.get(request.state);
  assert(saved && request.state.length >= 32);
  assertEquals([saved.wallet, saved.nonce, saved.expiresAt], [user.wallet, request.nonce, new Date(FIXED_NOW.getTime() + 600_000).toISOString()]);
  assertEquals(await pkceChallenge(saved.codeVerifier), request.codeChallenge);
  assert(!JSON.stringify(res.body).includes(saved.codeVerifier));
});

Deno.test("finish connects a verified FraxNet account: KYC approved from fraxnet_api, tokens kept, none returned", async () => {
  const db = new MemoryDb();
  const user = await makeUser(db);
  const handler = handlerWith(db, createMockFraxNetClient({ appUrl: "https://net.frax.com", now: () => FIXED_NOW }));
  const flow = await connect(handler, user.token);
  assertEquals(`${flow.back.origin}${flow.back.pathname}`, CALLBACK);
  const res = await flow.finish();
  assertEquals(res.status, 200);
  assertEquals([res.body.status, res.body.source, res.body.updatedAt], ["approved", "fraxnet_api", FIXED_NOW.toISOString()]);
  assertEquals((res.body.fraxnet as Record<string, unknown>).reason, "verified");
  assertEquals((res.body.fraxnet as Record<string, unknown>).needsReconnect, false);
  const conn = await db.getFraxnetConnection(user.wallet);
  assert(conn?.refreshToken && conn.accessToken);
  assert(!JSON.stringify(res.body).includes(conn.refreshToken) && !JSON.stringify(res.body).includes(conn.accessToken));
  const profile = await db.getProfile(user.wallet);
  assertEquals([profile?.kycStatus, profile?.kycSource, profile?.kycUpdatedBy, profile?.fraxnetAccountRef], ["approved", "fraxnet_api", null, conn.fraxnetUserId]);
});

Deno.test("an unverified or business FraxNet organization leaves KYC pending and says why (U-77)", async () => {
  for (const [org, reason] of [[{ verified: false }, "not_verified"], [{ isBusiness: true }, "business_org"]] as const) {
    const db = new MemoryDb();
    const user = await makeUser(db);
    const res = await (await connect(handlerWith(db, createMockFraxNetClient({ appUrl: "https://net.frax.com", org })), user.token)).finish();
    assertEquals([res.body.status, (res.body.fraxnet as Record<string, unknown>).reason], ["pending", reason]);
  }
});

Deno.test("FraxNet's answer replaces a manual one (U-59)", async () => {
  const db = new MemoryDb();
  const user = await makeUser(db);
  await db.updateProfile(user.wallet, { kycStatus: "approved", kycSource: "manual", kycUpdatedBy: user.wallet, kycUpdatedAt: "2026-10-01T00:00:00.000Z" });
  const res = await (await connect(handlerWith(db, createMockFraxNetClient({ appUrl: "https://net.frax.com", org: { verified: false } })), user.token)).finish();
  assertEquals([res.body.status, res.body.source], ["pending", "fraxnet_api"]);
  assertEquals((await db.getProfile(user.wallet))?.kycUpdatedBy, null);
});

Deno.test("a state works once, only for the wallet that started it, and only for ten minutes", async () => {
  const db = new MemoryDb();
  const user = await makeUser(db);
  const other = await makeUser(db);
  const fraxnet = createMockFraxNetClient({ appUrl: "https://net.frax.com" });
  const handler = handlerWith(db, fraxnet);

  const stolen = await connect(handler, user.token);
  const wrongWallet = await call(handler, "POST", ENDPOINT, { token: other.token, body: { action: "finish", code: stolen.code, state: stolen.state } });
  assertEquals([wrongWallet.status, wrongWallet.body.error?.code], [400, "invalid_state"]);
  assertEquals((await stolen.finish()).status, 200);
  const replay = await stolen.finish();
  assertEquals([replay.status, replay.body.error?.code], [400, "invalid_state"]);

  const late = await connect(handler, other.token);
  const afterTen = handlerWith(db, fraxnet, { now: () => new Date(FIXED_NOW.getTime() + 600_000) });
  const expired = await call(afterTen, "POST", ENDPOINT, { token: other.token, body: { action: "finish", code: late.code, state: late.state } });
  assertEquals([expired.status, expired.body.error?.code], [400, "invalid_state"]);
  assertEquals(await db.getFraxnetConnection(other.wallet), null);
});

Deno.test("one FraxNet account can back only one wallet", async () => {
  const db = new MemoryDb();
  const first = await makeUser(db);
  const second = await makeUser(db);
  const mock = createMockFraxNetClient({ appUrl: "https://net.frax.com" });
  // FraxNet hands back the same person for both sign-ins
  const sameUser = { ...mock, getIdentity: async (t: string) => ({ ...(await mock.getIdentity(t)), userId: "usr_same" }) };
  const handler = handlerWith(db, sameUser);
  assertEquals((await (await connect(handler, first.token)).finish()).status, 200);
  const res = await (await connect(handler, second.token)).finish();
  assertEquals([res.status, res.body.error?.code], [409, "fraxnet_account_in_use"]);
  assertEquals((await db.getProfile(second.wallet))?.kycStatus, "not_started");
});

Deno.test("a code FraxNet won't take is a 400 to start again; FraxNet down is a 502; no credentials is a 503", async () => {
  const db = new MemoryDb();
  const user = await makeUser(db);
  const mock = createMockFraxNetClient({ appUrl: "https://net.frax.com" });
  const cases: Array<[FraxNetClient["exchangeCode"], number, string]> = [
    [() => Promise.reject(new FraxNetAuthError("invalid_grant", "used")), 400, "fraxnet_rejected"],
    [() => Promise.reject(new UpstreamError("FraxNetClient", 503, "down")), 502, "fraxnet_unavailable"],
    [() => Promise.reject(new AdapterConfigError("FraxNetClient", "no secret")), 503, "not_configured"],
  ];
  for (const [exchangeCode, status, code] of cases) {
    const res = await (await connect(handlerWith(db, { ...mock, exchangeCode }), user.token)).finish();
    assertEquals([res.status, res.body.error?.code], [status, code]);
  }
  assertEquals(await db.getFraxnetConnection(user.wallet), null);
  assertEquals((await db.getProfile(user.wallet))?.kycStatus, "not_started");
});

Deno.test("reconnecting replaces the stored tokens and clears needsReconnect", async () => {
  const db = new MemoryDb();
  const user = await makeUser(db);
  const handler = handlerWith(db, createMockFraxNetClient({ appUrl: "https://net.frax.com" }));
  await (await connect(handler, user.token)).finish();
  const before = await db.updateFraxnetConnection(user.wallet, { needsReconnect: true });
  await (await connect(handler, user.token)).finish();
  const after = await db.getFraxnetConnection(user.wallet);
  assertEquals(after?.needsReconnect, false);
  assert(after?.refreshToken !== before.refreshToken);
});

Deno.test("connecting adds the member's app wallet to their FraxNet organization, checksummed, on the configured chain (U-78)", async () => {
  const db = new MemoryDb();
  const user = await makeUser(db);
  const fraxnet = createMockFraxNetClient({ appUrl: "https://net.frax.com", now: () => FIXED_NOW });
  const res = await (await connect(handlerWith(db, fraxnet), user.token)).finish();
  assertEquals((res.body.fraxnet as Record<string, unknown>).walletAdded, true);
  assertEquals([...fraxnet.wallets.values()], [[{ address: user.account.address, chainId: 252, name: "FraxNet College" }]]);
  assertEquals((await db.getFraxnetConnection(user.wallet))?.walletAddedAt, FIXED_NOW.toISOString());
});

Deno.test("adding the wallet is best effort: a refusal, a missing scope, or no chain still connects", async () => {
  for (const variant of ["refused", "no-scope", "no-chain"] as const) {
    const db = new MemoryDb();
    const user = await makeUser(db);
    const mock = createMockFraxNetClient({ appUrl: "https://net.frax.com" });
    let calls = 0;
    const fraxnet: FraxNetClient = {
      ...mock,
      addWallet: () => {
        calls++;
        return Promise.reject(new UpstreamError("FraxNetClient", 400, "unsupported chain"));
      },
      exchangeCode: async (input) => {
        const tokens = await mock.exchangeCode(input);
        return variant === "no-scope" ? { ...tokens, scopes: ["openid", "org:read", "offline_access"] } : tokens;
      },
    };
    const res = await (await connect(handlerWith(db, fraxnet, variant === "no-chain" ? { walletChainId: null } : {}), user.token)).finish();
    assertEquals([res.status, res.body.status, (res.body.fraxnet as Record<string, unknown>).walletAdded], [200, "approved", false], variant);
    assertEquals(calls, variant === "refused" ? 1 : 0, variant);
  }
});
