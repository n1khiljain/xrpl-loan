import { assert, assertEquals } from "@std/assert";
import { FIXED_NOW, MemoryDb, assertRejectsBadTokens, bindingSignature, call, makeUser, seedOrg, verifier } from "../_shared/testing.ts";
import { createMeHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/me";

function setup() {
  const db = new MemoryDb(() => FIXED_NOW);
  return { db, handler: createMeHandler({ auth: verifier, db, now: () => FIXED_NOW }) };
}

Deno.test("me rejects requests without a valid Privy token", async () => {
  const { db, handler } = setup();
  await assertRejectsBadTokens(handler, ENDPOINT, ["GET", "POST"], JSON.stringify({ wallet: "0x" + "1".repeat(40) }));
  assertEquals(db.profiles.size, 0);
});

Deno.test("GET returns nulls before a wallet is linked", async () => {
  const { db, handler } = setup();
  const user = await makeUser(db, { profile: false });
  const res = await call(handler, "GET", ENDPOINT, { token: user.token });
  assertEquals(res.status, 200);
  assertEquals(res.body, { profile: null, staffRole: null, officerOrgs: [] });
});

Deno.test("POST links a wallet with a fresh signature, then GET shows profile, role, and officer orgs", async () => {
  const { db, handler } = setup();
  const user = await makeUser(db, { profile: false });
  const issuedAt = FIXED_NOW.toISOString();
  const created = await call(handler, "POST", ENDPOINT, {
    token: user.token,
    body: { wallet: user.account.address, signature: await bindingSignature(user, issuedAt), issuedAt, email: "me@example.test" },
  });
  assertEquals(created.status, 201);
  assertEquals((created.body.profile as { wallet: string }).wallet, user.wallet);

  db.staff.set(user.wallet, "underwriter");
  seedOrg(db, 3, "Blockchain at Berkeley", [user.wallet]);
  const got = await call(handler, "GET", ENDPOINT, { token: user.token });
  assertEquals(got.body.staffRole, "underwriter");
  assertEquals(got.body.officerOrgs, [{ orgId: 3, name: "Blockchain at Berkeley", title: "Treasurer" }]);
  assertEquals((got.body.profile as { email: string }).email, "me@example.test");
});

Deno.test("POST refuses a signature from another wallet, a stale one, or none", async () => {
  const { db, handler } = setup();
  const user = await makeUser(db, { profile: false });
  const other = await makeUser(db, { profile: false });
  const issuedAt = FIXED_NOW.toISOString();

  const wrongSigner = await call(handler, "POST", ENDPOINT, {
    token: user.token,
    body: { wallet: user.account.address, signature: await bindingSignature({ ...other, userId: user.userId }, issuedAt), issuedAt },
  });
  assertEquals([wrongSigner.status, wrongSigner.body.error?.code], [400, "bad_binding"]);

  // a signature made for another Privy user can't be replayed here
  const replay = await call(handler, "POST", ENDPOINT, {
    token: user.token,
    body: { wallet: other.account.address, signature: await bindingSignature(other, issuedAt), issuedAt },
  });
  assertEquals(replay.body.error?.code, "bad_binding");

  const old = new Date(FIXED_NOW.getTime() - 11 * 60 * 1000).toISOString();
  const stale = await call(handler, "POST", ENDPOINT, {
    token: user.token,
    body: { wallet: user.account.address, signature: await bindingSignature(user, old), issuedAt: old },
  });
  assertEquals(stale.body.error?.code, "stale_binding");

  const unsigned = await call(handler, "POST", ENDPOINT, { token: user.token, body: { wallet: user.account.address } });
  assertEquals([unsigned.status, unsigned.body.error?.code], [409, "binding_required"]);
  assertEquals(db.profiles.size, 0);
});

Deno.test("POST keeps one wallet per account and one account per wallet", async () => {
  const { db, handler } = setup();
  const linked = await makeUser(db);
  const other = await makeUser(db, { profile: false });
  const issuedAt = FIXED_NOW.toISOString();

  const switchWallet = await call(handler, "POST", ENDPOINT, { token: linked.token, body: { wallet: other.account.address } });
  assertEquals([switchWallet.status, switchWallet.body.error?.code], [409, "wallet_already_linked"]);

  // even a valid signature from the wallet's own key can't move a wallet that's linked to another account
  const taken = await call(handler, "POST", ENDPOINT, {
    token: other.token,
    body: {
      wallet: linked.account.address,
      signature: await bindingSignature({ account: linked.account, userId: other.userId }, issuedAt),
      issuedAt,
    },
  });
  assertEquals([taken.status, taken.body.error?.code], [409, "wallet_taken"]);
});

Deno.test("POST on a linked account updates email and name without a new signature", async () => {
  const { db, handler } = setup();
  const user = await makeUser(db);
  const res = await call(handler, "POST", ENDPOINT, {
    token: user.token,
    body: { wallet: user.account.address, email: "new@example.test", displayName: "Ada" },
  });
  assertEquals(res.status, 200);
  const profile = await db.getProfile(user.wallet);
  assertEquals([profile?.email, profile?.displayName], ["new@example.test", "Ada"]);
  const bad = await call(handler, "POST", ENDPOINT, { token: user.token, body: { wallet: user.account.address, email: "nope" } });
  assertEquals(bad.status, 400);
  assert(bad.body.error?.message.startsWith("email"));
});
