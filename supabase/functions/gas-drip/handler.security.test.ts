/**
 * Security campaign E4: can the gas drip hot wallet be drained with throwaway accounts? Each test asserts the safe
 * property.
 */
import type { GasSponsor } from "@app/adapters";
import { assert } from "@std/assert";
import { MemoryDb, call, makeUser, verifier } from "../_shared/testing.ts";
import { createGasDripHandler } from "./handler.ts";

const ENDPOINT = "http://localhost/gas-drip";
const DRIP = 10n ** 15n;

// E-4a (fixed): only KYC-approved members get a drip, so N throwaway emails get nothing
Deno.test({
  name: "E4: fresh unverified accounts can't each pull a drip (sybil)",
  async fn() {
    let sent = 0n;
    const sponsor: GasSponsor = { kind: "drip", ensureGas: () => ((sent += DRIP), Promise.resolve({ funded: true, txHash: `0x${"ab".repeat(32)}` })) };
    const db = new MemoryDb(() => new Date("2026-10-11T09:00:00Z"));
    const handler = createGasDripHandler({ auth: verifier, db, sponsor, amountWei: DRIP });
    for (let i = 0; i < 25; i++) {
      const sybil = await makeUser(db); // kyc not_started
      await call(handler, "POST", ENDPOINT, { token: sybil.token });
    }
    assert(sent <= 5n * DRIP, `25 unverified accounts drained ${sent / DRIP} drips in one day`);
  },
});
