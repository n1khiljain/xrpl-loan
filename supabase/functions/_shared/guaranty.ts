import type { Address, Hex } from "viem";

/** Matches `ClaimRegistry`'s EIP712("FraxCollegeClaimRegistry", "1") and GUARANTY_TYPEHASH (FR-C7). */
export const GUARANTY_DOMAIN = { name: "FraxCollegeClaimRegistry", version: "1" } as const;

export const GUARANTY_TYPES = {
  Guaranty: [
    { name: "guarantor", type: "address" },
    { name: "recipient", type: "address" },
    { name: "orgId", type: "uint64" },
    { name: "faceValue", type: "uint128" },
    { name: "requestedAmount", type: "uint128" },
    { name: "packetHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** How long a guaranty signature can wait before the claimant submits it. UNCERTAIN: U-55 */
export const GUARANTY_TTL_SECONDS = 7 * 24 * 60 * 60;

export type GuarantyMessage = {
  guarantor: Address;
  recipient: Address;
  orgId: bigint;
  faceValue: bigint;
  requestedAmount: bigint;
  packetHash: Hex;
  nonce: bigint;
  deadline: bigint;
};

export function guarantyTypedData(p: { chainId: number; registry: Address; message: GuarantyMessage }) {
  return {
    domain: { ...GUARANTY_DOMAIN, chainId: p.chainId, verifyingContract: p.registry },
    types: GUARANTY_TYPES,
    primaryType: "Guaranty" as const,
    message: p.message,
  };
}

export type GuarantyTypedData = ReturnType<typeof guarantyTypedData>;
