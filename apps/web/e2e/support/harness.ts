import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { claimRegistryAbi, mockFrxUsdAbi, orgRegistryAbi, receivablesPoolAbi } from "@app/abi";
import { loadNetworkConfig, requireDeployed } from "@app/config";
import { type Browser, type BrowserContext, type Page, expect } from "@playwright/test";
import { type JWK, SignJWT, importJWK } from "jose";
import { type Address, type Hex, createPublicClient, createWalletClient, http, parseEther } from "viem";
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { CONTEXT_FILE, type E2EContext, SCREENSHOTS } from "./paths";

export const ctx = (): E2EContext => JSON.parse(readFileSync(CONTEXT_FILE, "utf8")) as E2EContext;

const config = loadNetworkConfig("local");
export const deployed = requireDeployed(config);
const RPC = "http://127.0.0.1:8545";
const chain = { ...foundry, rpcUrls: { default: { http: [RPC] } } };
export const chainClient = createPublicClient({ chain, transport: http(RPC), pollingInterval: 100 });

/** anvil's first dev account: every onchain role on local, and the offchain underwriter (added by global-setup). */
const deployerAccount = mnemonicToAccount("test test test test test test test test test test test junk");
export const deployer = createWalletClient({ account: deployerAccount, chain, transport: http(RPC) });

/** A phone-width viewport for claimant and guarantor screens (FR-F9). */
export const PHONE = { width: 375, height: 812 };

export type Person = { key: Hex; address: Address; userId: string; name: string; email: string; token: string };

let signingKey: CryptoKey | Uint8Array | null = null;

/** A Privy-shaped access token signed with this run's test key, which the served functions trust. */
export async function accessToken(userId: string): Promise<string> {
  const c = ctx();
  signingKey ??= await importJWK(JSON.parse(readFileSync(c.jwkFile, "utf8")) as JWK, "ES256");
  return new SignJWT({ sid: "playwright" })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setIssuer("privy.io")
    .setAudience(c.privyAppId)
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(signingKey);
}

export async function mined(hash: Hex | Promise<Hex>) {
  const receipt = await chainClient.waitForTransactionReceipt({ hash: await hash });
  expect(receipt.status).toBe("success");
  return receipt;
}

const run = crypto.randomUUID().slice(0, 6);

/** A new person with a fresh key and a little ETH for gas. The mock gas sponsor sends nothing on local. */
export async function person(label: string, name: string): Promise<Person> {
  const key = generatePrivateKey();
  const address = privateKeyToAccount(key).address;
  await chainClient.request({ method: "anvil_setBalance" as never, params: [address, "0x16345785D8A0000"] as never });
  const userId = `did:privy:pw-${label}-${run}`;
  return { key, address, userId, name, email: `${label}-${run}@example.test`, token: await accessToken(userId) };
}

/** The staff member: anvil account 0, already linked by the backend e2e run or linked here on first use. */
export async function staff(): Promise<Person> {
  const userId = "did:privy:e2e-underwriter";
  const key = `0x${Buffer.from(deployerAccount.getHdKey().privateKey as Uint8Array).toString("hex")}` as Hex;
  return { key, address: deployerAccount.address, userId, name: "Pilot underwriter", email: "underwriter@example.test", token: await accessToken(userId) };
}

/** A browser context signed in as `who` through the local dev session (U-62). */
export async function openAs(browser: Browser, who: Person, viewport = PHONE): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport, baseURL: "http://localhost:3000", acceptDownloads: true });
  await context.addInitScript((seed) => {
    window.__FRAXNET_DEV_SESSION__ = seed;
  }, { privateKey: who.key, accessToken: who.token, userId: who.userId, email: who.email });
  // FraxNet is an external site; tests never reach it
  await context.route("https://net.frax.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>FraxNet (stub)</title><p>FraxNet stub</p>" }),
  );
  return { context, page: await context.newPage() };
}

/** Calls an edge function the way a script would, for setup the UI doesn't own. */
export async function api<T>(name: string, bearer: string, init: { method?: string; body?: unknown; query?: string } = {}): Promise<T> {
  const c = ctx();
  const res = await fetch(`${c.apiUrl}/functions/v1/${name}${init.query ?? ""}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", apikey: c.anonKey },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name}: ${res.status} ${text}`);
  return JSON.parse(text) as T;
}

