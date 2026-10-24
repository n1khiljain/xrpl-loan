import { ASSET_DECIMALS } from "@app/config";
import { unitsToValue } from "@app/adapters";

const SCALE = 10n ** BigInt(ASSET_DECIMALS);
const PER_CENT = SCALE / 100n;

/** Base units as dollars: "$1,234.56". Rounds down to the cent, so we never show more than is there. */
export function usd(units: bigint | string | null | undefined): string {
  if (units === null || units === undefined) return "$0.00";
  const value = BigInt(units);
  const negative = value < 0n;
  const cents = (negative ? -value : value) / PER_CENT;
  const whole = (cents / 100n).toLocaleString("en-US");
  const fraction = (cents % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}$${whole}.${fraction}`;
}

/** Base units as a plain number of dollars, for count-up animations. */
export function dollars(units: bigint): number {
  return Number(units / PER_CENT) / 100;
}

/** Parses a dollar amount typed by a person ("1,200.50") into base units, or null if it isn't one. */
export function parseUsd(input: string): bigint | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!new RegExp(`^\\d+(\\.\\d{0,${ASSET_DECIMALS}})?$`).test(cleaned)) return null;
  const [whole = "0", fraction = ""] = cleaned.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(ASSET_DECIMALS, "0") || "0");
}

/** Base units as a plain number string for inputs: "1200.5". */
export function unitsToInput(units: bigint): string {
  return unitsToValue(units);
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

/** Admin and lender screens, and wallet details. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export { amountDue } from "@app/adapters";
