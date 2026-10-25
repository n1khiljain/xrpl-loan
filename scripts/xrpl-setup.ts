/**
 * Sets up Devnet lending: the stand-in RLUSD issuer, the broker account, and the credential domain (written to
 * deployments/xrpl-devnet.json), then vaults as rolling series. Seeds go in .env only.
 *
 *   pnpm xrpl:setup                   the shared accounts, plus a first series if the broker has none
 *   pnpm xrpl:setup series [options]  open another series
 *   pnpm xrpl:setup --fresh ...       forget the recorded accounts and make new ones (Devnet reset, or someone
 *                                     else's seeds aren't in this .env)
 *
 * Series options:
 *   --deposit-minutes N   how long it takes deposits before it starts lending (default 7 days)
 *   --lend-days N         how long it lends before it pays out (default 200, so a 180-day loan fits)
 *   --seed DOLLARS        deposit this much stand-in RLUSD from the house lender while deposits are open
 *   --wait                wait until the series has started lending
 *
 * Each series is a closed-ended vault with its own loan broker and first-loss cover: since LendingProtocolV1_1 a
 * loan broker can only lend from a closed-ended vault, which takes deposits first and lends after. The functions
 * find every series by reading what the broker owns, so a new one needs no config change or redeploy.
 */
import {
  COVER_RATE_LIQUIDATION,
  COVER_RATE_MINIMUM,
  COVER_UNITS,
  CREDENTIAL_TYPE_HEX,
  createdNodeId,
  unitsToValue,
  unixTime,
  vaultCapacityValue,
} from "@app/adapters";
import { parseNetworkConfig } from "@app/config";
import {
  Client,
  type SubmittableTransaction,
  VaultCreateFlags,
  VaultKind,
  VaultWithdrawalPolicy,
  Wallet,
} from "xrpl";

const FILE = new URL("../deployments/xrpl-devnet.json", import.meta.url);
const ENV_FILE = new URL("../.env", import.meta.url);
const DEFAULT_RIPPLE = 0x00800000;
const TRUST_LIMIT = "1000000000";

type Deployment = {
  network: string;
  wsUrl: string;
  faucetUrl: string | null;
  asset: { code: string; currency: string; issuer: string | null; standIn: boolean };
  params: { poolDepositCap: string; feeBps: number };
  ledger: {
    broker?: string;
    credentialIssuer?: string;
    credentialType?: string;
    domainId?: string;
    vaultId?: string;
    loanBrokerId?: string;
    repaymentAccount?: string;
  };
};

const FRESH = Deno.args.includes("--fresh");
const NEW_SERIES = Deno.args.includes("series");
const DEPOSIT_SECONDS = Math.round(numberArg("--deposit-minutes", 7 * 24 * 60) * 60);
const LEND_SECONDS = Math.round(numberArg("--lend-days", 200) * 86_400);
const SEED_UNITS = BigInt(Math.round(numberArg("--seed", 0) * 1_000_000));
const WAIT = Deno.args.includes("--wait");
// the ledger wants at least 180 seconds between the two dates
if (LEND_SECONDS < 180) throw new Error("--lend-days is too short: a series has to lend for at least 3 minutes");

const raw = JSON.parse(Deno.readTextFileSync(FILE)) as Deployment;
if (FRESH) {
  // start over: new issuer and broker, so the old seeds (if any) must not be reused either
  raw.asset.issuer = null;
  raw.ledger = {};
  for (const name of ["ISSUER_SEED", "BROKER_SEED", "HOUSE_SEED"]) removeEnv(ENV_FILE, name);
}
loadDotEnv(ENV_FILE);
if (raw.network !== "xrpl-devnet") throw new Error("this script only sets up xrpl-devnet");
parseNetworkConfig(raw);

const issuer = account("ISSUER_SEED", raw.asset.issuer);
const broker = account("BROKER_SEED", raw.ledger.broker);
raw.asset.issuer = issuer.classicAddress;
raw.ledger.broker = broker.classicAddress;
raw.ledger.credentialIssuer = broker.classicAddress;
raw.ledger.repaymentAccount = broker.classicAddress;
raw.ledger.credentialType = CREDENTIAL_TYPE_HEX;
save();

const client = new Client(raw.wsUrl, { connectionTimeout: 20_000 });
await client.connect();
try {
  await fund(issuer);
  await fund(broker);
  await defaultRipple(issuer);
  await trust(broker);
  if (!raw.ledger.domainId) {
    const meta = await submit(broker, {
      TransactionType: "PermissionedDomainSet",
      Account: broker.classicAddress,
      AcceptedCredentials: [{ Credential: { Issuer: broker.classicAddress, CredentialType: CREDENTIAL_TYPE_HEX } }],
    });
    raw.ledger.domainId = created(meta, "PermissionedDomain");
    save();
  }
  const domainId = raw.ledger.domainId;
  if (!domainId) throw new Error("the permissioned domain was not created");
  const existing = await client.request({ command: "account_objects", account: broker.classicAddress, type: "vault", ledger_index: "validated" });
  if (NEW_SERIES || existing.result.account_objects.length === 0) await openSeries(domainId);
} finally {
  await client.disconnect();
}

