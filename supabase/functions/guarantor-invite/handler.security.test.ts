/**
 * Guarantor invite links. Each test asserts a safe property.
 */
import { assert, assertEquals } from "@std/assert";
import { assertStatus, draftWorld } from "../_shared/fixtures.ts";
import { MemoryMailer } from "../_shared/mail.ts";
import { FIXED_NOW, call, verifier } from "../_shared/testing.ts";
import { createPacketHandler } from "../packet/handler.ts";
import { createInviteHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/guarantor-invite";

async function frozenWorld() {
  const w = await draftWorld();
  const packet = createPacketHandler({ auth: verifier, db: w.db });
  await call(packet, "POST", "http://localhost/packet", { token: w.claimant.token, body: { claimId: w.claim.id } });
  const mailer = new MemoryMailer();
  const handler = createInviteHandler({ auth: verifier, db: w.db, mailer, appBaseUrl: "https://receivables.example.test/", now: () => FIXED_NOW });
  return { ...w, mailer, handler };
}

Deno.test("the claim an invite shows comes from the frozen claim, not from the request", async () => {
  const w = await frozenWorld();
  const created = await call(w.handler, "POST", ENDPOINT, { token: w.claimant.token, body: { claimId: w.claim.id } });
  const token = new URL(String(created.body.inviteUrl)).searchParams.get("invite");
  const res = await call(w.handler, "GET", `${ENDPOINT}?invite=${token}&requestedAmount=1`, { token: w.guarantor.token });
  assertStatus(res, 200);
  const claim = res.body.claim as Record<string, unknown>;
  assertEquals([claim.requestedAmount, claim.recipientWallet, claim.packetHash], [w.claim.requestedAmount, w.claimant.wallet, (await w.db.getClaim(w.claim.id))?.packetHash]);
});

Deno.test({
  name: "an invite that was used to sign can't be opened again",
  async fn() {
    const w = await frozenWorld();
    const created = await call(w.handler, "POST", ENDPOINT, { token: w.claimant.token, body: { claimId: w.claim.id } });
    const token = new URL(String(created.body.inviteUrl)).searchParams.get("invite");
    const [invite] = [...w.db.invites.values()];
    assert(invite);
    await w.db.markInviteUsed(invite.id);
    assert(w.db.invites.get(invite.id)?.usedAt);
    const res = await call(w.handler, "GET", `${ENDPOINT}?invite=${token}`, { token: w.guarantor.token });
    assert(res.status >= 400, `a used invite answered ${res.status}`);
  },
});

Deno.test({
  name: "a claimant can't send the guarantor an unlimited number of invite emails",
  async fn() {
    const w = await frozenWorld();
    for (let i = 0; i < 20; i++) await call(w.handler, "POST", ENDPOINT, { token: w.claimant.token, body: { claimId: w.claim.id } });
    assert(w.mailer.sent.length <= 3, `${w.mailer.sent.length} emails sent to one guarantor for one claim`);
    assert(w.db.invites.size <= 3, `${w.db.invites.size} live invite links for one claim`);
  },
});
