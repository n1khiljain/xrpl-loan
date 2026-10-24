/**
 * Sets up the local stack so you can click through the app in a browser without Privy (U-62):
 *   deno run --allow-all --config supabase/functions/deno.json scripts/local-demo.ts [dir]
 *
 * Needs anvil with the local deploy, `supabase start`, and `supabase functions serve --env-file <dir>/functions.env`,
 * where <dir> (default apps/web/e2e/.cache, which `pnpm e2e` fills) holds the env file and Privy test key from
 * supabase/functions/_tests/make-e2e-env.ts. It links four personas (anvil dev accounts 0 to 3), adds a demo org with
 * the guarantor as officer, allowlists and funds the lender, puts cash in the pool, marks the people verified, and
 * gives the member five reimbursements in different states (waiting on the officer, in review, approved, paid, and
 * closed out) so every screen has something on it. It writes each persona's session to <dir>/demo-sessions.json and
 * to apps/web/public/local-demo-sessions.json, which the sign-in screen of a `local` build offers as one-click
 * buttons (both gitignored). Run it again any time; it only adds what's missing. Local anvil only.
 */
import { claimRegistryAbi, mockFrxUsdAbi, orgRegistryAbi, receivablesPoolAbi } from "@app/abi";
import { bindingMessage } from "@app/adapters";
import { loadNetworkConfig, requireDeployed } from "@app/config";
import { type JWK, SignJWT, importJWK } from "jose";
import { type Hex, createPublicClient, createWalletClient, erc20Abi, http, parseEther, toHex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { LOCAL_STACK } from "../supabase/functions/_shared/local-stack.ts";
import { ensureLocalUnderwriter } from "../supabase/functions/_tests/local-underwriter.ts";

const DIR = Deno.args[0] ?? new URL("../apps/web/e2e/.cache", import.meta.url).pathname;
const RPC = "http://127.0.0.1:8545";
const SUPABASE = "http://127.0.0.1:54321";
const API = `${SUPABASE}/functions/v1`;
const MNEMONIC = "test test test test test test test test test test test junk";
const ORG_NAME = "Blockchain at Berkeley (demo)";
const SESSION_KEY = "fraxnet.devSession";

const env = Object.fromEntries(
  (await Deno.readTextFile(`${DIR}/functions.env`))
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const signingKey = await importJWK(JSON.parse(await Deno.readTextFile(`${DIR}/privy-test.jwk.json`)) as JWK, "ES256");
const deployed = requireDeployed(loadNetworkConfig("local"));
const chain = { ...foundry, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC), pollingInterval: 100 });
if ((await pub.getChainId()) !== 31_337) throw new Error("this only runs against local anvil");

const persona = (index: number, userId: string, name: string, email: string) => {
  const account = mnemonicToAccount(MNEMONIC, { addressIndex: index });
  return { account, key: toHex(account.getHdKey().privateKey!), userId, name, email, wallet: createWalletClient({ account, chain, transport: http(RPC) }) };
};
// the deployer holds every role on local and is the staff member local-up.sh adds (not seeded: E-6a); the backend e2e links it to this user ID
const staff = persona(0, "did:privy:e2e-underwriter", "Pilot underwriter", "underwriter@example.test");
const claimant = persona(1, "did:privy:demo-claimant", "Jordan Park", "jordan@example.test");
const guarantor = persona(2, "did:privy:demo-guarantor", "Sam Rivera", "sam@example.test");
const lender = persona(3, "did:privy:demo-lender", "Pilot lender", "lender@example.test");
const people = { claimant, guarantor, lender, staff };

const token = (userId: string) =>
  new SignJWT({ sid: "local-demo" })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setIssuer("privy.io")
    .setAudience(env.PRIVY_APP_ID as string)
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(signingKey);

