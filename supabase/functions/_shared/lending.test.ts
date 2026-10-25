import { assertEquals } from "@std/assert";
import type { NetworkConfig } from "@app/config";
import { FakeLedger } from "./ledger.ts";
import { type VaultSeries, canLend, depositSeries, listSeries, pickLendingSeries } from "./lending.ts";
import { FIXED_NOW, seedSeries, testConfig } from "./testing.ts";

const UNIX = Math.floor(FIXED_NOW.getTime() / 1000);
const DAY = 86_400;
const BROKER = "rwCXRKLfC1vzqkUXfNnuMsA7geg2z6NXF3";
const ISSUER = "rKTyLjvRtmPurChodfDUWce8f2RCpUDpXA";

function config(): NetworkConfig {
  const base = testConfig();
  return {
    ...base,
    asset: { ...base.asset, issuer: ISSUER },
    ledger: { broker: BROKER, credentialIssuer: BROKER, credentialType: "496E7374616C6C", domainId: "A".repeat(64), repaymentAccount: BROKER },
  };
}

const id = (n: number) => String(n).repeat(64);

Deno.test("listSeries reads the broker's vaults, skips ones without a loan broker or in another asset, and sets phases", async () => {
  const cfg = config();
  const ledger = new FakeLedger();
  seedSeries(ledger, cfg, [
    { vaultId: id(1), subscriptionAt: UNIX - 10, redemptionAt: UNIX + 200 * DAY, assetsTotal: "25000", assetsAvailable: "20000", debtTotal: "5000", coverAvailable: "5000" },
    { vaultId: id(2), subscriptionAt: UNIX + DAY, redemptionAt: UNIX + 201 * DAY },
    { vaultId: id(3), subscriptionAt: UNIX - 300 * DAY, redemptionAt: UNIX - 10 },
    { vaultId: id(4), subscriptionAt: UNIX - 10, redemptionAt: UNIX + 100 * DAY, loanBroker: false },
    { vaultId: id(5), subscriptionAt: UNIX - 10, redemptionAt: UNIX + 100 * DAY, currency: "USD" },
  ]);
  const series = await listSeries(ledger, cfg, UNIX);
  assertEquals(series.map((s) => [s.vaultId, s.phase]), [[id(3), "closed"], [id(1), "lending"], [id(2), "subscription"]]);
  const lending = series.find((s) => s.vaultId === id(1));
  assertEquals(
    [lending?.assetsTotal, lending?.assetsAvailable, lending?.debtTotal, lending?.coverAvailable, lending?.loanBrokerId],
    ["25000000000", "20000000000", "5000000000", "5000000000", `B${id(1).slice(1)}`],
  );
  assertEquals(depositSeries(series).map((s) => s.vaultId), [id(2)]);
});

function series(over: Partial<VaultSeries>): VaultSeries {
  return {
    vaultId: id(1),
    loanBrokerId: "C".repeat(64),
    shareMptId: null,
    phase: "lending",
    subscriptionAt: UNIX - 10,
    redemptionAt: UNIX + 200 * DAY,
    assetsTotal: "10000000000",
    assetsAvailable: "10000000000",
    lossUnrealized: "0",
    debtTotal: "0",
    coverAvailable: "0",
    ...over,
  };
}

Deno.test("canLend needs a lending series with a loan broker whose payout is at least 60 seconds after the loan is due", () => {
  const s = series({ redemptionAt: UNIX + 30 * DAY + 60 });
  assertEquals(canLend(s, 30 * DAY, UNIX), true);
  assertEquals(canLend(s, 30 * DAY + 1, UNIX), false);
  assertEquals(canLend(series({ phase: "subscription" }), DAY, UNIX), false);
  assertEquals(canLend(series({ loanBrokerId: null }), DAY, UNIX), false);
});

Deno.test("pickLendingSeries takes the soonest payout that fits the term and has the principal, or nothing", () => {
  const soon = series({ vaultId: id(1), redemptionAt: UNIX + 40 * DAY });
  const later = series({ vaultId: id(2), redemptionAt: UNIX + 200 * DAY });
  const poor = series({ vaultId: id(3), redemptionAt: UNIX + 35 * DAY, assetsAvailable: "1000000" });
  const all = [later, poor, soon];
  assertEquals(pickLendingSeries(all, 1_000_000_000n, 30 * DAY, UNIX)?.vaultId, id(1));
  assertEquals(pickLendingSeries(all, 1_000_000_000n, 100 * DAY, UNIX)?.vaultId, id(2));
  assertEquals(pickLendingSeries(all, 1_000_000_000n, 300 * DAY, UNIX), null);
  assertEquals(pickLendingSeries(all, 50_000_000_000n, DAY, UNIX), null);
});

Deno.test("waitForAccount waits for a just-funded wallet, and gives up on one that never appears", async () => {
  const { FakeLedger } = await import("./ledger.ts");
  const { waitForAccount } = await import("./lending.ts");
  const ledger = new FakeLedger();
  const address = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh" as const;
  setTimeout(() => ledger.balanceOf.set(address, { exists: true, xrpDrops: "100000000", asset: null }), 30);
  const found = await waitForAccount(ledger, address, 10, 20);
  if (!found.exists) throw new Error("should have waited for the account");
  const never = await waitForAccount(ledger, "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY", 3, 5);
  if (never.exists) throw new Error("should have given up");
});
