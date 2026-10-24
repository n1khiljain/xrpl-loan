/**
 * Security campaign, workstream E (E2 KYC mapping, E5 cash-out destination). Each test asserts the safe property.
 */
import { type Address, type Hex, createPublicClient, custom, decodeFunctionData, encodeFunctionResult, erc20Abi, maxUint256, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { type FraxNetIdentity, checkLiquidationAddress, createMeshCashOut, oftAbi, verificationFromIdentity } from "../index.ts";

const FROM = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const LIQUIDATION = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const FRXUSD = "0xFc00000000000000000000000000000000000001";
const OFT = "0x1111111111111111111111111111111111111111";

function identity(userId: string, org: Partial<FraxNetIdentity["org"]>): FraxNetIdentity {
  return {
    userId,
    email: null,
    firstName: null,
    lastName: null,
    org: { id: "org_shared", name: "Shared org", verified: true, verifiedAt: "2026-09-18T10:00:00.000Z", isBusiness: false, ...org },
  };
}

describe("E2: verificationFromIdentity", () => {
  it("an unverified or business org stays pending", () => {
    expect(verificationFromIdentity(identity("a", { verified: false })).status).toBe("pending");
    expect(verificationFromIdentity(identity("a", { isBusiness: true })).status).toBe("pending");
  });

  // E-2b (fixed): only isBusiness === false counts as a person; unknown (null) stays pending
  it("an org with unknown isBusiness (null) is not approved as a person", () => {
    expect(verificationFromIdentity(identity("a", { isBusiness: null })).status).not.toBe("approved");
  });
});

/** A Frax Mesh OFT that answers the reads `createMeshCashOut` makes. */
function fakeOft() {
  const transport = custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      if (method === "eth_chainId") return "0xfc";
      if (method !== "eth_call") throw new Error(`unexpected ${method}`);
      const [{ data }] = params as [{ to: Address; data: Hex }];
      const call = decodeFunctionData({ abi: oftAbi, data });
      switch (call.functionName) {
        case "token":
          return encodeFunctionResult({ abi: oftAbi, functionName: "token", result: FRXUSD });
        case "approvalRequired":
          return encodeFunctionResult({ abi: oftAbi, functionName: "approvalRequired", result: true });
        case "sharedDecimals":
          return encodeFunctionResult({ abi: oftAbi, functionName: "sharedDecimals", result: 6 });
        case "quoteOFT": {
          const [p] = call.args;
          return encodeFunctionResult({
            abi: oftAbi,
            functionName: "quoteOFT",
            result: [{ minAmountLD: 0n, maxAmountLD: 2n ** 128n }, [], { amountSentLD: p.amountLD, amountReceivedLD: p.amountLD }],
          });
        }
        case "quoteSend":
          return encodeFunctionResult({ abi: oftAbi, functionName: "quoteSend", result: { nativeFee: 1n, lzTokenFee: 0n } });
        default:
          throw new Error(`unexpected ${call.functionName}`);
      }
    },
  });
  return createMeshCashOut({ publicClient: createPublicClient({ transport }), oft: OFT, frxUSD: FRXUSD });
}

const AMOUNT = 25n * 10n ** 18n;

describe("E5: mesh cash-out destination (components/claim/cash-out.tsx passes free text here)", () => {
  // E-5c (fixed): checkLiquidationAddress uses isAddress strict, so a mistyped checksum is refused
  it("a mistyped checksum is refused", async () => {
    const badChecksum = LIQUIDATION.replace("F", "f") as Address;
    await expect(fakeOft().buildTransfer({ from: FROM, amount: AMOUNT, liquidationAddress: badChecksum })).rejects.toThrow();
  });

  it("approves exactly the amount sent, never an unlimited allowance (regression)", async () => {
    const calls = await fakeOft().buildTransfer({ from: FROM, amount: AMOUNT, liquidationAddress: LIQUIDATION });
    const approve = calls.find((c) => c.to.toLowerCase() === FRXUSD.toLowerCase());
    expect(approve).toBeDefined();
    const decoded = decodeFunctionData({ abi: erc20Abi, data: approve?.data ?? "0x" });
    expect(decoded.functionName).toBe("approve");
    expect(decoded.args?.[1]).toBe(AMOUNT);
    expect(decoded.args?.[1]).not.toBe(maxUint256);
  });

  // E-5c (fixed)
  it("the zero address is refused", async () => {
    await expect(fakeOft().buildTransfer({ from: FROM, amount: AMOUNT, liquidationAddress: zeroAddress })).rejects.toThrow();
  });

  // E-5c (fixed): the known token and bridge contracts are refused. Other contracts on Ethereum can't be detected
  // without an Ethereum RPC, which the app doesn't have.
  it.each([
    ["frxUSD", FRXUSD],
    ["the Mesh OFT", OFT],
  ] as const)("a known contract address (%s) is refused", async (_label, address) => {
    await expect(fakeOft().buildTransfer({ from: FROM, amount: AMOUNT, liquidationAddress: address })).rejects.toThrow();
  });
});

describe("E5: checkLiquidationAddress", () => {
  it("accepts a checksummed or all-lowercase address and returns it checksummed", () => {
    expect(checkLiquidationAddress(LIQUIDATION)).toBe(LIQUIDATION);
    expect(checkLiquidationAddress(` ${LIQUIDATION.toLowerCase()} `)).toBe(LIQUIDATION);
  });

  it.each([["a bad checksum", LIQUIDATION.replace("F", "f")], ["the zero address", zeroAddress], ["too short", "0x1234"], ["text", "my bank"]])(
    "refuses %s",
    (_label, value) => {
      expect(() => checkLiquidationAddress(value)).toThrow(RangeError);
    },
  );
});