// deno-lint-ignore no-explicit-any
async function call(name: string, bearer: string, body?: unknown, init: { method?: string; query?: string } = {}): Promise<any> {
  const res = await fetch(`${API}/${name}${init.query ?? ""}`, {
    method: init.method ?? (body === undefined ? "GET" : "POST"),
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${name}: ${res.status} ${JSON.stringify(json)}. Is \`supabase functions serve --env-file ${DIR}/functions.env\` running?`);
  return json;
}
async function mined(hash: Promise<Hex>) {
  const receipt = await pub.waitForTransactionReceipt({ hash: await hash });
  if (receipt.status !== "success") throw new Error(`transaction ${receipt.transactionHash} reverted`);
}

// 1. link each persona's wallet the way the app does on first sign-in
for (const p of Object.values(people)) {
  const bearer = await token(p.userId);
  if ((await call("me", bearer)).profile) continue;
  const issuedAt = new Date().toISOString();
  const signature = await p.account.signMessage({ message: bindingMessage({ privyUserId: p.userId, wallet: p.account.address, issuedAt }) });
  await call("me", bearer, { wallet: p.account.address, signature, issuedAt, email: p.email, displayName: p.name });
}

// 2. the demo org, with the guarantor as its officer
const orgs = { address: deployed.orgRegistry, abi: orgRegistryAbi } as const;
let orgId = 0n;
const count = await pub.readContract({ ...orgs, functionName: "orgCount" });
for (let id = 1n; id <= count && orgId === 0n; id++) {
  if ((await pub.readContract({ ...orgs, functionName: "orgName", args: [id] })) === ORG_NAME) orgId = id;
}
if (orgId === 0n) {
  await mined(staff.wallet.writeContract({ ...orgs, functionName: "addOrg", args: [ORG_NAME] }));
  orgId = await pub.readContract({ ...orgs, functionName: "orgCount" });
}
if (!(await pub.readContract({ ...orgs, functionName: "isActiveOfficer", args: [orgId, guarantor.account.address] }))) {
  await mined(staff.wallet.writeContract({ ...orgs, functionName: "setOfficer", args: [orgId, guarantor.account.address, true] }));
}

// 3. the lender is allowlisted and holds MockFrxUSD; the pool has cash to buy claims
const pool = { address: deployed.pool, abi: receivablesPoolAbi } as const;
const frxUSD = { address: deployed.frxUSD, abi: mockFrxUsdAbi } as const;
for (const who of [lender, staff]) {
  if (!(await pub.readContract({ ...pool, functionName: "isLenderAllowed", args: [who.account.address] }))) {
    await mined(staff.wallet.writeContract({ ...pool, functionName: "setLenderAllowed", args: [who.account.address, true] }));
  }
}
if ((await pub.readContract({ ...frxUSD, functionName: "balanceOf", args: [lender.account.address] })) < parseEther("1000")) {
  await mined(staff.wallet.writeContract({ ...frxUSD, functionName: "mint", args: [lender.account.address, parseEther("5000")] }));
}
const idle = await pub.readContract({ ...pool, functionName: "idleCash" });
if (idle < parseEther("5000")) {
  const top = parseEther("5000") - idle;
  await mined(staff.wallet.writeContract({ ...frxUSD, functionName: "mint", args: [staff.account.address, top] }));
  await mined(staff.wallet.writeContract({ ...frxUSD, functionName: "approve", args: [deployed.pool, top] }));
  await mined(staff.wallet.writeContract({ ...pool, functionName: "deposit", args: [top, staff.account.address] }));
}

// 4. mirror the org so the claim wizard lists it
await call("chain-sync", env.CHAIN_SYNC_SECRET as string, {});

// 5. the underwriter marks everyone verified, as they would after checking net.frax.com (U-07)
if (!LOCAL_STACK) throw new Error("no local Supabase running (supabase start)");
await ensureLocalUnderwriter(LOCAL_STACK);
const staffBearer = await token(staff.userId);
for (const p of [claimant, guarantor, lender]) {
  await call("kyc-manual", staffBearer, { wallet: p.account.address, status: "approved", note: "local demo" });
}

// 6. the member's reimbursements, one in each state a member sees, if they don't have any yet
async function anonKey(): Promise<string> {
  const fromEnv = Deno.env.get("SUPABASE_ANON_KEY");
  if (fromEnv) return fromEnv;
  const out = new TextDecoder().decode((await new Deno.Command("supabase", { args: ["status", "-o", "env"], stdout: "piped", stderr: "null" }).output()).stdout);
  const match = /^ANON_KEY="?([^"\n]+)"?$/m.exec(out);
  if (!match) throw new Error("couldn't read ANON_KEY from `supabase status`; is `supabase start` running?");
  return match[1] as string;
}

const RECEIPT = (label: string) =>
  new TextEncoder().encode(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\n% ${label}\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
  );

/** Draft, receipt, officer, packet, and invite, the way the wizard does it. Signs off too unless `sign` is false. */
async function draft(callink: string, dollars: string, description: string, sign: boolean): Promise<string> {
  const bearer = await token(claimant.userId);
  const amount = parseEther(dollars).toString();
  const { claim } = await call("claims", bearer, {
    orgId: Number(orgId),
    recipientType: "member",
    faceValue: amount,
    requestedAmount: amount,
    callinkPrNumber: callink,
    description,
  });
  const file = RECEIPT(callink);
  const created = await call("documents", bearer, { action: "create", claimId: claim.id, mimeType: "application/pdf", sizeBytes: file.byteLength });
  const key = await anonKey();
  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", new Blob([file], { type: "application/pdf" }));
  const up = await fetch(`${SUPABASE}/storage/v1/object/upload/sign/receipts/${created.upload.path}?token=${created.upload.token}`, {
    method: "PUT",
    body: form,
    headers: { apikey: key, authorization: `Bearer ${key}`, "x-upsert": "false" },
  });
  if (!up.ok) throw new Error(`receipt upload: ${up.status} ${await up.text()}`);
  await call("documents", bearer, { action: "confirm", documentId: created.document.id });
  await call("claims", bearer, { id: claim.id, guarantorWallet: guarantor.account.address }, { method: "PATCH" });
  await call("packet", bearer, { claimId: claim.id });
  const invite = await call("guarantor-invite", bearer, { claimId: claim.id });
  if (!sign) return claim.id;

  const inviteToken = new URL(invite.inviteUrl).searchParams.get("invite") as string;
  const guarantorBearer = await token(guarantor.userId);
  const opened = await call("guarantor-invite", guarantorBearer, undefined, { query: `?invite=${inviteToken}` });
  const t = opened.typedData;
  const message = Object.fromEntries(Object.entries(t.message as Record<string, string>).map(([k, v]) => [k, /^[0-9]+$/.test(v) ? BigInt(v) : v]));
  const signature = await guarantor.account.signTypedData({ domain: t.domain, types: t.types, primaryType: "Guaranty", message } as never);
  await call("guaranty", guarantorBearer, { claimId: claim.id, signature, nonce: t.message.nonce, deadline: t.message.deadline, invite: inviteToken });
  return claim.id;
}