console.log(`issuer ${issuer.classicAddress}`);
console.log(`broker ${broker.classicAddress}`);
console.log(`domain ${raw.ledger.domainId}`);
console.log("seeds are in .env");

/** One series: a closed-ended vault, its loan broker, first-loss cover, and optionally the house lender's deposit. */
async function openSeries(domainId: string) {
  const ledger = await client.request({ command: "ledger", ledger_index: "validated" });
  const close = ledger.result.ledger.close_time;
  // a small cushion so the subscription date is still ahead when the transaction is applied
  const subscription = close + Math.max(DEPOSIT_SECONDS, 60);
  const redemption = subscription + LEND_SECONDS;
  const vaultMeta = await submit(broker, {
    TransactionType: "VaultCreate",
    Account: broker.classicAddress,
    Asset: { currency: raw.asset.currency, issuer: issuer.classicAddress },
    AssetsMaximum: vaultCapacityValue(BigInt(raw.params.poolDepositCap), raw.params.feeBps),
    WithdrawalPolicy: VaultWithdrawalPolicy.vaultStrategyFirstComeFirstServe,
    DomainID: domainId,
    Scale: 6,
    VaultKind: VaultKind.vaultKindClosed,
    SubscriptionDate: subscription,
    RedemptionDate: redemption,
    Flags: VaultCreateFlags.tfVaultPrivate,
  });
  const vaultId = created(vaultMeta, "Vault");
  const brokerMeta = await submit(broker, {
    TransactionType: "LoanBrokerSet",
    Account: broker.classicAddress,
    VaultID: vaultId,
    ManagementFeeRate: 0,
    CoverRateMinimum: COVER_RATE_MINIMUM,
    CoverRateLiquidation: COVER_RATE_LIQUIDATION,
    DebtMaximum: vaultCapacityValue(BigInt(raw.params.poolDepositCap), raw.params.feeBps),
  });
  const loanBrokerId = created(brokerMeta, "LoanBroker");
  // each series has its own first-loss cover, so mint more for the broker first
  await mintTo(issuer, broker, COVER_UNITS);
  await submit(broker, {
    TransactionType: "LoanBrokerCoverDeposit",
    Account: broker.classicAddress,
    LoanBrokerID: loanBrokerId,
    Amount: { currency: raw.asset.currency, issuer: issuer.classicAddress, value: unitsToValue(COVER_UNITS) },
  });
  if (SEED_UNITS > 0n) {
    const house = account("HOUSE_SEED", null);
    await fund(house);
    await trust(house);
    await credential(house);
    await mintTo(issuer, house, SEED_UNITS);
    await submit(house, {
      TransactionType: "VaultDeposit",
      Account: house.classicAddress,
      VaultID: vaultId,
      Amount: { currency: raw.asset.currency, issuer: issuer.classicAddress, value: unitsToValue(SEED_UNITS) },
    });
    console.log(`house lender ${house.classicAddress} deposited ${unitsToValue(SEED_UNITS)} ${raw.asset.code}`);
  }
  console.log(`series vault ${vaultId}`);
  console.log(`series loan broker ${loanBrokerId}`);
  console.log(`takes deposits until ${new Date(unixTime(subscription) * 1000).toISOString()}`);
  console.log(`lends until ${new Date(unixTime(redemption) * 1000).toISOString()}, then pays out`);
  if (WAIT) {
    console.log("waiting for it to start lending...");
    for (;;) {
      const now = await client.request({ command: "ledger", ledger_index: "validated" });
      if (now.result.ledger.close_time > subscription) break;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    console.log("lending now");
  }
}

/** Gives an account the vault credential: the broker issues it and the account accepts it. */
async function credential(holder: Wallet) {
  await submitAllowing(broker, { TransactionType: "CredentialCreate", Account: broker.classicAddress, Subject: holder.classicAddress, CredentialType: CREDENTIAL_TYPE_HEX }, "tecDUPLICATE");
  await submitAllowing(holder, { TransactionType: "CredentialAccept", Account: holder.classicAddress, Issuer: broker.classicAddress, CredentialType: CREDENTIAL_TYPE_HEX }, "tecDUPLICATE");
}

async function mintTo(from: Wallet, to: Wallet, units: bigint) {
  await submit(from, {
    TransactionType: "Payment",
    Account: from.classicAddress,
    Destination: to.classicAddress,
    Amount: { currency: raw.asset.currency, issuer: from.classicAddress, value: unitsToValue(units) },
  });
}

async function submitAllowing(wallet: Wallet, tx: SubmittableTransaction, allowed: string) {
  try {
    await submit(wallet, tx);
  } catch (error) {
    if (error instanceof Error && error.message.endsWith(allowed)) return;
    throw error;
  }
}

function numberArg(name: string, fallback: number): number {
  const at = Deno.args.indexOf(name);
  if (at === -1) return fallback;
  const value = Number(Deno.args[at + 1]);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} needs a number`);
  return value;
}

function account(name: "ISSUER_SEED" | "BROKER_SEED" | "HOUSE_SEED", existing: string | null | undefined): Wallet {
  const seed = Deno.env.get(name);
  if (existing && !seed) throw new Error(`${existing} is already in the deployment file, but ${name} is not in .env`);
  if (seed) {
    const wallet = Wallet.fromSeed(seed.trim());
    if (existing && wallet.classicAddress !== existing) throw new Error(`${name} does not match ${existing}`);
    return wallet;
  }
  const wallet = Wallet.generate();
  if (!wallet.seed) throw new Error(`could not generate ${name}`);
  upsertEnv(ENV_FILE, name, wallet.seed);
  console.log(`wrote ${name} to .env`);
  return wallet;
}

function save() {
  parseNetworkConfig(raw);
  Deno.writeTextFileSync(FILE, JSON.stringify(raw, null, 2) + "\n");
}

async function fund(wallet: Wallet) {
  if (await accountExists(wallet.classicAddress)) return;
  if (!raw.faucetUrl) throw new Error("this network has no faucet");
  const res = await fetch(raw.faucetUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ destination: wallet.classicAddress, userAgent: "xrpl-receivables" }),
  });
  if (!res.ok) throw new Error(`the faucet answered ${res.status} for ${wallet.classicAddress}`);
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await accountExists(wallet.classicAddress)) return;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`${wallet.classicAddress} was not funded`);
}

async function accountExists(address: string): Promise<boolean> {
  try {
    await client.request({ command: "account_info", account: address, ledger_index: "validated" });
    return true;
  } catch (error) {
    if (errorCode(error) === "actNotFound") return false;
    throw error;
  }
}

async function defaultRipple(wallet: Wallet) {
  const info = await client.request({ command: "account_info", account: wallet.classicAddress, ledger_index: "validated" });
  if ((info.result.account_data.Flags & DEFAULT_RIPPLE) !== 0) return;
  await submit(wallet, { TransactionType: "AccountSet", Account: wallet.classicAddress, SetFlag: 8 });
}

async function trust(wallet: Wallet) {
  await submit(wallet, {
    TransactionType: "TrustSet",
    Account: wallet.classicAddress,
    LimitAmount: { currency: raw.asset.currency, issuer: issuer.classicAddress, value: TRUST_LIMIT },
  });
}

async function submit(wallet: Wallet, tx: SubmittableTransaction) {
  const prepared = await client.autofill(tx);
  const signed = wallet.sign(prepared);
  const response = await client.submitAndWait(signed.tx_blob);
  const meta = response.result.meta;
  const result = typeof meta === "object" && meta !== null && "TransactionResult" in meta ? String(meta.TransactionResult) : "unknown";
  if (result !== "tesSUCCESS") throw new Error(`${tx.TransactionType} ${signed.hash} failed with ${result}`);
  console.log(`${tx.TransactionType} ${signed.hash}`);
  return meta;
}

function created(meta: unknown, entryType: string): string {
  const id = createdNodeId(meta, entryType);
  if (!id) throw new Error(`the ledger did not return a new ${entryType}`);
  return id.toUpperCase();
}

function errorCode(error: unknown): string | undefined {
  return (error as { data?: { error?: string } }).data?.error;
}

function loadDotEnv(path: URL) {
  let text: string;
  try {
    text = Deno.readTextFileSync(path);
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    const key = match?.[1];
    const value = match?.[2];
    if (!key || value === undefined || Deno.env.get(key)) continue;
    Deno.env.set(key, value);
  }
}

function removeEnv(path: URL, name: string) {
  let text: string;
  try {
    text = Deno.readTextFileSync(path);
  } catch {
    return;
  }
  Deno.writeTextFileSync(path, text.replace(new RegExp(`^${name}=.*\\n?`, "m"), ""));
  Deno.env.delete(name);
}

function upsertEnv(path: URL, name: string, value: string) {
  let text = "";
  try {
    text = Deno.readTextFileSync(path);
  } catch {
    text = "";
  }
  if (text.length > 0 && !text.endsWith("\n")) text += "\n";
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  text = pattern.test(text) ? text.replace(pattern, line) : `${text}${line}\n`;
  Deno.writeTextFileSync(path, text);
  Deno.env.set(name, value);
}
