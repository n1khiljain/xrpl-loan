import {
  REDEMPTION_BUFFER_SECONDS,
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
 * A new wallet's faucet payment takes a ledger or two to validate, so someone approved seconds after signing up
 * would otherwise be refused. Waits up to `tries` × `delayMs` for the account to exist.
 */
export async function waitForAccount(ledger: Ledger, address: Wallet, tries = 8, delayMs = 2_000) {
  let balances = await ledger.balances(address);
  for (let i = 1; i < tries && !balances.exists; i++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    balances = await ledger.balances(address);
  }
  return balances;
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
  const balances = await waitForAccount(deps.ledger, deps.holder);
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

/**
 * One vault in the rolling series: a closed-ended vault the broker owns, with its own loan broker and first-loss
 * cover. A new series opens for deposits while older ones lend, so lenders can always put money in and borrowers
 * can always get a loan; each lender withdraws when their series pays out.
 */
export type VaultSeries = {
  vaultId: string;
  /** The LoanBroker that lends from this vault, or null until one is attached (it can't lend without it). */
  loanBrokerId: string | null;
  shareMptId: string | null;
  phase: VaultPhase;
  /** Unix seconds; null for an open-ended vault. */
  subscriptionAt: number | null;
  redemptionAt: number | null;
  /** Base units, as decimal strings. */
  assetsTotal: string;
  assetsAvailable: string;
  lossUnrealized: string;
  debtTotal: string;
  coverAvailable: string;
};

/** Every series the broker has opened, oldest redemption first, read straight from the ledger. */
export async function listSeries(ledger: Ledger, config: NetworkConfig, nowUnix: number): Promise<VaultSeries[]> {
  const setup = readySetup(config);
  const [vaults, brokers] = await Promise.all([ledger.ownedObjects(setup.broker, "vault"), ledger.ownedObjects(setup.broker, "loan_broker")]);
  const brokerOf = new Map(brokers.map((b) => [String(b.VaultID ?? "").toUpperCase(), b]));
  // a vault without a loan broker can't lend, so it isn't a series lenders should see or deposit into
  const series = vaults
    .filter((v) => isOurAsset(v.Asset, config, setup.issuer) && brokerOf.has(String(v.index ?? v.LedgerIndex ?? "").toUpperCase()))
    .map((v): VaultSeries => {
      const vaultId = String(v.index ?? v.LedgerIndex ?? "").toUpperCase();
      const broker = brokerOf.get(vaultId);
      const subscriptionAt = rippleToUnix(v.SubscriptionDate);
      const redemptionAt = rippleToUnix(v.RedemptionDate);
      return {
        vaultId,
        loanBrokerId: broker ? String(broker.index ?? broker.LedgerIndex ?? "").toUpperCase() || null : null,
        shareMptId: typeof v.ShareMPTID === "string" ? v.ShareMPTID : null,
        phase:
          subscriptionAt === null || redemptionAt === null
            ? "open"
            : // term 0: whether a particular loan still fits before redemption is canLend's question
              vaultPhase(nowUnix, subscriptionAt, redemptionAt, 0),
        subscriptionAt,
        redemptionAt,
        assetsTotal: unitsOf(v.AssetsTotal) ?? "0",
        assetsAvailable: unitsOf(v.AssetsAvailable) ?? "0",
        lossUnrealized: unitsOf(v.LossUnrealized) ?? "0",
        debtTotal: unitsOf(broker?.DebtTotal) ?? "0",
        coverAvailable: unitsOf(broker?.CoverAvailable) ?? "0",
      };
    });
  return series.sort((a, b) => (a.redemptionAt ?? Infinity) - (b.redemptionAt ?? Infinity));
}

function isOurAsset(asset: unknown, config: NetworkConfig, issuer: string): boolean {
  if (!asset || typeof asset !== "object") return false;
  const a = asset as { currency?: string; issuer?: string };
  return a.currency === config.asset.currency && a.issuer === issuer;
}

/**
 * Whether a series can make a loan of `termSeconds` now: it's in its lending phase, has a loan broker, and the
 * loan's payment lands at least {@link REDEMPTION_BUFFER_SECONDS} before the series pays out.
 */
export function canLend(series: VaultSeries, termSeconds: number, nowUnix: number): boolean {
  if (!series.loanBrokerId) return false;
  if (series.phase === "open") return true;
  if (series.phase !== "lending" || series.redemptionAt === null) return false;
  return nowUnix + termSeconds + REDEMPTION_BUFFER_SECONDS <= series.redemptionAt;
}

/**
 * The series to fund a loan from: one that can lend for the whole term and has the principal on hand. Of those,
 * the one that pays out soonest, so the longer-lived series stay free for longer loans. Null when none fits.
 */
export function pickLendingSeries(series: VaultSeries[], principal: bigint, termSeconds: number, nowUnix: number): VaultSeries | null {
  const fits = series.filter((s) => canLend(s, termSeconds, nowUnix) && BigInt(s.assetsAvailable) >= principal);
  return fits.sort((a, b) => (a.redemptionAt ?? Infinity) - (b.redemptionAt ?? Infinity))[0] ?? null;
}

/** The series taking deposits now, newest first; deposits default to the first. */
export function depositSeries(series: VaultSeries[]): VaultSeries[] {
  return series.filter((s) => s.phase === "subscription" || s.phase === "open").sort((a, b) => (b.subscriptionAt ?? 0) - (a.subscriptionAt ?? 0));
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
