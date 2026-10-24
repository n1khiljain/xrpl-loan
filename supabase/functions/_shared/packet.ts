import { type Hex, keccak256, stringToBytes } from "viem";
import type { Wallet } from "./db/types.ts";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * RFC 8785 JSON Canonicalization Scheme: object keys sorted by UTF-16 code units, no whitespace, ECMAScript number
 * and string serialization. Two packets with the same content always give the same bytes.
 */
export function canonicalize(value: Json): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError("canonical JSON has no NaN or Infinity");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key] as Json)}`).join(",")}}`;
}

/** The claim packet (FR-B4). Only its keccak256 goes onchain (U-20). */
export type ClaimPacket = {
  orgId: number;
  recipient: Wallet;
  /** frxUSD wei as a decimal string */
  faceValue: string;
  callinkPrNumber: string;
  /** SHA-256 of each receipt, lowercase hex, sorted */
  documentHashes: string[];
  /** When the draft was created, ISO 8601 in UTC */
  createdAt: string;
};

export function buildPacket(input: {
  orgId: number;
  recipient: string;
  faceValue: string | bigint;
  callinkPrNumber: string;
  documentHashes: readonly string[];
  createdAt: string | Date;
}): ClaimPacket {
  return {
    orgId: input.orgId,
    recipient: input.recipient.toLowerCase() as Wallet,
    faceValue: BigInt(input.faceValue).toString(),
    callinkPrNumber: input.callinkPrNumber.trim(),
    documentHashes: input.documentHashes.map((h) => h.toLowerCase()).sort(),
    createdAt: new Date(input.createdAt).toISOString(),
  };
}

export function packetHash(packet: ClaimPacket): Hex {
  return keccak256(stringToBytes(canonicalize(packet)));
}
