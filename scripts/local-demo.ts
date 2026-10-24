/**
 * Sets up the local stack so you can click through the app in a browser without Privy:
 *   deno run --allow-all --config supabase/functions/deno.json scripts/local-demo.ts [dir]
 *
 * Needs `supabase start` and `supabase functions serve --env-file <dir>/functions.env`, where <dir> (default
 * apps/web/e2e/.cache) holds the env file and Privy test key from supabase/functions/_tests/make-e2e-env.ts. It signs
 * up four demo people through the real `me` function, so each gets a custodial wallet funded by the XRPL Devnet
 * faucet; makes the staff person an admin; verifies everyone; adds a demo org with the officer; and gives the member
 * reimbursements in different states. It writes each person's session to apps/web/public/local-demo-sessions.json,
 * which a build with NEXT_PUBLIC_DEMO_SESSIONS=true offers as one-click buttons (gitignored). Run it again any time;
 * it only adds what's missing. Local Supabase only; XRPL Devnet only.
 */
import { type JWK, SignJWT, importJWK } from "jose";
import { LOCAL_STACK } from "../supabase/functions/_shared/local-stack.ts";
import { assertLocal, ensureLocalStaff } from "../supabase/functions/_tests/local-underwriter.ts";

const DIR = Deno.args[0] ?? new URL("../apps/web/e2e/.cache", import.meta.url).pathname;
const ORG_NAME = "Blockchain at Berkeley (demo)";
const USD = 1_000_000n;

if (!LOCAL_STACK) throw new Error("no local Supabase running (supabase start)");
assertLocal(LOCAL_STACK.url);
const API = `${LOCAL_STACK.url}/functions/v1`;

