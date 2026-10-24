import { assertEquals } from "@std/assert";
import { FIXED_NOW, MemoryDb, assertRejectsBadTokens, call, makeUser, verifier } from "../_shared/testing.ts";
import { createKycManualHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/kyc-manual";

function setup() {
  const db = new MemoryDb();
  return { db, handler: createKycManualHandler({ auth: verifier, db, now: () => FIXED_NOW }) };
}

Deno.test("kyc-manual rejects requests without a valid Privy token", async () => {
  const { db, handler } = setup();
  await assertRejectsBadTokens(handler, ENDPOINT, ["POST"]);
  assertEquals(db.adminActions.length, 0);
});

Deno.test("only an underwriter can set a status", async () => {
  const { db, handler } = setup();
  const target = await makeUser(db);
  for (const role of [undefined, "attester", "admin"] as const) {
    const caller = await makeUser(db, role ? { staff: role } : {});
    const res = await call(handler, "POST", ENDPOINT, {
      token: caller.token,
      body: { wallet: target.wallet, status: "approved", note: "confirmed with Frax" },
    });
    assertEquals(res.status, 403, `role ${role}`);
  }
  assertEquals((await db.getProfile(target.wallet))?.kycStatus, "not_started");
});

Deno.test("an underwriter's change is stored as manual and logged with who, when, and why (FR-B6)", async () => {
  const { db, handler } = setup();
  const underwriter = await makeUser(db, { staff: "underwriter" });
  const target = await makeUser(db);
  const res = await call(handler, "POST", ENDPOINT, {
    token: underwriter.token,
    body: { wallet: target.account.address, status: "approved", note: "Frax confirmed on 10/10 by email" },
  });
  assertEquals(res.status, 200);
  const profile = await db.getProfile(target.wallet);
  assertEquals(
    [profile?.kycStatus, profile?.kycSource, profile?.kycUpdatedBy, profile?.kycUpdatedAt],
    ["approved", "manual", underwriter.wallet, FIXED_NOW.toISOString()],
  );
  assertEquals(db.adminActions, [
    {
      actorWallet: underwriter.wallet,
      action: "kyc_manual",
      target: target.wallet,
      payload: { from: "not_started", to: "approved", note: "Frax confirmed on 10/10 by email", at: FIXED_NOW.toISOString() },
    },
  ]);
});

Deno.test("kyc-manual needs a note and an existing profile", async () => {
  const { db, handler } = setup();
  const underwriter = await makeUser(db, { staff: "underwriter" });
  const noNote = await call(handler, "POST", ENDPOINT, { token: underwriter.token, body: { wallet: underwriter.wallet, status: "approved", note: " " } });
  assertEquals(noNote.status, 400);
  const missing = await call(handler, "POST", ENDPOINT, {
    token: underwriter.token,
    body: { wallet: "0x" + "9".repeat(40), status: "approved", note: "x" },
  });
  assertEquals(missing.status, 404);
});
