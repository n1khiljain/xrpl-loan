import type { Wallet } from "./db/types.ts";
import { sha256Hex } from "./storage.ts";

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

/** The frozen claim packet. Its SHA-256 is the claim's fingerprint; the documents themselves stay private. */
export type ClaimPacket = {
  orgId: number;
  recipient: Wallet;
  /** base units as a decimal string */
  faceValue: string;
  callinkPrNumber: string;
  /** SHA-256 of each document, lowercase hex, sorted */
  documentHashes: string[];
  /** When the draft was created, ISO 8601 in UTC */
  createdAt: string;
};

export function buildPacket(input: {
  orgId: number;
  recipient: Wallet;
  faceValue: string | bigint;
  callinkPrNumber: string;
  documentHashes: readonly string[];
  createdAt: string | Date;
}): ClaimPacket {
  return {
    orgId: input.orgId,
    recipient: input.recipient,
    faceValue: BigInt(input.faceValue).toString(),
    callinkPrNumber: input.callinkPrNumber.trim(),
    documentHashes: input.documentHashes.map((h) => h.toLowerCase()).sort(),
    createdAt: new Date(input.createdAt).toISOString(),
  };
}

export function packetHash(packet: ClaimPacket): Promise<string> {
  return sha256Hex(new TextEncoder().encode(canonicalize(packet)));
}
