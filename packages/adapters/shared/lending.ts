import { unitsToValue } from "./amounts.ts";

/** Ripple epoch is 2000-01-01T00:00:00Z. Ledger times are seconds since then; unix times are seconds since 1970. */
export const RIPPLE_EPOCH_OFFSET = 946_684_800;

/** For a closed-ended vault (`pnpm xrpl:setup --closed`): deposits are open this long after it's created, and loans can't start until then. */
export const SUBSCRIPTION_SECONDS = 90 * 24 * 60 * 60;

/** The vault redeems this long after it is created. A loan's last payment has to land before then. */
export const VAULT_LIFE_SECONDS = 365 * 24 * 60 * 60;

/** LendingProtocolV1_1 refuses a loan whose final payment is inside this many seconds of redemption. */
export const REDEMPTION_BUFFER_SECONDS = 60;

/**
 * First-loss cover, in tenths of a basis point. 10_000 is 10% of outstanding debt (including interest).
 * Liquidation is 100% so a default can use that whole cushion. Both have to be zero or both non-zero.
 */
export const COVER_RATE_MINIMUM = 10_000;
export const COVER_RATE_LIQUIDATION = 100_000;

/** 5,000 RLUSD, which is 10% of the 50,000 deposit cap. */
export const COVER_UNITS = 5_000_000_000n;

/** Stand-in RLUSD a verified person can draw on Devnet, so a deposit has something to deposit. */
export const TEST_DRAW_UNITS = 1_000_000_000n;

/** Credential type text "Install", as the hex the ledger stores. */
export const CREDENTIAL_LABEL = "Install";
export const CREDENTIAL_TYPE_HEX = [...new TextEncoder().encode(CREDENTIAL_LABEL)]
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join("")
  .toUpperCase();

const FEE_YEAR_SECONDS = 365n * 86_400n;

export function rippleTime(unixSeconds: number): number {
  return unixSeconds - RIPPLE_EPOCH_OFFSET;
}

export function unixTime(rippleSeconds: number): number {
  return rippleSeconds + RIPPLE_EPOCH_OFFSET;
}

/** `feeBps` is basis points. The ledger's InterestRate field is tenths of a basis point, so 5% is 5000. */
export function interestRateTenths(feeBps: number): number {
  return feeBps * 10;
}

/** What the borrower receives: the approved amount times the advance rate. */
export function principalUnits(approvedUnits: bigint, advanceRateBps: number): bigint {
  return (approvedUnits * BigInt(advanceRateBps)) / 10_000n;
}

/**
 * Amount due on a principal after `seconds` with nothing paid: principal plus the yearly interest at `feeBps`,
 * rounded up. A shorter loan costs less.
 */
export function amountDue(price: bigint, feeBps: bigint, seconds: number): bigint {
  const denominator = 10_000n * FEE_YEAR_SECONDS;
  const interest = (price * feeBps * BigInt(seconds) + denominator - 1n) / denominator;
  return price + interest;
}

/**
 * The ledger counts a loan's expected interest against the vault's maximum and the broker's debt maximum.
 * The deposit cap alone would reject a loan once the vault was full, so the on-ledger ceiling is the cap plus
 * one year of interest. The app still refuses deposits above the cap.
 */
export function vaultCapacityUnits(poolUnits: bigint, feeBps: number): bigint {
  const interest = (poolUnits * BigInt(feeBps) + 9_999n) / 10_000n;
  return poolUnits + interest;
}

export function vaultCapacityValue(poolUnits: bigint, feeBps: number): string {
  return unitsToValue(vaultCapacityUnits(poolUnits, feeBps));
}

/**
 * "open": an open-ended vault (no subscription or redemption date), which takes deposits and makes loans at any
 * time. The other three are the stages of a closed-ended vault.
 */
export type VaultPhase = "open" | "subscription" | "lending" | "closed";

/**
 * Closed-ended vaults take deposits only before `subscriptionUnix`, and loans only after that, and only while
 * one loan term still ends at least {@link REDEMPTION_BUFFER_SECONDS} before `redemptionUnix`.
 */
export function vaultPhase(nowUnix: number, subscriptionUnix: number, redemptionUnix: number, termSeconds: number): VaultPhase {
  if (nowUnix < subscriptionUnix) return "subscription";
  if (nowUnix > subscriptionUnix && nowUnix + termSeconds + REDEMPTION_BUFFER_SECONDS <= redemptionUnix) return "lending";
  return "closed";
}

/** An issued-currency amount field, which the ledger returns either as a string or as `{ value }`. */
export function amountField(field: unknown): string | null {
  if (typeof field === "string" && field.trim() !== "") return field;
  if (typeof field === "number" && Number.isFinite(field)) return String(field);
  if (field && typeof field === "object" && "value" in field && typeof field.value === "string") return field.value;
  return null;
}

/** A ledger timestamp field, as a non-negative integer. */
export function wholeNumber(field: unknown): number | null {
  if (typeof field === "number" && Number.isInteger(field) && field >= 0) return field;
  if (typeof field === "string" && /^\d+$/.test(field)) return Number(field);
  return null;
}

/** The ledger index of the first created node of `entryType` in a transaction's metadata, or null. */
export function createdNodeId(meta: unknown, entryType: string): string | null {
  if (!meta || typeof meta !== "object" || !("AffectedNodes" in meta)) return null;
  const nodes = meta.AffectedNodes;
  if (!Array.isArray(nodes)) return null;
  for (const node of nodes) {
    if (!node || typeof node !== "object" || !("CreatedNode" in node)) continue;
    const created = node.CreatedNode;
    if (!created || typeof created !== "object") continue;
    if (!("LedgerEntryType" in created) || !("LedgerIndex" in created)) continue;
    if (created.LedgerEntryType === entryType && typeof created.LedgerIndex === "string") return created.LedgerIndex;
  }
  return null;
}
