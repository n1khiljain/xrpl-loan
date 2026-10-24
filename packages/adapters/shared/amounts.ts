import { ASSET_DECIMALS } from "@app/config";

const SCALE = 10n ** BigInt(ASSET_DECIMALS);

/**
 * Base units as the decimal string an XRPL issued-currency amount takes ("1250.5"). Issued currencies keep 15
 * significant digits, which covers every amount up to a billion dollars at 6 decimals.
 */
export function unitsToValue(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / SCALE;
  const fraction = (abs % SCALE).toString().padStart(ASSET_DECIMALS, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/**
 * An XRPL issued-currency value ("1250.5", "1.25e3", "-0.000001") as base units, rounded toward zero below the
 * sixth decimal. Throws on anything that isn't a number.
 */
export function valueToUnits(value: string): bigint {
  const match = /^(-)?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value.trim());
  if (!match) throw new RangeError(`not an amount: ${value}`);
  const [, sign, whole = "0", fraction = "", exp = "0"] = match;
  let digits = BigInt(whole + fraction);
  const shift = Number(exp) - fraction.length + ASSET_DECIMALS;
  if (shift >= 0) digits *= 10n ** BigInt(shift);
  else digits /= 10n ** BigInt(-shift);
  return sign ? -digits : digits;
}

/**
 * Like `valueToUnits`, but any remainder past the sixth decimal rounds up. Loan payments have to cover the
 * ledger's high-precision figure, and paying a hair more is ignored rather than rejected.
 */
export function ceilToUnits(value: string): bigint {
  const units = valueToUnits(value);
  if (units < 0n) return units;
  const exact = scaled(unitsToValue(units));
  const given = scaled(value);
  if (exact === null || given === null) return units;
  return given > exact ? units + 1n : units;
}

/** The value as an integer at 30 decimal places, so two amounts can be compared past the sixth decimal. */
function scaled(value: string): bigint | null {
  const match = /^(-)?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value.trim());
  if (!match) return null;
  const [, sign, whole = "0", fraction = "", exp = "0"] = match;
  let digits = BigInt(whole + fraction);
  const shift = Number(exp) - fraction.length + 30;
  if (!Number.isFinite(shift) || Math.abs(shift) > 1_000) return null;
  if (shift >= 0) digits *= 10n ** BigInt(shift);
  else digits /= 10n ** BigInt(-shift);
  return sign ? -digits : digits;
}

/** XRP drops (1 XRP = 1,000,000 drops) as a decimal XRP string. */
export function dropsToXrp(drops: bigint | string): string {
  const d = BigInt(drops);
  const whole = d / 1_000_000n;
  const fraction = (d % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}
