import { type GasSponsor, createMockGasSponsor } from "@app/adapters";
import { assertEquals } from "@std/assert";
import { assertStatus } from "../_shared/fixtures.ts";
import { MemoryDb, assertRejectsBadTokens, call, makeUser, verifier } from "../_shared/testing.ts";
import { createGasDripHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/gas-drip";
const TX = `0x${"ab".repeat(32)}` as const;

function setup(sponsor: GasSponsor = createMockGasSponsor()) {
  let now = new Date("2026-10-11T09:00:00Z");
  const db = new MemoryDb(() => now);
  const handler = createGasDripHandler({ auth: verifier, db, sponsor, amountWei: 10n ** 15n });
  return { db, handler, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

Deno.test("gas-drip rejects requests without a valid Privy token", async () => {
  const sponsor = createMockGasSponsor();
  const { db, handler } = setup(sponsor);
  await assertRejectsBadTokens(handler, ENDPOINT, ["POST"]);
  assertEquals([sponsor.calls.length, db.drips.size], [0, 0]);
});

Deno.test("gas-drip refuses a second top-up for the same wallet within 24 hours (FR-B7)", async () => {
  let sent = 0;
  const sponsor: GasSponsor = {
    kind: "drip",
    ensureGas: () => {
      sent++;
      return Promise.resolve({ funded: true, txHash: TX });
    },
  };
  const { db, handler, advance } = setup(sponsor);
  const user = await makeUser(db, { kyc: "approved" });

  const first = await call(handler, "POST", ENDPOINT, { token: user.token });
  assertStatus(first, 200);
  assertEquals(first.body, { funded: true, txHash: TX });

  advance(23 * 3_600_000 + 59 * 60_000);
  const second = await call(handler, "POST", ENDPOINT, { token: user.token });
  assertStatus(second, 429, "rate_limited");
  assertEquals(sent, 1);
  assertEquals([...db.drips.values()].map((d) => [d.wallet, d.txHash, d.amountWei]), [[user.wallet, TX, 10n ** 15n]]);

  advance(60_000);
  assertStatus(await call(handler, "POST", ENDPOINT, { token: user.token }), 200);
  assertEquals(sent, 2);
});

Deno.test("two simultaneous requests from one wallet send one top-up", async () => {
  let sent = 0;
  const sponsor: GasSponsor = { kind: "drip", ensureGas: () => (sent++, Promise.resolve({ funded: true, txHash: TX })) };
  const { db, handler } = setup(sponsor);
  const user = await makeUser(db, { kyc: "approved" });
  const results = await Promise.all([call(handler, "POST", ENDPOINT, { token: user.token }), call(handler, "POST", ENDPOINT, { token: user.token })]);
  assertEquals(results.map((r) => r.status).sort(), [200, 429]);
  assertEquals(sent, 1);
});

Deno.test("a wallet with enough gas, or a failed send, doesn't use up the day", async () => {
  let mode: "above" | "fail" | "ok" = "above";
  const sponsor: GasSponsor = {
    kind: "drip",
    ensureGas() {
      if (mode === "above") return Promise.resolve({ funded: false, reason: "above_threshold" });
      if (mode === "fail") return Promise.reject(new Error("rpc down"));
      return Promise.resolve({ funded: true, txHash: TX });
    },
  };
  const { db, handler } = setup(sponsor);
  const user = await makeUser(db, { kyc: "approved" });
  const above = await call(handler, "POST", ENDPOINT, { token: user.token });
  assertEquals([above.status, above.body.reason], [200, "above_threshold"]);
  mode = "fail";
  assertStatus(await call(handler, "POST", ENDPOINT, { token: user.token }), 500);
  mode = "ok";
  assertStatus(await call(handler, "POST", ENDPOINT, { token: user.token }), 200);
});

Deno.test("only verified wallets with a profile get gas, and only for their own wallet (E-4a)", async () => {
  const sponsor = createMockGasSponsor();
  const { db, handler } = setup(sponsor);
  const noProfile = await makeUser(db, { profile: false });
  assertStatus(await call(handler, "POST", ENDPOINT, { token: noProfile.token }), 403, "no_profile");
  const user = await makeUser(db, { kyc: "approved" });
  const other = await makeUser(db, { kyc: "approved" });
  assertStatus(await call(handler, "POST", ENDPOINT, { token: user.token, body: { wallet: other.wallet } }), 403, "wallet_mismatch");
  for (const kyc of ["not_started", "pending", "rejected"] as const) {
    const unverified = await makeUser(db, { kyc });
    assertStatus(await call(handler, "POST", ENDPOINT, { token: unverified.token }), 403, "kyc_required");
  }
  assertEquals(sponsor.calls.length, 0);
});
