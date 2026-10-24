/**
 * Sets up the local stack so you can click through the app in a browser without Privy:
 *   deno run --allow-all --config supabase/functions/deno.json scripts/local-demo.ts [dir]
 *
 * Needs `supabase start` and `supabase functions serve --env-file <dir>/functions.env`, where <dir> (default
 * apps/web/e2e/.cache) holds the env file and Privy test key from supabase/functions/_tests/make-e2e-env.ts. It signs
 * up four demo people through the real `me` function, so each gets a custodial wallet funded by the XRPL Devnet
 * faucet; makes the staff person an admin; verifies everyone; adds a demo business with its approver; and gives the borrower
 * loans of different kinds in different states: a card settlement, an invoice, a business reimbursement the approver
 * signs off on, and a draft. It writes each person's session to apps/web/public/local-demo-sessions.json,
 * which a build with NEXT_PUBLIC_DEMO_SESSIONS=true offers as one-click buttons (gitignored). Run it again any time;
 * it only adds what's missing. Local Supabase only; XRPL Devnet only.
 */
import { type JWK, SignJWT, importJWK } from "jose";
import { LOCAL_STACK } from "../supabase/functions/_shared/local-stack.ts";
import { assertLocal, ensureLocalStaff } from "../supabase/functions/_tests/local-underwriter.ts";

const DIR = Deno.args[0] ?? new URL("../apps/web/e2e/.cache", import.meta.url).pathname;
const ORG_NAME = "Northwind Supply (demo)";
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
const seller = await persona("seller", "did:privy:demo-seller", "Jordan Park", "jordan@example.test");
const guarantor = await persona("guarantor", "did:privy:demo-guarantor", "Sam Rivera", "sam@example.test");
const lender = await persona("lender", "did:privy:demo-lender", "Pilot lender", "lender@example.test");
const people = [staff, seller, guarantor, lender];

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

// 3. the business and its approver
const { orgs } = await api<{ orgs: Array<{ id: number; name: string }> }>(staff, "orgs", "GET");
const org = orgs.find((o) => o.name === ORG_NAME) ?? (await api<{ org: { id: number } }>(staff, "orgs", "POST", { action: "create", name: ORG_NAME })).org;
await api(staff, "orgs", "POST", { action: "set-officer", orgId: org.id, wallet: guarantor.wallet, title: "Finance lead", active: true });

// 4. receivables of each kind, in different states, made once
type Receivable = { id: string; reference: string; status: string };
const { receivables } = await api<{ receivables: Receivable[] }>(seller, "receivables", "GET");
const have = new Set(receivables.map((c) => c.reference));
const PDF = new TextEncoder().encode("%PDF-1.4\n% demo invoice\n");

/** YYYY-MM-DD, `days` from today. */
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

type Draft = {
  type: "card_settlement" | "reimbursement" | "invoice" | "other";
  reference: string;
  payerName: string;
  payerEmail?: string;
  dueInDays: number;
  face: bigint;
  dollars: bigint;
  description: string;
  /** a business loan: the demo business, with its approver signing off */
  org?: boolean;
  to: "draft" | "signed" | "submitted" | "approved";
};

async function draft(d: Draft): Promise<string> {
  const { receivable } = await api<{ receivable: { id: string } }>(seller, "receivables", "POST", {
    type: d.type,
    payerName: d.payerName,
    ...(d.payerEmail ? { payerEmail: d.payerEmail } : {}),
    dueDate: inDays(d.dueInDays),
    ...(d.org ? { orgId: org.id, guarantorWallet: guarantor.wallet } : {}),
    faceValue: (d.face * USD).toString(),
    requestedAmount: (d.dollars * USD).toString(),
    reference: d.reference,
    description: d.description,
  });
  const created = await api<{ document: { id: string }; upload: { path: string; token: string } }>(seller, "documents", "POST", {
    action: "create",
    receivableId: receivable.id,
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
  await api(seller, "documents", "POST", { action: "confirm", documentId: created.document.id });
  return receivable.id;
}

const DRAFTS: Draft[] = [
  {
    type: "card_settlement",
    reference: "STRIPE-PO-48213",
    payerName: "Stripe",
    dueInDays: 3,
    face: 2400n,
    dollars: 2280n,
    description: "Weekend card sales waiting on the Stripe payout",
    to: "approved",
  },
  {
    type: "invoice",
    reference: "INV-1042",
    payerName: "Acme Supply Co.",
    payerEmail: "ap@acme.example",
    dueInDays: 30,
    face: 1850n,
    dollars: 1700n,
    description: "Net-30 invoice for catering supplies",
    to: "submitted",
  },
  {
    type: "reimbursement",
    reference: "EXP-DEMO-3",
    payerName: "Northwind Supply",
    dueInDays: 45,
    face: 320n,
    dollars: 320n,
    description: "Travel expenses Northwind owes back",
    org: true,
    to: "signed",
  },
  {
    type: "other",
    reference: "DEPOSIT-77",
    payerName: "Bayview Properties",
    dueInDays: 14,
    face: 1200n,
    dollars: 1000n,
    description: "Security deposit refund owed by the old landlord",
    to: "draft",
  },
];

for (const d of DRAFTS) {
  if (have.has(d.reference)) continue;
  const id = await draft(d);
  if (d.to === "draft") continue;
  const { packetHash } = await api<{ packetHash: string }>(seller, "packet", "POST", { receivableId: id });
  if (d.org) await api(guarantor, "guaranty", "POST", { receivableId: id, packetHash });
  if (d.to === "signed") continue;
  await api(seller, "receivable-actions", "POST", { action: "submit", receivableId: id });
  if (d.to === "approved") await api(staff, "receivable-actions", "POST", { action: "approve", receivableId: id, amount: (d.dollars * USD).toString() });
}

// 5. one-click sessions for the sign-in screen
/** How each person shows on the sign-in screen's demo list. */
const LABEL: Record<string, string> = {
  staff: "Pilot admin",
  seller: "Jordan Park, small business owner",
  guarantor: "Sam Rivera, approver at Northwind Supply",
  lender: "Pilot lender",
};
const sessions = people.map((p) => ({
  role: p.role,
  name: LABEL[p.role] ?? p.name,
  seed: { accessToken: p.accessToken, identityToken: p.identityToken, userId: p.userId, email: p.email },
}));
await Deno.writeTextFile(new URL("../apps/web/public/local-demo-sessions.json", import.meta.url), JSON.stringify(sessions, null, 2));
await Deno.writeTextFile(`${DIR}/demo-sessions.json`, JSON.stringify(sessions, null, 2));
console.log(`demo ready: ${people.map((p) => `${p.role} ${p.wallet}`).join(", ")}`);
