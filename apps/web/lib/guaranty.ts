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

/** How long a guaranty signature can wait before the claimant submits it. Same as the server's. UNCERTAIN: U-55 */
export const GUARANTY_TTL_SECONDS = 7 * 24 * 60 * 60;

/** The claim fields a guaranty binds, as the invite shows them. */
export type GuarantyClaim = {
  recipientWallet: Address;
  orgId: number;
  faceValue: string;
  requestedAmount: string;
  packetHash: Hex;
};

/**
 * The guaranty the officer signs, built in the browser: the domain from the network config and the deployed
 * registry, the terms from the claim the page displays, the guarantor from the signed-in wallet (security campaign
 * E-3a). Only the nonce comes from the server, and a wrong one just makes the signature unusable.
 */
export function guarantyTypedData(p: {
  chainId: number;
  registry: Address;
  guarantor: Address;
  claim: GuarantyClaim;
  nonce: bigint;
  deadline: bigint;
}) {
  return {
    domain: { ...GUARANTY_DOMAIN, chainId: p.chainId, verifyingContract: p.registry },
    types: GUARANTY_TYPES,
    primaryType: "Guaranty" as const,
    message: {
      guarantor: p.guarantor,
      recipient: p.claim.recipientWallet,
      orgId: BigInt(p.claim.orgId),
      faceValue: BigInt(p.claim.faceValue),
      requestedAmount: BigInt(p.claim.requestedAmount),
      packetHash: p.claim.packetHash,
      nonce: p.nonce,
      deadline: p.deadline,
    },
  };
}
