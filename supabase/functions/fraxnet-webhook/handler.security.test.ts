/**
 * Security campaign E2: can a captured FraxNet webhook restore revoked KYC? Each test asserts the safe property.
 */
import { assertEquals } from "@std/assert";
import { FIXED_NOW, MemoryDb, call, makeUser } from "../_shared/testing.ts";
import { SIGNATURE_HEADER, createWebhookHandler, hmacHex } from "./handler.ts";

const ENDPOINT = "http://localhost/fraxnet-webhook";
const SECRET = crypto.randomUUID();

async function send(handler: ReturnType<typeof createWebhookHandler>, body: string) {
  return await call(handler, "POST", ENDPOINT, { body, headers: { [SIGNATURE_HEADER]: await hmacHex(SECRET, body) } });
}

// E-2c (fixed): the signed body has no event id, nonce or timestamp, so the handler keeps each body's HMAC and
// refuses it the second time
Deno.test({
  name: "E2: the exact same signed delivery is accepted only once",
  async fn() {
    const db = new MemoryDb();
    const user = await makeUser(db);
    const handler = createWebhookHandler({ db, secret: SECRET, now: () => FIXED_NOW });
    const body = JSON.stringify({ wallet: user.wallet, status: "approved" });
    assertEquals((await send(handler, body)).status, 200);
    const replay = await send(handler, body);
    assertEquals(replay.status >= 400, true, `replay answered ${replay.status}`);
  },
});

// E-2c (fixed): replaying a captured "approved" after FraxNet sent "rejected" changes nothing
Deno.test({
  name: "E2: an old 'approved' delivery replayed after a newer 'rejected' does not restore KYC",
  async fn() {
    const db = new MemoryDb();
    const user = await makeUser(db);
    const handler = createWebhookHandler({ db, secret: SECRET, now: () => FIXED_NOW });
    const approved = JSON.stringify({ wallet: user.wallet, status: "approved", approvedAt: "2026-10-01T00:00:00.000Z" });
    const rejected = JSON.stringify({ wallet: user.wallet, status: "rejected" });
    await send(handler, approved);
    await send(handler, rejected);
    assertEquals((await db.getProfile(user.wallet))?.kycStatus, "rejected");
    await send(handler, approved); // attacker replays the captured body and signature
    assertEquals((await db.getProfile(user.wallet))?.kycStatus, "rejected");
  },
});

// E-2d (fixed): a webhook never overwrites an underwriter's manual rejection
Deno.test({
  name: "E2: a webhook does not override an underwriter's manual rejection",
  async fn() {
    const db = new MemoryDb();
    const underwriter = await makeUser(db, { staff: "underwriter" });
    const user = await makeUser(db);
    await db.updateProfile(user.wallet, { kycStatus: "rejected", kycSource: "manual", kycUpdatedBy: underwriter.wallet, kycUpdatedAt: FIXED_NOW.toISOString() });
    const handler = createWebhookHandler({ db, secret: SECRET, now: () => FIXED_NOW });
    await send(handler, JSON.stringify({ wallet: user.wallet, status: "approved" }));
    assertEquals((await db.getProfile(user.wallet))?.kycStatus, "rejected");
  },
});
