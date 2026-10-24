import { assert, assertEquals, assertMatch } from "@std/assert";
import { assertStatus, draftWorld } from "../_shared/fixtures.ts";
import { MemoryMailer } from "../_shared/mail.ts";
import { FIXED_NOW, MemoryDb, assertRejectsBadTokens, call, makeUser, verifier } from "../_shared/testing.ts";
import { createPacketHandler } from "../packet/handler.ts";
import { createInviteHandler, hashToken } from "./handler.ts";

const ENDPOINT = "http://localhost/guarantor-invite";

async function frozenWorld() {
  const w = await draftWorld();
  const packet = createPacketHandler({ auth: verifier, db: w.db });
  await call(packet, "POST", "http://localhost/packet", { token: w.claimant.token, body: { claimId: w.claim.id } });
  const mailer = new MemoryMailer();
  let now = FIXED_NOW;
  const handler = createInviteHandler({
    auth: verifier,
    db: w.db,
    mailer,
    appBaseUrl: "https://receivables.example.test/",
    now: () => now,
  });
  return { ...w, mailer, handler, setNow: (d: Date) => (now = d) };
}

Deno.test("guarantor-invite rejects requests without a valid Privy token", async () => {
  const mailer = new MemoryMailer();
  const handler = createInviteHandler({ auth: verifier, db: new MemoryDb(), mailer, appBaseUrl: "http://x" });
  await assertRejectsBadTokens(handler, `${ENDPOINT}?invite=${"a".repeat(43)}`, ["GET", "POST"]);
  assertEquals(mailer.sent.length, 0);
});

Deno.test("POST makes a 7-day link, stores only its hash, and emails the guarantor", async () => {
  const w = await frozenWorld();
  const res = await call(w.handler, "POST", ENDPOINT, { token: w.claimant.token, body: { claimId: w.claim.id } });
  assertStatus(res, 201);
  const inviteUrl = String(res.body.inviteUrl);
  assertMatch(inviteUrl, /^https:\/\/receivables\.example\.test\/guarantee\?invite=[A-Za-z0-9_-]{43}$/);
  assertEquals(res.body.expiresAt, new Date(FIXED_NOW.getTime() + 7 * 86_400_000).toISOString());
  assertEquals(res.body.emailed, true);

  const token = new URL(inviteUrl).searchParams.get("invite") as string;
  const [invite] = [...w.db.invites.values()];
  assertEquals(invite?.tokenHash, await hashToken(token));
  assert(![...w.db.invites.values()].some((i) => JSON.stringify(i).includes(token)), "raw token must not be stored");

  const [email] = w.mailer.sent;
  assertEquals(email?.to, w.guarantor.profile.email);
  assertEquals(email?.subject, "Ada asked you to sign off on a reimbursement");
  assert(email?.text.includes(inviteUrl));
});

Deno.test("POST needs a frozen packet, the claimant, and a guarantor who is still an officer", async () => {
  const w = await draftWorld();
  const mailer = new MemoryMailer();
  const handler = createInviteHandler({ auth: verifier, db: w.db, mailer, appBaseUrl: "http://x" });
  assertStatus(await call(handler, "POST", ENDPOINT, { token: w.claimant.token, body: { claimId: w.claim.id } }), 409, "not_frozen");

  const f = await frozenWorld();
  assertStatus(await call(f.handler, "POST", ENDPOINT, { token: f.guarantor.token, body: { claimId: f.claim.id } }), 403);
  f.db.officers.set(`1:${f.guarantor.wallet}`, { orgId: 1, wallet: f.guarantor.wallet, title: null, active: false });
  assertStatus(await call(f.handler, "POST", ENDPOINT, { token: f.claimant.token, body: { claimId: f.claim.id } }), 409, "not_officer");
});

Deno.test("a guarantor without an email still gets a link to share", async () => {
  const w = await frozenWorld();
  await w.db.updateProfile(w.guarantor.wallet, { email: null });
  const res = await call(w.handler, "POST", ENDPOINT, { token: w.claimant.token, body: { claimId: w.claim.id } });
  assertEquals([res.status, res.body.emailed], [201, false]);
  assertEquals(w.mailer.sent.length, 0);
});

Deno.test("GET resolves the token for the named guarantor only, until it expires", async () => {
  const w = await frozenWorld();
  const created = await call(w.handler, "POST", ENDPOINT, { token: w.claimant.token, body: { claimId: w.claim.id } });
  const token = new URL(String(created.body.inviteUrl)).searchParams.get("invite");
  const get = (userToken: string) => call(w.handler, "GET", `${ENDPOINT}?invite=${token}`, { token: userToken });

  const res = await get(w.guarantor.token);
  assertStatus(res, 200);
  const claim = res.body.claim as Record<string, unknown>;
  assertEquals([claim.orgName, claim.claimantName, claim.requestedAmount, claim.documentCount], [
    "Blockchain at Berkeley",
    "Ada",
    "400000000",
    1,
  ]);
  assertEquals(res.body.signed, false);
  assertEquals(res.body.signable, true);

  assertStatus(await get(w.claimant.token), 403, "wrong_guarantor");
  assertStatus(await call(w.handler, "GET", `${ENDPOINT}?invite=${"x".repeat(43)}`, { token: w.guarantor.token }), 404);
  w.setNow(new Date(FIXED_NOW.getTime() + 7 * 86_400_000));
  assertStatus(await get(w.guarantor.token), 410, "expired");
});

Deno.test("an outsider can't create an invite for someone else's claim", async () => {
  const w = await frozenWorld();
  const outsider = await makeUser(w.db);
  assertStatus(await call(w.handler, "POST", ENDPOINT, { token: outsider.token, body: { claimId: w.claim.id } }), 403);
});
