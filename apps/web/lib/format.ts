import { formatUnits, parseUnits } from "viem";

/** frxUSD wei as dollars: "$1,234.56". Rounds down to the cent, so we never show more than is there. */
export function usd(wei: bigint | string | null | undefined): string {
  if (wei === null || wei === undefined) return "$0.00";
  const value = BigInt(wei);
  const negative = value < 0n;
  const cents = (negative ? -value : value) / 10n ** 16n;
  const whole = (cents / 100n).toLocaleString("en-US");
  const fraction = (cents % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}$${whole}.${fraction}`;
}

/** Parses a dollar amount typed by a person ("1,200.50") into wei, or null if it isn't one. */
export function parseUsd(input: string): bigint | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,18})?$/.test(cleaned)) return null;
  return parseUnits(cleaned, 18);
}

/** Wei as a plain number string for inputs: "1200.5". */
export function weiToInput(wei: bigint): string {
  return formatUnits(wei, 18).replace(/\.0$/, "");
}

export function dateFromSeconds(seconds: number | bigint): string {
  return new Date(Number(seconds) * 1000).toLocaleDateString("en-US", { dateStyle: "medium" });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function daysFrom(seconds: number, now = Date.now()): number {
  return Math.ceil((seconds * 1000 - now) / 86_400_000);
}

/** Admin and lender screens only (FR-F8 keeps addresses off claimant screens). */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

const FEE_YEAR_SECONDS = 365n * 86_400n;

/**
 * Amount due on a purchase price after `seconds` with nothing paid: price plus the fee at `feeBps` a year, rounded up
 * in the pool's favor, as ClaimRegistry accrues it (U-84). Paying part of it early lowers the fee after that.
 */
export function amountDue(price: bigint, feeBps: bigint, seconds: number): bigint {
  const denominator = 10_000n * FEE_YEAR_SECONDS;
  const fee = (price * feeBps * BigInt(seconds) + denominator - 1n) / denominator;
  return price + fee;
}