const registry = { address: deployed.claimRegistry, abi: claimRegistryAbi } as const;

/** Sends a signed-off draft for review from the member's wallet. Returns the onchain claim ID. */
async function submit(claimId: string): Promise<bigint> {
  const { claim } = await call("claims", await token(claimant.userId), undefined, { query: `?id=${claimId}` });
  await mined(
    claimant.wallet.writeContract({
      ...registry,
      functionName: "submitClaim",
      args: [
        {
          orgId: BigInt(claim.orgId),
          recipientType: 0,
          guarantor: claim.guarantorWallet,
          faceValue: BigInt(claim.faceValue),
          requestedAmount: BigInt(claim.requestedAmount),
          packetHash: claim.packetHash,
        },
        BigInt(claim.guarantyDeadline),
        claim.guarantySignature,
      ],
    }),
  );
  return await pub.readContract({ ...registry, functionName: "claimCount" });
}

const { claims: existing } = await call("claims", await token(claimant.userId));
if (existing.length === 0) {
  // waiting on the officer
  await draft("PR-DEMO-105", "60", "Pizza for the general meeting", false);

  // in review
  await submit(await draft("PR-DEMO-104", "95", "Printing for the info session", true));

  // approved, ready to get paid
  const approved = await submit(await draft("PR-DEMO-103", "180", "Club T-shirts for the new members", true));
  await mined(staff.wallet.writeContract({ ...registry, functionName: "approveClaim", args: [approved, parseEther("180")] }));

  // paid, waiting on ASUC
  const paid = await submit(await draft("PR-DEMO-102", "240", "Snacks for the fall hackathon", true));
  await mined(staff.wallet.writeContract({ ...registry, functionName: "approveClaim", args: [paid, parseEther("240")] }));
  await mined(claimant.wallet.writeContract({ ...registry, functionName: "purchaseClaim", args: [paid] }));

  // closed out: ASUC paid the member and they sent it to Frax
  const closed = await submit(await draft("PR-DEMO-101", "420", "Venue AV for the speaker night", true));
  await mined(staff.wallet.writeContract({ ...registry, functionName: "approveClaim", args: [closed, parseEther("420")] }));
  await mined(claimant.wallet.writeContract({ ...registry, functionName: "purchaseClaim", args: [closed] }));
  const due = await pub.readContract({ ...registry, functionName: "amountRemaining", args: [closed] });
  await mined(staff.wallet.writeContract({ ...frxUSD, functionName: "mint", args: [claimant.account.address, due] }));
  await mined(claimant.wallet.writeContract({ address: deployed.frxUSD, abi: erc20Abi, functionName: "approve", args: [deployed.claimRegistry, due] }));
  await mined(claimant.wallet.writeContract({ ...registry, functionName: "settle", args: [closed, due] }));

  await call("chain-sync", env.CHAIN_SYNC_SECRET as string, {});
}

// 7. sessions to paste into the browser, or to pick on the sign-in screen
const sessions = Object.fromEntries(
  await Promise.all(
    Object.entries(people).map(async ([role, p]) => [role, { privateKey: p.key, accessToken: await token(p.userId), userId: p.userId }]),
  ),
);
await Deno.writeTextFile(`${DIR}/demo-sessions.json`, JSON.stringify(sessions, null, 2));
// the sign-in screen of a local build lists these; gitignored, and only a `local` build ever reads it (U-62)
const picker = Object.entries(people).map(([role, p]) => ({ role, name: p.name, seed: { ...sessions[role], email: p.email } }));
await Deno.writeTextFile(new URL("../apps/web/public/local-demo-sessions.json", import.meta.url), JSON.stringify(picker, null, 2));

console.log(`Demo org "${ORG_NAME}" is org ${orgId}. Pool idle cash is ${Number((await pub.readContract({ ...pool, functionName: "idleCash" })) / 10n ** 18n)} frxUSD.`);
console.log(`Sessions last 12 hours and are in ${DIR}/demo-sessions.json. To sign in as one, run this in the browser console on http://localhost:3000:\n`);
for (const [role, seed] of Object.entries(sessions)) {
  const p = people[role as keyof typeof people];
  console.log(`// ${role}: ${p.name}, ${p.account.address}`);
  console.log(`sessionStorage.setItem(${JSON.stringify(SESSION_KEY)}, ${JSON.stringify(JSON.stringify(seed))}); location.reload();\n`);
}
