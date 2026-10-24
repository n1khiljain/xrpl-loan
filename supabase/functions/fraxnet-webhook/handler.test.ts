import { assertEquals } from "@std/assert";
import { FIXED_NOW, MemoryDb, call, makeUser, privyToken } from "../_shared/testing.ts";
import { SIGNATURE_HEADER, createWebhookHandler, hmacHex } from "./handler.ts";

const ENDPOINT = "http://localhost/fraxnet-webhook";
const SECRET = crypto.randomUUID();

Deno.test("the webhook rejects requests without a valid HMAC, including ones carrying a Privy token (U-49)", async () => {
  const db = new MemoryDb();
  const user = await makeUser(db);
  const handler = createWebhookHandler({ db, secret: SECRET });
  const body = JSON.stringify({ wallet: user.wallet, status: "approved" });

  const cases: Array<[string, Record<string, string>]> = [
    ["no signature", {}],
    ["wrong signature", { [SIGNATURE_HEADER]: await hmacHex("other-secret", body) }],
    ["a Privy token instead", { authorization: `Bearer ${await privyToken(user.userId)}` }],
    ["signature of a different body", { [SIGNATURE_HEADER]: await hmacHex(SECRET, body + " ") }],
  ];
  for (const [label, headers] of cases) {
    const res = await call(handler, "POST", ENDPOINT, { body, headers });
    assertEquals(res.status, 401, label);
  }
  assertEquals((await db.getProfile(user.wallet))?.kycStatus, "not_started");
});

Deno.test("a signed webhook updates the profile as fraxnet_api", async () => {
  const db = new MemoryDb();
  const user = await makeUser(db);
  const handler = createWebhookHandler({ db, secret: SECRET, now: () => FIXED_NOW });
  const body = JSON.stringify({ wallet: user.account.address, status: "approved", kind: "individual" });
  const res = await call(handler, "POST", ENDPOINT, { body, headers: { [SIGNATURE_HEADER]: await hmacHex(SECRET, body) } });
  assertEquals([res.status, res.body.updated], [200, true]);
  const profile = await db.getProfile(user.wallet);
  assertEquals([profile?.kycStatus, profile?.kycSource, profile?.kycUpdatedBy], ["approved", "fraxnet_api", null]);
});

Deno.test("an unknown wallet is acknowledged without an update; bad payloads are 400", async () => {
  const db = new MemoryDb();
  const handler = createWebhookHandler({ db, secret: SECRET });
  const unknown = JSON.stringify({ wallet: "0x" + "7".repeat(40), status: "approved" });
  const res = await call(handler, "POST", ENDPOINT, { body: unknown, headers: { [SIGNATURE_HEADER]: await hmacHex(SECRET, unknown) } });
  assertEquals([res.status, res.body.updated], [202, false]);
  const bad = JSON.stringify({ wallet: "0x" + "7".repeat(40), status: "verified" });
  const badRes = await call(handler, "POST", ENDPOINT, { body: bad, headers: { [SIGNATURE_HEADER]: await hmacHex(SECRET, bad) } });
  assertEquals(badRes.status, 400);
});

Deno.test("with no FRAXNET_WEBHOOK_SECRET the webhook is off", async () => {
  const res = await call(createWebhookHandler({ db: new MemoryDb(), secret: undefined }), "POST", ENDPOINT, { body: "{}" });
  assertEquals([res.status, res.body.error?.code], [503, "not_configured"]);
});
