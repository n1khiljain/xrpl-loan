import { describe, expect, it } from "vitest";
import { amountDue, parseUsd, usd, weiToInput } from "../lib/format";
import { transactionBuilderJson } from "../lib/safe";

const E18 = 10n ** 18n;

describe("money formatting (FR-F8)", () => {
  it("shows dollars and cents, rounded down", () => {
    expect(usd(1234n * E18 + 567n * 10n ** 15n)).toBe("$1,234.56");
    expect(usd(0n)).toBe("$0.00");
    expect(usd("240000000000000000000")).toBe("$240.00");
    expect(usd(1n)).toBe("$0.00");
  });

  it("parses what people type", () => {
    expect(parseUsd("$1,200.50")).toBe(1200n * E18 + 5n * 10n ** 17n);
    expect(parseUsd("240")).toBe(240n * E18);
    expect(parseUsd("abc")).toBeNull();
    expect(parseUsd("1.2.3")).toBeNull();
    expect(weiToInput(240n * E18)).toBe("240");
  });

  it("amount due accrues the yearly fee and rounds it up in the pool's favor, like ClaimRegistry", () => {
    const year = 365 * 86_400;
    expect(amountDue(400n * E18, 0n, year)).toBe(400n * E18);
    expect(amountDue(10_000n, 150n, year)).toBe(10_150n);
    expect(amountDue(10_000n, 150n, year / 2)).toBe(10_075n);
    expect(amountDue(100n, 1n, 1)).toBe(101n);
    expect(amountDue(1_000n * E18, 1_000n, 0)).toBe(1_000n * E18);
  });
});

describe("Transaction Builder export (FR-F7)", () => {
  it("writes a batch file with raw calldata for each transaction", () => {
    const json = transactionBuilderJson(
      [{ to: "0x0000000000000000000000000000000000000001", data: "0xabcdef", value: 0n, label: "Approve" }],
      { name: "Approve claim 1", description: "approveClaim(1)" },
    );
    expect(json).toMatchObject({
      version: "1.0",
      chainId: "31337",
      meta: { name: "Approve claim 1", description: "approveClaim(1)" },
      transactions: [{ to: "0x0000000000000000000000000000000000000001", value: "0", data: "0xabcdef", contractMethod: null, contractInputsValues: null }],
    });
  });
});
