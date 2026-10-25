import { assert, assertEquals } from "@std/assert";
import { assertStatus } from "../_shared/fixtures.ts";
import { MemoryDb, assertRejectsBadTokens, call, makeUser, verifier } from "../_shared/testing.ts";
import { createMembershipHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/membership";

Deno.test("membership rejects requests without a valid Privy token", async () => {
  await assertRejectsBadTokens(createMembershipHandler({ auth: verifier, db: new MemoryDb() }), ENDPOINT, ["POST"]);
});

Deno.test("creating an organization makes a join code, and a teammate joins with it", async () => {
  const db = new MemoryDb();
  const handler = createMembershipHandler({ auth: verifier, db });
  const founder = await makeUser(db, { name: "Ada" });
  const teammate = await makeUser(db, { name: "Grace" });
  const post = (token: string, body: Record<string, unknown>) => call(handler, "POST", ENDPOINT, { token, body });

  assertStatus(await post(founder.token, { action: "create", name: "Northwind", financeAgent: true, roleTitle: "Founder" }), 400, "role_required");
  const created = await post(founder.token, { action: "create", name: "Northwind", financeAgent: true, roleTitle: null });
  assertStatus(created, 201);
  const membership = created.body.membership as { name: string; joinCode: string; financeAgent: boolean; peerFinanceAgents: number };
  assertEquals(membership.name, "Northwind");
  assertEquals(membership.financeAgent, true);
  assertEquals(membership.peerFinanceAgents, 0);
  assert(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(membership.joinCode));

  assertStatus(await post(founder.token, { action: "create", name: "Other", financeAgent: false, roleTitle: "Buyer" }), 409, "already_member");
  assertStatus(await post(teammate.token, { action: "create", name: "Northwind", financeAgent: false, roleTitle: "Buyer" }), 409, "duplicate_org");
  assertStatus(await post(teammate.token, { action: "lookup", joinCode: "not-a-code" }), 400, "bad_join_code");
  assertStatus(await post(teammate.token, { action: "lookup", joinCode: "AAAAAAAA" }), 404);

  const lookedUp = await post(teammate.token, { action: "lookup", joinCode: `${membership.joinCode.slice(0, 4)}-${membership.joinCode.slice(4).toLowerCase()}` });
  assertStatus(lookedUp, 200);
  assertEquals(lookedUp.body.org, { name: "Northwind", joinCode: membership.joinCode });

  const joined = await post(teammate.token, { action: "join", joinCode: membership.joinCode, financeAgent: false, roleTitle: "Bookkeeper" });
  assertStatus(joined, 201);
  const teammateMembership = joined.body.membership as { financeAgent: boolean; roleTitle: string; peerFinanceAgents: number };
  assertEquals(teammateMembership.financeAgent, false);
  assertEquals(teammateMembership.roleTitle, "Bookkeeper");
  assertEquals(teammateMembership.peerFinanceAgents, 1);
  assert((await db.getMember(founder.wallet))?.financeAgent);
});

Deno.test("an inactive organization can't be joined", async () => {
  const db = new MemoryDb();
  const handler = createMembershipHandler({ auth: verifier, db });
  const founder = await makeUser(db, { name: "Ada" });
  const teammate = await makeUser(db, { name: "Grace" });
  const created = await call(handler, "POST", ENDPOINT, {
    token: founder.token,
    body: { action: "create", name: "Paused", financeAgent: false, roleTitle: "Owner" },
  });
  const joinCode = (created.body.membership as { joinCode: string }).joinCode;
  const org = await db.getOrgByJoinCode(joinCode);
  assert(org);
  await db.setOrgActive(org.id, false);
  assertStatus(
    await call(handler, "POST", ENDPOINT, { token: teammate.token, body: { action: "join", joinCode, financeAgent: true, roleTitle: null } }),
    404,
  );
});
