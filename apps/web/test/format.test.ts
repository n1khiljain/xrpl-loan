import { describe, expect, it } from "vitest";
import { amountDue, parseUsd, unitsToInput, usd } from "../lib/format";

const USD = 1_000_000n;

describe("money formatting", () => {
  it("shows dollars and cents, rounded down", () => {
    expect(usd(1234n * USD + 567_000n)).toBe("$1,234.56");
    expect(usd(0n)).toBe("$0.00");
    expect(usd("240000000")).toBe("$240.00");
    expect(usd(1n)).toBe("$0.00");
  });

  it("parses what people type", () => {
    expect(parseUsd("$1,200.50")).toBe(1200n * USD + 500_000n);
    expect(parseUsd("240")).toBe(240n * USD);
    expect(parseUsd("abc")).toBeNull();
    expect(parseUsd("1.2.3")).toBeNull();
    expect(parseUsd("1.1234567")).toBeNull();
    expect(unitsToInput(240n * USD)).toBe("240");
  });

  it("amount due accrues the yearly fee and rounds it up", () => {
    const year = 365 * 86_400;
    expect(amountDue(400n * USD, 0n, year)).toBe(400n * USD);
    expect(amountDue(10_000n, 150n, year)).toBe(10_150n);
    expect(amountDue(10_000n, 150n, year / 2)).toBe(10_075n);
    expect(amountDue(100n, 1n, 1)).toBe(101n);
  });
});
