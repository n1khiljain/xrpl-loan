import { assertEquals } from "@std/assert";
import { FakeChain } from "../_shared/fake-chain.ts";
import { assertStatus, draftWorld } from "../_shared/fixtures.ts";
import { FIXED_NOW, MemoryDb, assertRejectsBadTokens, call, verifier } from "../_shared/testing.ts";
import { createReportOutcomeHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/report-outcome";

Deno.test("report-outcome rejects requests without a valid Privy token", async () => {
  await assertRejectsBadTokens(createReportOutcomeHandler({ auth: verifier, db: new MemoryDb(), chain: new FakeChain() }), ENDPOINT, ["POST"]);
});

Deno.test("the claimant reports an ASUC outcome on a purchased claim, and it lands in the exceptions list (FR-B11)", async () => {
  const w = await draftWorld();
  await w.db.updateClaim(w.claim.id, { onchainClaimId: 5, statusCache: "Funded" });
  const chain = new FakeChain();
  chain.set(5n, { state: "Funded" });
  const handler = createReportOutcomeHandler({ auth: verifier, db: w.db, chain, now: () => FIXED_NOW });

  const res = await call(handler, "POST", ENDPOINT, {
    token: w.claimant.token,
    body: { claimId: w.claim.id, outcome: "short_paid", note: "ASUC reimbursed $300 of $400" },
  });
  assertStatus(res, 200);
  const claim = await w.db.getClaim(w.claim.id);
  assertEquals([claim?.asucOutcome, claim?.asucOutcomeNote, claim?.asucOutcomeAt], [
    "short_paid",
    "ASUC reimbursed $300 of $400",
    FIXED_NOW.toISOString(),
  ]);
  assertEquals((await w.db.listClaims({ kind: "reported" })).map((c) => c.id), [w.claim.id]);
});

Deno.test("reports need the claimant, an onchain claim, and the Funded state on the chain", async () => {
  const w = await draftWorld();
  const chain = new FakeChain();
  const handler = createReportOutcomeHandler({ auth: verifier, db: w.db, chain });
  const report = (token: string) => call(handler, "POST", ENDPOINT, { token, body: { claimId: w.claim.id, outcome: "rejected" } });
  assertStatus(await report(w.claimant.token), 409, "not_onchain");
  await w.db.updateClaim(w.claim.id, { onchainClaimId: 5, statusCache: "Funded" });
  chain.set(5n, { state: "Settled" });
  assertStatus(await report(w.claimant.token), 409, "not_funded");
  chain.set(5n, { state: "Funded" });
  assertStatus(await report(w.guarantor.token), 403);
  assertStatus(await call(handler, "POST", ENDPOINT, { token: w.claimant.token, body: { claimId: w.claim.id, outcome: "late" } }), 400);
});
