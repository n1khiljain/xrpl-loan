import {
  type VaultPhase,
  amountField,
  ceilToUnits,
  unitsToValue,
  unixTime,
  valueToUnits,
  vaultPhase,
  wholeNumber,
} from "@app/adapters";
import { type NetworkConfig, type LedgerSetup, NotSetUpError, requireSetup } from "@app/config";
import { type SubmittableTransaction, Wallet as XrplWallet } from "xrpl";
import type { Wallet } from "./db/types.ts";
import { type Env, MissingEnvError, requireEnv } from "./env.ts";
import { HttpError, conflict } from "./http.ts";
import { type Ledger, type Submitted, type TxPurpose, LedgerError } from "./ledger.ts";
import type { Custody } from "./wallets.ts";

/** A trust line big enough that deposits, loans, and repayments never have to raise it. */
const TRUST_LIMIT = "1000000000";

const FRIENDLY: Record<string, string> = {
  tecINSUFFICIENT_FUNDS: "there isn't enough in the vault or this wallet for that",
  tecEXPIRED: "the vault isn't in the phase for that",
  tecTOO_SOON: "the vault isn't in the phase for that yet",
  tecNO_PERMISSION: "this account isn't allowed to do that on the vault",
  tecNO_AUTH: "this account needs the vault credential first",
  tecINSUFFICIENT_RESERVE: "this wallet needs more XRP for the reserve",
  tecLIMIT_EXCEEDED: "that would put the vault over its cap",
  tecINSUFFICIENT_PAYMENT: "that payment is short of what the loan requires",
  tecPRECISION_LOSS: "this loan is too small for the ledger to price",
  tecFROZEN: "this account is frozen for the asset",
  tecPATH_DRY: "the vault doesn't have enough on hand",
};

/** Turns a ledger result into the sentence the page shows. Other errors keep propagating. */
export function rethrowLedger(error: unknown): never {
  if (error instanceof LedgerError) {
    const message = FRIENDLY[error.result] ?? error.message;
    const status = error.result === "tecINSUFFICIENT_FUNDS" || error.result === "tecINSUFFICIENT_PAYMENT" ? 400 : 409;
    throw new HttpError(status, error.result.toLowerCase(), message);
  }
  throw error;
}

export function readySetup(config: NetworkConfig): LedgerSetup {
  try {
    return requireSetup(config);
  } catch (error) {
    if (error instanceof NotSetUpError) throw conflict("the lending vault isn't set up yet", "not_setup");
    throw error;
  }
}

/** A seed the functions read only when a vault or loan step needs it, so the other functions still boot. */
export function signingSeed(env: Env, name: "BROKER_SEED" | "ISSUER_SEED"): string {
  try {
    return requireEnv(env, name);
  } catch (error) {
    if (error instanceof MissingEnvError) throw new HttpError(503, "not_configured", `${error.variable} is not set`);
    throw error;
  }
}

function walletFromSeed(expected: string, seed: string, name: string): XrplWallet {
  let wallet: XrplWallet;
  try {
    wallet = XrplWallet.fromSeed(seed.trim());
  } catch {
    throw new HttpError(503, "not_configured", `${name} isn't a valid XRPL seed`);
  }
  if (wallet.classicAddress !== expected) throw new HttpError(503, "not_configured", `${name} doesn't match the deployment`);
  return wallet;
}

export function brokerWallet(config: NetworkConfig, seed: string): XrplWallet {
  return walletFromSeed(readySetup(config).broker, seed, "BROKER_SEED");
}

export function issuerWallet(config: NetworkConfig, seed: string): XrplWallet {
  return walletFromSeed(readySetup(config).issuer, seed, "ISSUER_SEED");
}

export function issuedAmount(config: NetworkConfig, units: bigint): { currency: string; issuer: string; value: string } {
  const setup = readySetup(config);
  return { currency: config.asset.currency, issuer: setup.issuer, value: unitsToValue(units) };
}

