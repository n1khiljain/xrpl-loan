import { assert, assertEquals } from "@std/assert";
import { decryptSeed, importWalletKey } from "../_shared/wallets.ts";
import {
  FIXED_NOW,
  FakeLedger,
  MemoryDb,
  WALLET_KEY,
  assertRejectsBadTokens,
  call,
  identityToken,
  makeUser,
  privyToken,
  seedOrg,
  testCustody,
  verifier,
} from "../_shared/testing.ts";
import { createMeHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/me";

function setup() {
  const db = new MemoryDb(() => FIXED_NOW);
  const ledger = new FakeLedger();
  return { db, ledger, handler: createMeHandler({ auth: verifier, db, custody: testCustody(db), ledger }) };
}

type MeBody = { profile: { wallet: string; email: string | null; emailVerified: boolean; kycStatus: string } | null; wallet: { address: string; funded: boolean } | null };

Deno.test("me rejects requests without a valid Privy token", async () => {
  const { db, handler } = setup();
  await assertRejectsBadTokens(handler, ENDPOINT, ["GET", "POST"]);
  assertEquals(db.profiles.size, 0);
});

Deno.test("GET returns nulls before the account is set up", async () => {
  const { handler } = setup();
  const res = await call(handler, "GET", ENDPOINT, { token: await privyToken("did:privy:new") });
  assertEquals(res.status, 200);
  assertEquals(res.body, { profile: null, staffRole: null, officerOrgs: [], membership: null, wallet: null });
});

Deno.test("first POST makes an encrypted custodial wallet, funds it, and makes the profile", async () => {
  const { db, ledger, handler } = setup();
  const res = await call(handler, "POST", ENDPOINT, { token: await privyToken("did:privy:ada"), body: { displayName: "Ada" } });
  assertEquals(res.status, 201);
  const body = res.body as unknown as MeBody;
  const address = body.profile?.wallet as `r${string}`;
  assert(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address));
  assertEquals(body.wallet, { address, funded: true, fundedTx: "F".repeat(64) } as unknown as MeBody["wallet"]);
  assertEquals(ledger.funded, [address]);

  const row = db.wallets.get(address);
  assert(row);
  const seed = await decryptSeed(await importWalletKey(WALLET_KEY), address, row.encryptedSeed);
  assert(seed.startsWith("s"));
  assert(!row.encryptedSeed.includes(seed), "the seed is never stored in plain text");
  assertEquals(await testCustody(db).signer(address).then((w) => w.classicAddress), address);
});

Deno.test("a second POST keeps the same wallet", async () => {
  const { db, handler } = setup();
  const token = await privyToken("did:privy:once");
  const first = (await call(handler, "POST", ENDPOINT, { token, body: {} })).body as unknown as MeBody;
  const second = (await call(handler, "POST", ENDPOINT, { token, body: { displayName: "Again" } })).body as unknown as MeBody;
  assertEquals(first.profile?.wallet, second.profile?.wallet);
  assertEquals(db.wallets.size, 1);
});

Deno.test("an identity token proves the email and moves KYC to pending", async () => {
  const { handler } = setup();
  const userId = "did:privy:verified";
  const res = await call(handler, "POST", ENDPOINT, {
    token: await privyToken(userId),
    body: { identityToken: await identityToken(userId, ["ada@example.test"]), email: "Ada@Example.test" },
  });
  const profile = (res.body as unknown as MeBody).profile;
  assertEquals([profile?.email, profile?.emailVerified, profile?.kycStatus], ["ada@example.test", true, "pending"]);
});

Deno.test("an email the identity token doesn't hold stays unverified", async () => {
  const { handler } = setup();
  const userId = "did:privy:typo";
  const res = await call(handler, "POST", ENDPOINT, {
    token: await privyToken(userId),
    body: { identityToken: await identityToken(userId, ["real@example.test"]), email: "other@example.test" },
  });
  const profile = (res.body as unknown as MeBody).profile;
  assertEquals([profile?.email, profile?.emailVerified, profile?.kycStatus], ["other@example.test", false, "not_started"]);
});

Deno.test("another user's identity token is refused", async () => {
  const { db, handler } = setup();
  const res = await call(handler, "POST", ENDPOINT, {
    token: await privyToken("did:privy:me"),
    body: { identityToken: await identityToken("did:privy:someone-else", ["a@example.test"]) },
  });
  assertEquals([res.status, res.body.error?.code], [400, "bad_identity"]);
  assertEquals(db.profiles.size, 0);
});

Deno.test("a faucet failure still makes the account, and a later POST funds it", async () => {
  const { ledger, handler } = setup();
  ledger.failFund = true;
  const token = await privyToken("did:privy:later");
  const first = (await call(handler, "POST", ENDPOINT, { token, body: {} })).body as unknown as MeBody;
  assertEquals(first.wallet?.funded, false);
  ledger.failFund = false;
  const second = (await call(handler, "POST", ENDPOINT, { token, body: {} })).body as unknown as MeBody;
  assertEquals(second.wallet?.funded, true);
});

Deno.test("GET shows staff role and officer orgs", async () => {
  const { db, handler } = setup();
  const user = await makeUser(db, { staff: "underwriter" });
  seedOrg(db, 3, "Blockchain at Berkeley", [user.wallet]);
  const got = await call(handler, "GET", ENDPOINT, { token: user.token });
  assertEquals(got.body.staffRole, "underwriter");
  assertEquals(got.body.officerOrgs, [{ orgId: 3, name: "Blockchain at Berkeley", title: "Treasurer" }]);
});

Deno.test("POST rejects a malformed email", async () => {
  const { db, handler } = setup();
  const user = await makeUser(db);
  const bad = await call(handler, "POST", ENDPOINT, { token: user.token, body: { email: "nope" } });
  assertEquals(bad.status, 400);
  assert(bad.body.error?.message.startsWith("email"));
});
