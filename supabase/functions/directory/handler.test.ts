import { assertEquals } from "@std/assert";
import { assertStatus } from "../_shared/fixtures.ts";
import { MemoryDb, assertRejectsBadTokens, call, makeUser, seedOrg, verifier } from "../_shared/testing.ts";
import { createDirectoryHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/directory";

Deno.test("directory rejects requests without a valid Privy token", async () => {
  await assertRejectsBadTokens(createDirectoryHandler({ auth: verifier, db: new MemoryDb() }), `${ENDPOINT}?view=orgs`, ["GET"]);
});

Deno.test("view=orgs lists active orgs with active officers' names", async () => {
  const db = new MemoryDb();
  const viewer = await makeUser(db);
  const officer = await makeUser(db, { name: "Grace" });
  const former = await makeUser(db, { name: "Former" });
  seedOrg(db, 1, "Blockchain at Berkeley", [officer.wallet, former.wallet]);
  db.officers.set(`1:${former.wallet}`, { orgId: 1, wallet: former.wallet, title: null, active: false });
  db.orgs.set(2, { id: 2, name: "Dormant Club", active: false, joinCode: "DORMANT2" });
  const res = await call(createDirectoryHandler({ auth: verifier, db }), "GET", `${ENDPOINT}?view=orgs`, { token: viewer.token });
  assertStatus(res, 200);
  assertEquals(res.body.orgs, [
    { id: 1, name: "Blockchain at Berkeley", active: true, officers: [{ wallet: officer.wallet, title: "Treasurer", displayName: "Grace" }] },
  ]);
});

Deno.test("view=people is staff-only and returns names and KYC status", async () => {
  const db = new MemoryDb();
  const staff = await makeUser(db, { staff: "underwriter" });
  const member = await makeUser(db, { name: "Ada" });
  await db.updateProfile(member.wallet, { kycStatus: "pending", kycSource: "manual", kycUpdatedBy: staff.wallet });
  const handler = createDirectoryHandler({ auth: verifier, db });
  const stranger = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
  assertStatus(await call(handler, "GET", `${ENDPOINT}?view=people&wallets=${member.wallet}`, { token: member.token }), 403);
  const res = await call(handler, "GET", `${ENDPOINT}?view=people&wallets=${member.wallet},${stranger}`, { token: staff.token });
  assertEquals(res.body.people, [
    { wallet: member.wallet, hasProfile: true, displayName: "Ada", kycStatus: "pending" },
    { wallet: stranger, hasProfile: false, displayName: null, kycStatus: null },
  ]);
  assertStatus(await call(handler, "GET", `${ENDPOINT}?view=secrets`, { token: staff.token }), 400);
});