/** What pg_cron does every minute in a hosted project: mirror the chain into Postgres. */
export async function sync() {
  await api("chain-sync", ctx().cronSecret, { method: "POST" });
}

/** Adds an org onchain with the given officers, then mirrors it. Returns the org ID. */
export async function addOrg(name: string, officers: Address[]): Promise<bigint> {
  await mined(deployer.writeContract({ address: deployed.orgRegistry, abi: orgRegistryAbi, functionName: "addOrg", args: [name] }));
  const orgId = await chainClient.readContract({ address: deployed.orgRegistry, abi: orgRegistryAbi, functionName: "orgCount" });
  for (const officer of officers) {
    await mined(deployer.writeContract({ address: deployed.orgRegistry, abi: orgRegistryAbi, functionName: "setOfficer", args: [orgId, officer, true] }));
  }
  await sync();
  return orgId;
}

export async function mintFrxUsd(to: Address, amount: bigint) {
  await mined(deployer.writeContract({ address: deployed.frxUSD, abi: mockFrxUsdAbi, functionName: "mint", args: [to, amount] }));
}

export async function allowLender(lender: Address) {
  await mined(deployer.writeContract({ address: deployed.pool, abi: receivablesPoolAbi, functionName: "setLenderAllowed", args: [lender, true] }));
}

/** Makes sure the pool has at least `amount` of idle cash, depositing from the deployer if it doesn't. */
export async function ensurePoolCash(amount: bigint) {
  const idle = await chainClient.readContract({ address: deployed.pool, abi: receivablesPoolAbi, functionName: "idleCash" });
  if (idle >= amount) return;
  const top = amount - idle + parseEther("100");
  await allowLender(deployerAccount.address);
  await mintFrxUsd(deployerAccount.address, top);
  await mined(deployer.writeContract({ address: deployed.frxUSD, abi: mockFrxUsdAbi, functionName: "approve", args: [deployed.pool, top] }));
  await mined(deployer.writeContract({ address: deployed.pool, abi: receivablesPoolAbi, functionName: "deposit", args: [top, deployerAccount.address] }));
}

export async function onchainClaim(id: bigint) {
  return chainClient.readContract({ address: deployed.claimRegistry, abi: claimRegistryAbi, functionName: "getClaim", args: [id] });
}

/** Executes proposed Safe transactions as the Safe would once its signers approve. The deployer holds every role on local. */
export async function executeAsSafe(txs: { to: string; data: string; value: string }[]) {
  for (const tx of txs) {
    await mined(deployer.sendTransaction({ to: tx.to as Address, data: tx.data as Hex, value: BigInt(tx.value) }));
  }
}

/** The design canvas's desktop frame width. */
export const DESKTOP = { width: 1440, height: 900 };

/**
 * Saves a full-page screenshot. At phone width it also fails if anything scrolls sideways (FR-F10), then saves the
 * same screen, in the same state, at desktop width as `<name>-desktop.jpg`, and goes back to phone width. JPEG,
 * because the film grain on the gradients makes PNGs about ten times larger.
 */
export async function screenshot(page: Page, name: string) {
  // animations: "disabled" finishes CSS transitions, or a button that just became enabled is caught mid-fade
  const shot = (file: string) => page.screenshot({ path: join(SCREENSHOTS, file), fullPage: true, type: "jpeg", quality: 80, animations: "disabled" });
  mkdirSync(SCREENSHOTS, { recursive: true });
  await page.waitForLoadState("networkidle").catch(() => {});
  // start from the top so sticky and fixed chrome sits where a person first sees it
  await page.evaluate(() => window.scrollTo(0, 0));
  const size = page.viewportSize();
  if (size?.width !== PHONE.width) {
    await shot(`${name}.jpg`);
    return;
  }
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, `${name} is wider than ${PHONE.width}px`).toBeLessThanOrEqual(PHONE.width);
  await shot(`${name}.jpg`);
  await page.setViewportSize(DESKTOP);
  await page.waitForTimeout(150);
  await shot(`${name}-desktop.jpg`);
  await page.setViewportSize(size);
  await page.waitForTimeout(150);
}

/** A small valid PDF, so the receipt upload has real bytes. */
export function receiptPdf(label: string): { name: string; mimeType: string; buffer: Buffer } {
  const body = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\n% ${label}\ntrailer<</Root 1 0 R>>\n%%EOF\n`;
  return { name: `receipt-${label}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(body) };
}

export const RUN = run;
