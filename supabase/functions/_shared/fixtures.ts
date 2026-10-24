import { assertEquals } from "@std/assert";
import type { Claim, Wallet } from "./db/types.ts";
import { FIXED_NOW, MemoryDb, type TestUser, makeUser, seedOrg, testConfig } from "./testing.ts";
import { MemoryStorage } from "./storage.ts";

/** A claimant, a guarantor officer, an org, and a draft with confirmed receipts, ready to freeze. */
export async function draftWorld(opts: { receipts?: string[] } = {}) {
  const db = new MemoryDb(() => FIXED_NOW);
  const storage = new MemoryStorage();
  const config = testConfig();
  const claimant = await makeUser(db, { name: "Ada", kyc: "approved" });
  const guarantor = await makeUser(db, { name: "Grace", kyc: "approved" });
  const outsider = await makeUser(db);
  seedOrg(db, 1, "Blockchain at Berkeley", [guarantor.wallet]);
  const claim = await db.insertClaim({
    orgId: 1,
    recipientWallet: claimant.wallet,
    recipientType: "member",
    faceValue: "500000000",
    requestedAmount: "400000000",
    callinkPrNumber: "PR-2026-0042",
    description: "Hackathon snacks",
    guarantorWallet: guarantor.wallet,
  });
  for (const [i, text] of (opts.receipts ?? ["receipt one"]).entries()) {
    await addReceipt(db, storage, claim, claimant, text, i);
  }
  return { db, storage, config, claimant, guarantor, outsider, claim };
}

export async function addReceipt(db: MemoryDb, storage: MemoryStorage, claim: Claim, by: TestUser, text: string, i = 0) {
  const bytes = new TextEncoder().encode(text);
  const doc = await db.insertDocument({
    claimId: claim.id,
    storagePath: `${claim.id}/doc-${i}-${crypto.randomUUID()}`,
    mimeType: "application/pdf",
    sizeBytes: bytes.byteLength,
    uploadedBy: by.wallet,
  });
  storage.put(doc.storagePath, bytes);
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return db.setDocumentHash(doc.id, digest);
}

export function assertStatus(res: { status: number; body: { error?: { code: string } } }, status: number, code?: string) {
  assertEquals(res.status, status, JSON.stringify(res.body));
  if (code) assertEquals(res.body.error?.code, code);
}

export type { Wallet };
