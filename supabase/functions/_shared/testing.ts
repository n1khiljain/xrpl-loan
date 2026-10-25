/**
 * Test helpers. Tokens are real ES256 JWTs from a key pair made per run and checked by the production verifier,
 * so the auth tests exercise the same code path as a real Privy token.
 */
import { assertEquals } from "@std/assert";
import { type NetworkConfig, loadNetworkConfig } from "@app/config";
import { SignJWT, exportSPKI, generateKeyPair } from "jose";
import { Wallet as XrplWallet } from "xrpl";
import { type TokenVerifier, createPrivyVerifier } from "./auth.ts";
import { MemoryDb } from "./db/memory.ts";
import type { KycStatus, Profile, StaffRole, Wallet } from "./db/types.ts";
import { type Handler, withErrors } from "./http.ts";
import { FakeLedger } from "./ledger.ts";
import { type Custody, createCustody, encryptSeed, importWalletKey } from "./wallets.ts";

export const APP_ID = "test-privy-app";
const keys = await generateKeyPair("ES256", { extractable: true });
const otherKeys = await generateKeyPair("ES256", { extractable: true });
export const VERIFICATION_KEY = await exportSPKI(keys.publicKey);
export const verifier: TokenVerifier = createPrivyVerifier({ appId: APP_ID, verificationKey: VERIFICATION_KEY });

/** A fixed test-only wallet key: 32 zero bytes. */
export const WALLET_KEY = btoa(String.fromCharCode(...new Uint8Array(32)));
const walletKey = importWalletKey(WALLET_KEY);

export async function privyToken(
  userId: string,
  opts: { audience?: string; issuer?: string; expiresIn?: string; otherKey?: boolean; subject?: string } = {},
): Promise<string> {
  return await new SignJWT({ sid: "session" })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setIssuer(opts.issuer ?? "privy.io")
    .setAudience(opts.audience ?? APP_ID)
    .setSubject(opts.subject ?? userId)
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? "1h")
    .sign(opts.otherKey ? otherKeys.privateKey : keys.privateKey);
}

/** A Privy identity token whose linked accounts include `emails`. */
export async function identityToken(userId: string, emails: string[]): Promise<string> {
  return await new SignJWT({ linked_accounts: JSON.stringify(emails.map((address) => ({ type: "email", address }))) })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setIssuer("privy.io")
    .setAudience(APP_ID)
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(keys.privateKey);
}

/** Every way a request can fail Privy verification. */
export async function badAuthHeaders(): Promise<Array<[string, Record<string, string>]>> {
  const user = "did:privy:someone";
  return [
    ["no Authorization header", {}],
    ["not a bearer token", { authorization: "Basic abc" }],
    ["garbage token", { authorization: "Bearer not-a-jwt" }],
    ["signed by another key", { authorization: `Bearer ${await privyToken(user, { otherKey: true })}` }],
    ["wrong audience", { authorization: `Bearer ${await privyToken(user, { audience: "another-app" })}` }],
    ["wrong issuer", { authorization: `Bearer ${await privyToken(user, { issuer: "evil.example" })}` }],
    ["expired", { authorization: `Bearer ${await privyToken(user, { expiresIn: "-1m" })}` }],
    ["not a Privy subject", { authorization: `Bearer ${await privyToken(user, { subject: "user-1" })}` }],
  ];
}

/** Asserts a handler answers 401 to each bad token before touching anything, for each method it serves. */
export async function assertRejectsBadTokens(handler: Handler, url: string, methods: string[], body = "{}") {
  const wrapped = withErrors(handler);
  for (const method of methods) {
    for (const [label, headers] of await badAuthHeaders()) {
      const res = await wrapped(
        new Request(url, { method, headers: { ...headers, "content-type": "application/json" }, body: method === "GET" ? undefined : body }),
      );
      assertEquals(res.status, 401, `${method} with ${label}`);
      const payload = await res.json();
      assertEquals(payload.error.code, "unauthorized", `${method} with ${label}`);
    }
  }
}

/** Custody over `db` with the fixed test key. */
export function testCustody(db: MemoryDb): Custody {
  return createCustody({ db, key: walletKey });
}

export type TestUser = { xrpl: XrplWallet; wallet: Wallet; userId: string; token: string; profile: Profile };

let userCount = 0;

