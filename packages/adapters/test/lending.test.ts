import { describe, expect, it } from "vitest";
import { ceilToUnits } from "../shared/amounts.ts";
import {
  COVER_UNITS,
  CREDENTIAL_TYPE_HEX,
  REDEMPTION_BUFFER_SECONDS,
  SUBSCRIPTION_SECONDS,
  VAULT_LIFE_SECONDS,
  amountDue,
  createdNodeId,
  interestRateTenths,
  principalUnits,
  rippleTime,
  unixTime,
  vaultCapacityUnits,
  vaultPhase,
} from "../shared/lending.ts";

describe("lending terms", () => {
  it("encodes the Install credential and the 5% rate the ledger expects", () => {
    expect(CREDENTIAL_TYPE_HEX).toBe("496E7374616C6C");
    expect(interestRateTenths(500)).toBe(5_000);
    expect(principalUnits(350_000_000n, 10_000)).toBe(350_000_000n);
    expect(principalUnits(100n, 8_000)).toBe(80n);
  });

  it("prorates a year of interest and rounds up", () => {
    const year = 365 * 86_400;
    expect(amountDue(400n * 1_000_000n, 0n, year)).toBe(400n * 1_000_000n);
    expect(amountDue(10_000n, 150n, year)).toBe(10_150n);
    expect(amountDue(10_000n, 150n, year / 2)).toBe(10_075n);
    expect(amountDue(100n, 1n, 1)).toBe(101n);
  });

  it("leaves a year of interest above the deposit cap so a full vault can still lend", () => {
    expect(vaultCapacityUnits(50_000_000_000n, 500)).toBe(52_500_000_000n);
    expect(COVER_UNITS).toBe(5_000_000_000n);
  });

  it("rounds a loan payment up past the sixth decimal", () => {
    expect(ceilToUnits("350")).toBe(350_000_000n);
    expect(ceilToUnits("1.0000001")).toBe(1_000_001n);
    expect(ceilToUnits("5e-7")).toBe(1n);
  });
});

describe("vault phase", () => {
  const start = 1_800_000_000;
  const subscription = start + SUBSCRIPTION_SECONDS;
  const redemption = start + VAULT_LIFE_SECONDS;
  const term = 180 * 24 * 60 * 60;

  it("takes deposits first, then loans, then neither", () => {
    expect(vaultPhase(start, subscription, redemption, term)).toBe("subscription");
    expect(vaultPhase(subscription - 1, subscription, redemption, term)).toBe("subscription");
    expect(vaultPhase(subscription + 1, subscription, redemption, term)).toBe("lending");
    const last = redemption - term - REDEMPTION_BUFFER_SECONDS;
    expect(vaultPhase(last, subscription, redemption, term)).toBe("lending");
    expect(vaultPhase(last + 1, subscription, redemption, term)).toBe("closed");
  });

  it("converts ripple time", () => {
    expect(unixTime(rippleTime(start))).toBe(start);
  });
});

describe("createdNodeId", () => {
  it("reads the loan id out of transaction metadata", () => {
    const id = "A".repeat(64);
    expect(
      createdNodeId(
        { AffectedNodes: [{ CreatedNode: { LedgerEntryType: "Loan", LedgerIndex: id } }] },
        "Loan",
      ),
    ).toBe(id);
    expect(createdNodeId({ AffectedNodes: [] }, "Loan")).toBeNull();
    expect(createdNodeId(null, "Loan")).toBeNull();
  });
});
