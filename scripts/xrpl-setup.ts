/**
 * Creates the Devnet lending vault and writes its public ids into deployments/xrpl-devnet.json.
 * Seeds go in .env only.
 *
 *   pnpm xrpl:setup
 *
 * The vault is closed-ended. Deposits are open for 90 days. Loans start after that, and only while a
 * 180-day loan still ends at least a minute before the redemption date a year out. Running it again
 * skips anything already recorded, so a failed run can be started over.
 */
import {
  COVER_RATE_LIQUIDATION,
  COVER_RATE_MINIMUM,
  COVER_UNITS,
  CREDENTIAL_TYPE_HEX,
  SUBSCRIPTION_SECONDS,
  VAULT_LIFE_SECONDS,
  amountField,
  createdNodeId,
  unitsToValue,
  unixTime,
  valueToUnits,
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
  asset: { currency: string; issuer: string | null; standIn: boolean };
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

const raw = JSON.parse(Deno.readTextFileSync(FILE)) as Deployment;
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
  await mintCover(issuer, broker);
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
  if (!raw.ledger.vaultId) {
    const closed = await client.request({ command: "ledger", ledger_index: "validated" });
    const close = closed.result.ledger.close_time;
    const subscription = close + SUBSCRIPTION_SECONDS;
    const redemption = close + VAULT_LIFE_SECONDS;
    const meta = await submit(broker, {
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
    raw.ledger.vaultId = created(meta, "Vault");
    save();
    console.log(`deposits open until ${new Date(unixTime(subscription) * 1000).toISOString()}`);
    console.log(`vault redeems ${new Date(unixTime(redemption) * 1000).toISOString()}`);
  }
  const vaultId = raw.ledger.vaultId;
  if (!vaultId) throw new Error("the vault was not created");
  if (!raw.ledger.loanBrokerId) {
    const capacity = vaultCapacityValue(BigInt(raw.params.poolDepositCap), raw.params.feeBps);
    const meta = await submit(broker, {
      TransactionType: "LoanBrokerSet",
      Account: broker.classicAddress,
      VaultID: vaultId,
      ManagementFeeRate: 0,
      CoverRateMinimum: COVER_RATE_MINIMUM,
      CoverRateLiquidation: COVER_RATE_LIQUIDATION,
      DebtMaximum: capacity,
    });
    raw.ledger.loanBrokerId = created(meta, "LoanBroker");
    save();
  }
  const loanBrokerId = raw.ledger.loanBrokerId;
  if (!loanBrokerId) throw new Error("the loan broker was not created");
  const brokerEntry = await readNode(loanBrokerId);
  const cover = amountField(brokerEntry?.CoverAvailable);
  if (cover === null || valueToUnits(cover) <= 0n) {
    await submit(broker, {
      TransactionType: "LoanBrokerCoverDeposit",
      Account: broker.classicAddress,
      LoanBrokerID: loanBrokerId,
      Amount: { currency: raw.asset.currency, issuer: issuer.classicAddress, value: unitsToValue(COVER_UNITS) },
    });
  }
} finally {
  await client.disconnect();
}

console.log(`issuer ${issuer.classicAddress}`);
console.log(`broker ${broker.classicAddress}`);
console.log(`vault ${raw.ledger.vaultId}`);
console.log(`loan broker ${raw.ledger.loanBrokerId}`);
console.log("seeds are in .env");

function account(name: "ISSUER_SEED" | "BROKER_SEED", existing: string | null | undefined): Wallet {
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

async function mintCover(from: Wallet, to: Wallet) {
  const lines = await client.request({ command: "account_lines", account: to.classicAddress, peer: from.classicAddress, ledger_index: "validated" });
  const line = lines.result.lines.find((entry) => entry.currency === raw.asset.currency);
  if (line && valueToUnits(line.balance) >= COVER_UNITS) return;
  await submit(from, {
    TransactionType: "Payment",
    Account: from.classicAddress,
    Destination: to.classicAddress,
    Amount: { currency: raw.asset.currency, issuer: from.classicAddress, value: unitsToValue(COVER_UNITS) },
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

async function readNode(index: string): Promise<Record<string, unknown> | null> {
  try {
    const info = await client.request({ command: "ledger_entry", index, ledger_index: "validated" });
    const node = info.result.node;
    return node && typeof node === "object" ? (node as unknown as Record<string, unknown>) : null;
  } catch (error) {
    if (errorCode(error) === "entryNotFound") return null;
    throw error;
  }
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
