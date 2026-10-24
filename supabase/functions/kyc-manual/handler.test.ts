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
  await assertRejectsBadTokens(handler, ENDPOINT, ["GET", "POST"]);
  assertEquals(db.adminActions.length, 0);
});

Deno.test("only an underwriter or admin can set a status", async () => {
  const { db, handler } = setup();
  const target = await makeUser(db);
  for (const role of [undefined, "attester"] as const) {
    const caller = await makeUser(db, role ? { staff: role } : {});
    const res = await call(handler, "POST", ENDPOINT, {
      token: caller.token,
      body: { wallet: target.wallet, status: "approved", note: "checked their ID" },
    });
    assertEquals(res.status, 403, `role ${role}`);
  }
  assertEquals((await db.getProfile(target.wallet))?.kycStatus, "not_started");
});

Deno.test("an underwriter's change is stored as manual and logged with who, when, and why ", async () => {
  const { db, handler } = setup();
  const underwriter = await makeUser(db, { staff: "underwriter" });
  const target = await makeUser(db);
  await db.updateProfile(target.wallet, { kycStatus: "pending" });
  const res = await call(handler, "POST", ENDPOINT, {
    token: underwriter.token,
    body: { wallet: target.wallet, status: "approved", note: "ID checked on a call 10/10" },
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
      payload: { from: "pending", to: "approved", note: "ID checked on a call 10/10", at: FIXED_NOW.toISOString() },
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
    body: { wallet: "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY", status: "approved", note: "x" },
  });
  assertEquals(missing.status, 404);
});

Deno.test("approval needs a verified email", async () => {
  const { db, handler } = setup();
  const underwriter = await makeUser(db, { staff: "underwriter" });
  const target = await makeUser(db);
  await db.updateProfile(target.wallet, { emailVerified: false });
  const res = await call(handler, "POST", ENDPOINT, { token: underwriter.token, body: { wallet: target.wallet, status: "approved", note: "x" } });
  assertEquals([res.status, res.body.error?.code], [409, "email_unverified"]);
});

Deno.test("GET lists people and their KYC status for staff only", async () => {
  const { db, handler } = setup();
  const admin = await makeUser(db, { staff: "admin" });
  const member = await makeUser(db, { name: "Ada" });
  await db.updateProfile(member.wallet, { kycStatus: "pending" });
  assertEquals((await call(handler, "GET", ENDPOINT, { token: member.token })).status, 403);
  const res = await call(handler, "GET", ENDPOINT, { token: admin.token });
  const people = res.body.people as Array<{ wallet: string; kycStatus: string; emailVerified: boolean }>;
  const ada = people.find((p) => p.wallet === member.wallet);
  assertEquals([ada?.kycStatus, ada?.emailVerified], ["pending", true]);
});

Deno.test("approval issues the vault credential, and a failed credential still leaves them approved", async () => {
  const db = new MemoryDb();
  const target = await makeUser(db);
  const staff = await makeUser(db, { staff: "underwriter" });
  const issued: string[] = [];
  const handler = createKycManualHandler({
    auth: verifier,
    db,
    now: () => FIXED_NOW,
    issueCredential: async (wallet) => {
      issued.push(wallet);
    },
  });
  const approved = await call(handler, "POST", ENDPOINT, {
    token: staff.token,
    body: { wallet: target.wallet, status: "approved", note: "checked their ID" },
  });
  assertEquals(approved.status, 200);
  assertEquals(issued, [target.wallet]);

  const failing = createKycManualHandler({
    auth: verifier,
    db,
    now: () => FIXED_NOW,
    issueCredential: () => Promise.reject(new Error("ledger down")),
  });
  const again = await call(failing, "POST", ENDPOINT, {
    token: staff.token,
    body: { wallet: target.wallet, status: "approved", note: "checked their ID" },
  });
  assertEquals(again.status, 409);
  assertEquals(again.body.error?.code, "credential_failed");
  assertEquals((await db.getProfile(target.wallet))?.kycStatus, "approved");
});
