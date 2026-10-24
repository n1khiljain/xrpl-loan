import { describe, expect, it } from "vitest";
import {
  claimNftAbi,
  claimRegistryAbi,
  mockFrxUsdAbi,
  orgRegistryAbi,
  receivablesPoolAbi,
} from "../src/index.ts";

type AbiItem = { type: string; name?: string };

function names(abi: readonly AbiItem[], type: string): string[] {
  return abi.filter((item) => item.type === type).map((item) => item.name ?? "");
}

const ALL = { claimRegistryAbi, receivablesPoolAbi, claimNftAbi, orgRegistryAbi, mockFrxUsdAbi };

describe("generated ABIs", () => {
  it("ClaimRegistry exposes the section 7 functions and the events apps rebuild state from", () => {
    expect(names(claimRegistryAbi, "function")).toEqual(
      expect.arrayContaining([
        "submitClaim",
        "cancelClaim",
        "approveClaim",
        "rejectClaim",
        "purchaseClaim",
        "settle",
        "callGuarantor",
        "writeOff",
        "setParams",
        "pause",
        "unpause",
        "getClaim",
        "guarantyDigest",
        "nonces",
      ]),
    );
    expect(names(claimRegistryAbi, "event")).toEqual(
      expect.arrayContaining([
        "ClaimSubmitted",
        "ClaimCancelled",
        "ClaimApproved",
        "ClaimRejected",
        "ClaimPurchased",
        "ClaimSettlementPaid",
        "ClaimSettled",
        "GuarantorCalled",
        "ClaimRecovered",
        "ClaimWrittenOff",
        "ParamsUpdated",
      ]),
    );
    expect(names(claimRegistryAbi, "error")).toEqual(expect.arrayContaining(["InvalidState", "InvalidGuaranty"]));
  });

  it("ReceivablesPool is an ERC-4626 vault with the pool views", () => {
    expect(names(receivablesPoolAbi, "function")).toEqual(
      expect.arrayContaining(["deposit", "withdraw", "redeem", "totalAssets", "idleCash", "outstandingPrincipal", "totalLosses"]),
    );
  });

  it("the other contracts are present", () => {
    expect(names(claimNftAbi, "function")).toContain("tokenURI");
    expect(names(orgRegistryAbi, "function")).toEqual(expect.arrayContaining(["orgName", "orgCount", "isActiveOfficer"]));
    expect(names(mockFrxUsdAbi, "function")).toContain("mint");
  });

  it("no ABI names use loan language (U-09)", () => {
    for (const [label, abi] of Object.entries(ALL)) {
      const words = (abi as readonly AbiItem[]).map((item) => item.name ?? "").join(" ");
      expect(words, label).not.toMatch(/loan|borrow|interest|repay/i);
    }
  });
});