/** A user with a fresh custodial wallet, a Privy token, and a profile in `db`. */
export async function makeUser(
  db: MemoryDb,
  opts: { email?: string | null; name?: string; staff?: StaffRole; profile?: boolean; kyc?: KycStatus } = {},
): Promise<TestUser> {
  const xrpl = XrplWallet.generate();
  const wallet = xrpl.classicAddress as Wallet;
  const userId = `did:privy:user${++userCount}`;
  let profile = null as unknown as Profile;
  if (opts.profile !== false) {
    await db.insertWallet({ address: wallet, encryptedSeed: await encryptSeed(await walletKey, wallet, xrpl.seed as string) });
    profile = await db.insertProfile({
      wallet,
      privyUserId: userId,
      email: opts.email === undefined ? `user${userCount}@example.test` : opts.email,
      emailVerified: true,
      displayName: opts.name ?? `User ${userCount}`,
    });
    if (opts.kyc) {
      profile = await db.updateProfile(wallet, { kycStatus: opts.kyc, kycSource: "manual", kycUpdatedBy: wallet, kycUpdatedAt: FIXED_NOW.toISOString() });
    }
  }
  if (opts.staff) db.staff.set(wallet, opts.staff);
  return { xrpl, wallet, userId, token: await privyToken(userId), profile };
}

/** Calls a handler the way Supabase would, wrapped in the same error handling. */
export async function call(
  handler: Handler,
  method: string,
  url: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: Record<string, unknown> & { error?: { code: string; message: string } } }> {
  const headers: Record<string, string> = { "content-type": "application/json", ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await withErrors(handler)(
    new Request(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
    }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

/** `deployments/xrpl-devnet.json`. */
export function testConfig(overrides: Partial<NetworkConfig> = {}): NetworkConfig {
  return { ...loadNetworkConfig("xrpl-devnet"), ...overrides };
}

export function seedOrg(db: MemoryDb, id: number, name: string, officers: Wallet[] = []) {
  db.orgs.set(id, { id, name, active: true });
  for (const wallet of officers) db.officers.set(`${id}:${wallet}`, { orgId: id, wallet, title: "Treasurer", active: true });
}

export const FIXED_NOW = new Date("2026-10-11T17:00:00.000Z");

export { FakeLedger, MemoryDb };

/** A vault series on a FakeLedger: a closed-ended vault the broker owns and, unless `loanBroker: false`, its loan broker. */
export type FakeSeries = {
  vaultId: string;
  loanBrokerId?: string;
  /** unix seconds */
  subscriptionAt: number;
  redemptionAt: number;
  /** issued-currency values, e.g. "25000" */
  assetsTotal?: string;
  assetsAvailable?: string;
  debtTotal?: string;
  coverAvailable?: string;
  shareMptId?: string;
  loanBroker?: boolean;
  /** another currency, to check it's ignored */
  currency?: string;
};

const RIPPLE_EPOCH = 946_684_800;

export function seedSeries(ledger: FakeLedger, config: NetworkConfig, series: FakeSeries[]) {
  const broker = config.ledger.broker as string;
  const vaults = ledger.owned.get(`${broker}:vault`) ?? [];
  const brokers = ledger.owned.get(`${broker}:loan_broker`) ?? [];
  for (const s of series) {
    vaults.push({
      LedgerEntryType: "Vault",
      index: s.vaultId,
      Owner: broker,
      Asset: { currency: s.currency ?? config.asset.currency, issuer: config.asset.issuer },
      VaultKind: 1,
      SubscriptionDate: s.subscriptionAt - RIPPLE_EPOCH,
      RedemptionDate: s.redemptionAt - RIPPLE_EPOCH,
      AssetsTotal: s.assetsTotal ?? "0",
      AssetsAvailable: s.assetsAvailable ?? s.assetsTotal ?? "0",
      ShareMPTID: s.shareMptId ?? `00${s.vaultId.slice(0, 46)}`,
    });
    if (s.loanBroker !== false) {
      brokers.push({
        LedgerEntryType: "LoanBroker",
        index: s.loanBrokerId ?? `B${s.vaultId.slice(1)}`,
        VaultID: s.vaultId,
        DebtTotal: s.debtTotal ?? "0",
        CoverAvailable: s.coverAvailable ?? "5000",
      });
    }
  }
  ledger.owned.set(`${broker}:vault`, vaults);
  ledger.owned.set(`${broker}:loan_broker`, brokers);
}
