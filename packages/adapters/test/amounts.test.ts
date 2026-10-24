import { describe, expect, it } from "vitest";
import { dropsToXrp, unitsToValue, valueToUnits } from "../index.ts";

describe("unitsToValue", () => {
  it.each([
    [1_250_500_000n, "1250.5"],
    [1n, "0.000001"],
    [0n, "0"],
    [-2_000_000n, "-2"],
  ])("%s -> %s", (units, value) => expect(unitsToValue(units)).toBe(value));
});

describe("valueToUnits", () => {
  it.each([
    ["1250.5", 1_250_500_000n],
    ["0.000001", 1n],
    ["1.25e3", 1_250_000_000n],
    ["5e-7", 0n],
    ["-3", -3_000_000n],
    ["100", 100_000_000n],
  ])("%s -> %s", (value, units) => expect(valueToUnits(value)).toBe(units));

  it("round-trips", () => {
    for (const units of [1n, 999_999n, 123_456_789_012n]) expect(valueToUnits(unitsToValue(units))).toBe(units);
  });

  it("refuses text", () => expect(() => valueToUnits("abc")).toThrow(RangeError));
});

describe("dropsToXrp", () => {
  it("formats drops", () => {
    expect(dropsToXrp("100000000")).toBe("100");
    expect(dropsToXrp(1_500_000n)).toBe("1.5");
  });
});
