/**
 * Test helpers. Tokens are real ES256 JWTs from a key pair made per run and checked by the production verifier,
 * so the auth tests exercise the same code path as a real Privy token.
 */
import { assertEquals } from "@std/assert";
import { type ClaimView, toClaimView } from "@app/adapters";
import { type NetworkConfig, loadNetworkConfig } from "@app/config";
import { SignJWT, exportSPKI, generateKeyPair } from "jose";
import type { Hex, LocalAccount } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { type TokenVerifier, bindingMessage, createPrivyVerifier } from "./auth.ts";
import { MemoryDb } from "./db/memory.ts";
import type { KycStatus, Profile, StaffRole, Wallet } from "./db/types.ts";
import { type Handler, withErrors } from "./http.ts";

export const APP_ID = "test-privy-app";
const keys = await generateKeyPair("ES256", { extractable: true });
const otherKeys = await generateKeyPair("ES256", { extractable: true });
export const VERIFICATION_KEY = await exportSPKI(keys.publicKey);
export const verifier: TokenVerifier = createPrivyVerifier({ appId: APP_ID, verificationKey: VERIFICATION_KEY });

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

export type TestUser = { account: LocalAccount; wallet: Wallet; userId: string; token: string; profile: Profile };

let userCount = 0;

/** A user with a fresh key, a Privy token, and a profile in `db`. */
export async function makeUser(
  db: MemoryDb,
  opts: { email?: string | null; name?: string; staff?: StaffRole; profile?: boolean; kyc?: KycStatus } = {},
): Promise<TestUser> {
  const account = privateKeyToAccount(generatePrivateKey());
  const wallet = account.address.toLowerCase() as Wallet;
  const userId = `did:privy:user${++userCount}`;
  const profile =
    opts.profile === false
      ? (null as unknown as Profile)
      : await db.insertProfile({
          wallet,
          privyUserId: userId,
          email: opts.email === undefined ? `user${userCount}@example.test` : opts.email,
          displayName: opts.name ?? `User ${userCount}`,
        });
  if (opts.staff) db.staff.set(wallet, opts.staff);
  const verified = opts.kyc && profile ? await db.updateProfile(wallet, { kycStatus: opts.kyc, kycSource: "manual", kycUpdatedAt: FIXED_NOW.toISOString() }) : profile;
  return { account, wallet, userId, token: await privyToken(userId), profile: verified };
}

export async function bindingSignature(user: { account: LocalAccount; userId: string }, issuedAt: string): Promise<Hex> {
  return await user.account.signMessage({
    message: bindingMessage({ privyUserId: user.userId, wallet: user.account.address, issuedAt }),
  });
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

/** `deployments/local.json`, which has deployed addresses. */
export function localConfig(overrides: Partial<NetworkConfig> = {}): NetworkConfig {
  return { ...loadNetworkConfig("local"), ...overrides };
}

export function seedOrg(db: MemoryDb, id: number, name: string, officers: Wallet[] = []) {
  db.orgs.set(id, { id, name, active: true });
  for (const wallet of officers) db.officers.set(`${id}:${wallet}`, { orgId: id, wallet, title: "Treasurer", active: true });
}

/** A claim as the chain would return it, for fake ChainReaders. */
export function onchainClaim(overrides: Partial<ClaimView> = {}): ClaimView {
  return {
    ...toClaimView({
      id: 1n,
      recipient: "0x0000000000000000000000000000000000000001",
      orgId: 1n,
      recipientType: 0,
      state: 3,
      callReason: 0,
      principalWrittenOff: false,
      guarantor: "0x0000000000000000000000000000000000000002",
      feeBps: 0,
      submittedAt: 1_790_000_000,
      approvalExpiresAt: 1_791_209_600,
      faceValue: 500n * 10n ** 18n,
      requestedAmount: 400n * 10n ** 18n,
      approvedAmount: 400n * 10n ** 18n,
      purchasePrice: 400n * 10n ** 18n,
      amountDue: 400n * 10n ** 18n,
      amountPaid: 0n,
      writtenOffPrincipal: 0n,
      purchasedAt: 1_790_100_000,
      dueAt: 1_805_652_000,
      guarantorCalledAt: 0,
      writeOffEligibleAt: 0,
      feeAccruedAt: 1_790_100_000,
      packetHash: `0x${"ab".repeat(32)}`,
    }),
    ...overrides,
  };
}

export const FIXED_NOW = new Date("2026-10-11T17:00:00.000Z");

export { MemoryDb };