const env = Object.fromEntries(
  (await Deno.readTextFile(`${DIR}/functions.env`))
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
if (env.NETWORK !== "xrpl-devnet") throw new Error("the demo only runs against XRPL Devnet");
const signingKey = await importJWK(JSON.parse(await Deno.readTextFile(`${DIR}/privy-test.jwk.json`)) as JWK, "ES256");

const jwt = (userId: string, claims: Record<string, unknown>, ttl = "30d") =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setIssuer("privy.io")
    .setAudience(env.PRIVY_APP_ID as string)
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(signingKey);

type Persona = { role: string; userId: string; name: string; email: string; accessToken: string; identityToken: string; wallet?: string };

async function persona(role: string, userId: string, name: string, email: string): Promise<Persona> {
  return {
    role,
    userId,
    name,
    email,
    accessToken: await jwt(userId, { sid: "local-demo" }),
    identityToken: await jwt(userId, { linked_accounts: JSON.stringify([{ type: "email", address: email }]) }),
  };
}

async function api<T>(who: Persona, name: string, method: string, body?: unknown, query = ""): Promise<T> {
  const res = await fetch(`${API}/${name}${query}`, {
    method,
    headers: { authorization: `Bearer ${who.accessToken}`, "content-type": "application/json", apikey: LOCAL_STACK!.anonKey },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${name} as ${who.role}: ${res.status} ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

const staff = await persona("staff", "did:privy:demo-staff", "Pilot admin", "admin@example.test");
const claimant = await persona("claimant", "did:privy:demo-claimant", "Jordan Park", "jordan@example.test");
const guarantor = await persona("guarantor", "did:privy:demo-guarantor", "Sam Rivera", "sam@example.test");
const lender = await persona("lender", "did:privy:demo-lender", "Pilot lender", "lender@example.test");
const people = [staff, claimant, guarantor, lender];

// 1. everyone signs up: a custodial wallet each, funded by the Devnet faucet
for (const p of people) {
  const me = await api<{ profile: { wallet: string } }>(p, "me", "POST", { identityToken: p.identityToken, email: p.email, displayName: p.name });
  p.wallet = me.profile.wallet;
}
await ensureLocalStaff(LOCAL_STACK, staff.wallet as string, "admin");

// 2. everyone is verified
for (const p of people) {
  await api(staff, "kyc-manual", "POST", { wallet: p.wallet, status: "approved", note: "local demo" });
}

// 3. the org and its officer
const { orgs } = await api<{ orgs: Array<{ id: number; name: string }> }>(staff, "orgs", "GET");
const org = orgs.find((o) => o.name === ORG_NAME) ?? (await api<{ org: { id: number } }>(staff, "orgs", "POST", { action: "create", name: ORG_NAME })).org;
await api(staff, "orgs", "POST", { action: "set-officer", orgId: org.id, wallet: guarantor.wallet, title: "Treasurer", active: true });

// 4. reimbursements in different states, made once
type Claim = { id: string; callinkPrNumber: string; status: string };
const { claims } = await api<{ claims: Claim[] }>(claimant, "claims", "GET");
const have = new Set(claims.map((c) => c.callinkPrNumber));
const PDF = new TextEncoder().encode("%PDF-1.4\n% demo receipt\n");

async function draft(pr: string, dollars: bigint, description: string): Promise<string> {
  const { claim } = await api<{ claim: { id: string } }>(claimant, "claims", "POST", {
    orgId: org.id,
    faceValue: (dollars * USD).toString(),
    requestedAmount: (dollars * USD).toString(),
    callinkPrNumber: pr,
    description,
    guarantorWallet: guarantor.wallet,
  });
  const created = await api<{ document: { id: string }; upload: { path: string; token: string } }>(claimant, "documents", "POST", {
    action: "create",
    claimId: claim.id,
    mimeType: "application/pdf",
    sizeBytes: PDF.byteLength,
  });
  const form = new FormData();
  form.append("", new Blob([PDF], { type: "application/pdf" }));
  const up = await fetch(`${LOCAL_STACK!.url}/storage/v1/object/upload/sign/receipts/${created.upload.path}?token=${created.upload.token}`, {
    method: "PUT",
    headers: { apikey: LOCAL_STACK!.anonKey, authorization: `Bearer ${LOCAL_STACK!.anonKey}` },
    body: form,
  });
  if (!up.ok) throw new Error(`upload failed: ${up.status} ${await up.text()}`);
  await api(claimant, "documents", "POST", { action: "confirm", documentId: created.document.id });
  return claim.id;
}

async function signOff(id: string) {
  const { packetHash } = await api<{ packetHash: string }>(claimant, "packet", "POST", { claimId: id });
  await api(guarantor, "guaranty", "POST", { claimId: id, packetHash });
}

const STEPS: Array<{ pr: string; dollars: bigint; description: string; to: "draft" | "signed" | "submitted" | "approved" }> = [
  { pr: "PR-DEMO-1", dollars: 2400n, description: "Hackathon catering", to: "approved" },
  { pr: "PR-DEMO-2", dollars: 850n, description: "AV rental", to: "submitted" },
  { pr: "PR-DEMO-3", dollars: 320n, description: "T-shirts", to: "signed" },
  { pr: "PR-DEMO-4", dollars: 120n, description: "Prize gift cards", to: "draft" },
];
for (const step of STEPS) {
  if (have.has(step.pr)) continue;
  const id = await draft(step.pr, step.dollars, step.description);
  if (step.to === "draft") {
    await api(claimant, "packet", "POST", { claimId: id });
    continue;
  }
  await signOff(id);
  if (step.to === "signed") continue;
  await api(claimant, "claim-actions", "POST", { action: "submit", claimId: id });
  if (step.to === "approved") await api(staff, "claim-actions", "POST", { action: "approve", claimId: id, amount: (step.dollars * USD).toString() });
}

// 5. one-click sessions for the sign-in screen
const sessions = people.map((p) => ({
  role: p.role,
  name: p.name,
  seed: { accessToken: p.accessToken, identityToken: p.identityToken, userId: p.userId, email: p.email },
}));
await Deno.writeTextFile(new URL("../apps/web/public/local-demo-sessions.json", import.meta.url), JSON.stringify(sessions, null, 2));
await Deno.writeTextFile(`${DIR}/demo-sessions.json`, JSON.stringify(sessions, null, 2));
console.log(`demo ready: ${people.map((p) => `${p.role} ${p.wallet}`).join(", ")}`);
