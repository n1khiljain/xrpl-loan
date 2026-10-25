import { assert, assertEquals } from "@std/assert";
import { assertStatus } from "../_shared/fixtures.ts";
import { FIXED_NOW, MemoryDb, assertRejectsBadTokens, call, makeUser, verifier } from "../_shared/testing.ts";
import { createOrgsHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/orgs";

Deno.test("orgs rejects requests without a valid Privy token", async () => {
  await assertRejectsBadTokens(createOrgsHandler({ auth: verifier, db: new MemoryDb() }), ENDPOINT, ["GET", "POST"]);
});

Deno.test("only admins manage orgs", async () => {
  const db = new MemoryDb(() => FIXED_NOW);
  const handler = createOrgsHandler({ auth: verifier, db });
  for (const role of [undefined, "underwriter", "attester"] as const) {
    const user = await makeUser(db, role ? { staff: role } : {});
    assertStatus(await call(handler, "POST", ENDPOINT, { token: user.token, body: { action: "create", name: "Club" } }), 403);
  }
  assertEquals(db.orgs.size, 0);
});

Deno.test("an admin creates an org, adds an officer, deactivates it, and every change is logged", async () => {
  const db = new MemoryDb(() => FIXED_NOW);
  const handler = createOrgsHandler({ auth: verifier, db });
  const admin = await makeUser(db, { staff: "admin" });
  const officer = await makeUser(db, { name: "Grace" });
  const post = (body: Record<string, unknown>) => call(handler, "POST", ENDPOINT, { token: admin.token, body });

  const created = await post({ action: "create", name: "Blockchain at Berkeley" });
  assertStatus(created, 201);
  const orgId = (created.body.org as { id: number }).id;
  assertStatus(await post({ action: "create", name: "Blockchain at Berkeley" }), 409, "duplicate_org");
  assertStatus(await post({ action: "set-officer", orgId, wallet: officer.wallet, title: "Treasurer", active: true }), 200);
  assertStatus(await post({ action: "set-officer", orgId, wallet: "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY", active: true }), 404);
  assertStatus(await post({ action: "set-officer", orgId: 999, wallet: officer.wallet, active: true }), 404);
  assertStatus(await post({ action: "set-officer", orgId, wallet: "0xabc", active: true }), 400);

  const listed = await call(handler, "GET", ENDPOINT, { token: admin.token });
  const listedOrgs = listed.body.orgs as Array<{ joinCode: string; id: number; name: string; active: boolean; officers: unknown }>;
  const createdOrg = listedOrgs[0];
  assert(createdOrg);
  assert(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(createdOrg.joinCode));
  assertEquals(
    listedOrgs.map((org) => ({ id: org.id, name: org.name, active: org.active, officers: org.officers })),
    [{ id: orgId, name: "Blockchain at Berkeley", active: true, officers: [{ wallet: officer.wallet, title: "Treasurer", displayName: "Grace" }] }],
  );

  assertStatus(await post({ action: "set-active", orgId, active: false }), 200);
  assertEquals(db.orgs.get(orgId)?.active, false);
  assertEquals(db.adminActions.map((a) => a.action), ["org_create", "org_set-officer", "org_set-active"]);
});