async function submitAllowing(
  ledger: Ledger,
  signer: XrplWallet,
  tx: SubmittableTransaction,
  why: TxPurpose,
  allow: string[],
): Promise<Submitted | null> {
  try {
    return await ledger.submit(signer, tx, why);
  } catch (error) {
    if (error instanceof LedgerError && allow.includes(error.result)) return null;
    rethrowLedger(error);
  }
}

/**
 * A private IOU vault only accepts an account that holds the accepted credential and a trust line to the issuer.
 * Creating either one twice is the same as having it, so those results are ignored. One button still does it.
 */
export async function ensureAccess(deps: {
  ledger: Ledger;
  custody: Custody;
  config: NetworkConfig;
  brokerSeed: string;
  holder: Wallet;
}): Promise<void> {
  const setup = readySetup(deps.config);
  const broker = brokerWallet(deps.config, deps.brokerSeed);
  const balances = await deps.ledger.balances(deps.holder);
  if (!balances.exists) throw conflict("this wallet isn't on the ledger yet", "unfunded");
  const holder = await deps.custody.signer(deps.holder);
  if (balances.asset === null) {
    await submitAllowing(
      deps.ledger,
      holder,
      {
        TransactionType: "TrustSet",
        Account: deps.holder,
        LimitAmount: { currency: deps.config.asset.currency, issuer: setup.issuer, value: TRUST_LIMIT },
      },
      { purpose: "trust_line" },
      ["tecDUPLICATE"],
    );
  }
  await submitAllowing(
    deps.ledger,
    broker,
    {
      TransactionType: "CredentialCreate",
      Account: broker.classicAddress,
      Subject: deps.holder,
      CredentialType: setup.credentialType,
    },
    { purpose: "credential_create" },
    ["tecDUPLICATE"],
  );
  await submitAllowing(
    deps.ledger,
    holder,
    {
      TransactionType: "CredentialAccept",
      Account: deps.holder,
      Issuer: setup.credentialIssuer,
      CredentialType: setup.credentialType,
    },
    { purpose: "credential_accept" },
    ["tecDUPLICATE"],
  );
}

export type VaultSnapshot = {
  phase: VaultPhase | "unknown";
  subscriptionAt: number | null;
  redemptionAt: number | null;
  assetsTotal: string | null;
  assetsAvailable: string | null;
  entry: Record<string, unknown> | null;
};

/** Where the vault is in its closed-ended life, and the totals the lender page shows. */
export async function vaultSnapshot(ledger: Ledger, config: NetworkConfig, nowUnix: number): Promise<VaultSnapshot> {
  const setup = readySetup(config);
  const entry = await ledger.readEntry(setup.vaultId);
  const subscriptionAt = rippleToUnix(entry?.SubscriptionDate);
  const redemptionAt = rippleToUnix(entry?.RedemptionDate);
  const phase: VaultSnapshot["phase"] =
    subscriptionAt === null || redemptionAt === null
      ? "unknown"
      : vaultPhase(nowUnix, subscriptionAt, redemptionAt, config.params.overdueWindowSeconds);
  return {
    phase,
    subscriptionAt,
    redemptionAt,
    assetsTotal: unitsOf(entry?.AssetsTotal),
    assetsAvailable: unitsOf(entry?.AssetsAvailable),
    entry,
  };
}

function rippleToUnix(field: unknown): number | null {
  const ripple = wholeNumber(field);
  return ripple === null ? null : unixTime(ripple);
}

function unitsOf(field: unknown): string | null {
  const value = amountField(field);
  if (value === null) return null;
  try {
    return valueToUnits(value).toString();
  } catch {
    return null;
  }
}

/** The loan's periodic payment, rounded up to base units, when the ledger computed one. */
export function paymentDueUnits(entry: Record<string, unknown> | null): bigint | null {
  const value = amountField(entry?.PeriodicPayment);
  if (value === null) return null;
  try {
    return ceilToUnits(value);
  } catch {
    return null;
  }
}

export function dueAtFromLoan(entry: Record<string, unknown> | null, fallback: Date): string {
  const at = rippleToUnix(entry?.NextPaymentDueDate);
  return at === null ? fallback.toISOString() : new Date(at * 1000).toISOString();
}
