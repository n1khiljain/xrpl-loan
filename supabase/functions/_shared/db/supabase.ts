import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables, TablesInsert, TablesUpdate } from "./database.types.ts";
import {
  type Claim,
  type ClaimDocument,
  type ClaimPatch,
  type ClaimScope,
  type ClaimStatus,
  type Db,
  type GuarantorInvite,
  type KycStatus,
  type LedgerTx,
  type NewClaim,
  type NotificationKey,
  type Officer,
  type Profile,
  type ProfilePatch,
  type StaffRole,
  UniqueViolation,
  type Wallet,
  type WalletRow,
} from "./types.ts";

export type ServiceClient = SupabaseClient<Database>;

type PgError = { code?: string; message: string };

/**
 * numeric(38,0) columns take base units as decimal strings, which Postgres parses exactly. The generated types say
 * `number` because that's how PostgREST would *return* them; we always read them back with `::text`.
 */
const numeric = (units: string) => units as unknown as number;

const PROFILE =
  "wallet_address, privy_user_id, email, email_verified, display_name, kyc_status, kyc_source, kyc_updated_by, kyc_updated_at, created_at";
const AMOUNTS = ["face_value", "requested_amount", "approved_amount", "purchase_price", "amount_due", "amount_paid", "written_off_principal"] as const;
const CLAIM = [
  "id, number, org_id, recipient_wallet, recipient_type, callink_pr_number, description, packet_json, packet_hash",
  "guarantor_wallet, guaranty_signed_at, status, submitted_at, approved_by, approval_expires_at, reject_reason, fee_bps",
  "purchased_at, due_at, loan_id, call_reason, guarantor_called_at, write_off_eligible_at, principal_written_off",
  "asuc_outcome, asuc_outcome_note, asuc_outcome_at, created_at, updated_at",
  ...AMOUNTS.map((c) => `${c}::text`),
].join(", ");
const DOCUMENT = "id, claim_id, storage_path, sha256, mime_type, size_bytes, uploaded_by, created_at";
const INVITE = "id, claim_id, guarantor_wallet, token_hash, expires_at, used_at, created_at";
const LEDGER_TX = "tx_hash, tx_type, account, claim_id, purpose, result, created_at";

type ClaimRow = Omit<Tables<"claims">, (typeof AMOUNTS)[number]> & Record<(typeof AMOUNTS)[number], string>;

function fail(error: PgError): never {
  if (error.code === "23505") {
    throw new UniqueViolation(/constraint "([^"]+)"/.exec(error.message)?.[1] ?? "unique");
  }
  throw new Error(`database: ${error.message}`);
}

type Result = { data: unknown; error: PgError | null };

function one<R extends Result>(result: R): NonNullable<R["data"]> {
  if (result.error) fail(result.error);
  if (result.data === null || result.data === undefined) throw new Error("database: no row");
  return result.data as NonNullable<R["data"]>;
}

function maybe<R extends Result>(result: R): R["data"] | null {
  if (result.error) fail(result.error);
  return result.data ?? null;
}

function done(result: { error: PgError | null }): void {
  if (result.error) fail(result.error);
}

function toWallet(r: Tables<"wallets">): WalletRow {
  return { address: r.address as Wallet, encryptedSeed: r.encrypted_seed, fundedTx: r.funded_tx, createdAt: r.created_at };
}

function toProfile(r: Tables<"profiles">): Profile {
  return {
    wallet: r.wallet_address as Wallet,
    privyUserId: r.privy_user_id,
    email: r.email,
    emailVerified: r.email_verified,
    displayName: r.display_name,
    kycStatus: r.kyc_status,
    kycSource: r.kyc_source,
    kycUpdatedBy: r.kyc_updated_by as Wallet | null,
    kycUpdatedAt: r.kyc_updated_at,
    createdAt: r.created_at,
  };
}

function profileUpdate(p: ProfilePatch): TablesUpdate<"profiles"> {
  const u: TablesUpdate<"profiles"> = {};
  if (p.email !== undefined) u.email = p.email;
  if (p.emailVerified !== undefined) u.email_verified = p.emailVerified;
  if (p.displayName !== undefined) u.display_name = p.displayName;
  if (p.kycStatus !== undefined) u.kyc_status = p.kycStatus;
  if (p.kycSource !== undefined) u.kyc_source = p.kycSource;
  if (p.kycUpdatedBy !== undefined) u.kyc_updated_by = p.kycUpdatedBy;
  if (p.kycUpdatedAt !== undefined) u.kyc_updated_at = p.kycUpdatedAt;
  return u;
}

function toClaim(row: unknown): Claim {
  const r = row as ClaimRow;
  return {
    id: r.id,
    number: r.number,
    orgId: r.org_id,
    recipientWallet: r.recipient_wallet as Wallet,
    recipientType: r.recipient_type,
    faceValue: r.face_value,
    requestedAmount: r.requested_amount,
    callinkPrNumber: r.callink_pr_number,
    description: r.description,
    packetJson: r.packet_json,
    packetHash: r.packet_hash,
    guarantorWallet: r.guarantor_wallet as Wallet | null,
    guarantySignedAt: r.guaranty_signed_at,
    status: r.status,
    submittedAt: r.submitted_at,
    approvedAmount: r.approved_amount,
    approvedBy: r.approved_by as Wallet | null,
    approvalExpiresAt: r.approval_expires_at,
    rejectReason: r.reject_reason,
    feeBps: r.fee_bps,
    purchasePrice: r.purchase_price,
    amountDue: r.amount_due,
    amountPaid: r.amount_paid,
    purchasedAt: r.purchased_at,
    dueAt: r.due_at,
    loanId: r.loan_id,
    callReason: r.call_reason,
    guarantorCalledAt: r.guarantor_called_at,
    writeOffEligibleAt: r.write_off_eligible_at,
    principalWrittenOff: r.principal_written_off,
    writtenOffPrincipal: r.written_off_principal,
    asucOutcome: r.asuc_outcome,
    asucOutcomeNote: r.asuc_outcome_note,
    asucOutcomeAt: r.asuc_outcome_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function claimInsert(c: NewClaim): TablesInsert<"claims"> {
  return {
    org_id: c.orgId,
    recipient_wallet: c.recipientWallet,
    recipient_type: c.recipientType,
    face_value: numeric(c.faceValue),
    requested_amount: numeric(c.requestedAmount),
    callink_pr_number: c.callinkPrNumber,
    description: c.description,
    guarantor_wallet: c.guarantorWallet,
  };
}

/** camelCase patch keys to columns; amounts go through `numeric` so they stay exact. */
const CLAIM_COLUMNS: Record<keyof ClaimPatch, keyof TablesUpdate<"claims">> = {
  recipientType: "recipient_type",
  faceValue: "face_value",
  requestedAmount: "requested_amount",
  callinkPrNumber: "callink_pr_number",
  description: "description",
  packetJson: "packet_json",
  packetHash: "packet_hash",
  guarantorWallet: "guarantor_wallet",
  guarantySignedAt: "guaranty_signed_at",
  status: "status",
  submittedAt: "submitted_at",
  approvedAmount: "approved_amount",
  approvedBy: "approved_by",
  approvalExpiresAt: "approval_expires_at",
  rejectReason: "reject_reason",
  feeBps: "fee_bps",
  purchasePrice: "purchase_price",
  amountDue: "amount_due",
  amountPaid: "amount_paid",
  purchasedAt: "purchased_at",
  dueAt: "due_at",
  loanId: "loan_id",
  callReason: "call_reason",
  guarantorCalledAt: "guarantor_called_at",
  writeOffEligibleAt: "write_off_eligible_at",
  principalWrittenOff: "principal_written_off",
  writtenOffPrincipal: "written_off_principal",
  asucOutcome: "asuc_outcome",
  asucOutcomeNote: "asuc_outcome_note",
  asucOutcomeAt: "asuc_outcome_at",
};

function claimUpdate(p: ClaimPatch): TablesUpdate<"claims"> {
  const u: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(p)) {
    if (value === undefined) continue;
    const column = CLAIM_COLUMNS[key as keyof ClaimPatch];
    u[column] = (AMOUNTS as readonly string[]).includes(column) ? numeric(value as string) : key === "packetJson" ? (value as Json) : value;
  }
  return u as TablesUpdate<"claims">;
}

function toDocument(r: Tables<"claim_documents">): ClaimDocument {
  return {
    id: r.id,
    claimId: r.claim_id,
    storagePath: r.storage_path,
    sha256: r.sha256,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    uploadedBy: r.uploaded_by as Wallet,
    createdAt: r.created_at,
  };
}

function toInvite(r: Tables<"guarantor_invites">): GuarantorInvite {
  return {
    id: r.id,
    claimId: r.claim_id,
    guarantorWallet: r.guarantor_wallet as Wallet,
    tokenHash: r.token_hash,
    expiresAt: r.expires_at,
    usedAt: r.used_at,
    createdAt: r.created_at,
  };
}

function toLedgerTx(r: Omit<Tables<"ledger_txs">, "id">): LedgerTx {
  return {
    txHash: r.tx_hash,
    txType: r.tx_type,
    account: r.account as Wallet,
    claimId: r.claim_id,
    purpose: r.purpose,
    result: r.result,
    createdAt: r.created_at,
  };
}

/** `Db` over PostgREST with the service role key. Only edge functions build it; the key never leaves them. */
export class SupabaseDb implements Db {
  constructor(private readonly db: ServiceClient) {}

  private claims() {
    return this.db.from("claims").select(CLAIM);
  }

  async insertWallet(w: Pick<WalletRow, "address" | "encryptedSeed">) {
    return toWallet(one(await this.db.from("wallets").insert({ address: w.address, encrypted_seed: w.encryptedSeed }).select("*").single()));
  }
  async getWallet(address: Wallet) {
    const row = maybe(await this.db.from("wallets").select("*").eq("address", address).maybeSingle());
    return row ? toWallet(row) : null;
  }
  async setWalletFunded(address: Wallet, txHash: string) {
    done(await this.db.from("wallets").update({ funded_tx: txHash }).eq("address", address));
  }

  async getProfile(wallet: Wallet) {
    const row = maybe(await this.db.from("profiles").select(PROFILE).eq("wallet_address", wallet).maybeSingle());
    return row ? toProfile(row) : null;
  }
  async getProfileByPrivyId(privyUserId: string) {
    const row = maybe(await this.db.from("profiles").select(PROFILE).eq("privy_user_id", privyUserId).maybeSingle());
    return row ? toProfile(row) : null;
  }
  async insertProfile(p: Pick<Profile, "wallet" | "privyUserId" | "email" | "emailVerified" | "displayName">) {
    const row = one(
      await this.db
        .from("profiles")
        .insert({
          wallet_address: p.wallet,
          privy_user_id: p.privyUserId,
          email: p.email,
          email_verified: p.emailVerified,
          display_name: p.displayName,
        })
        .select(PROFILE)
        .single(),
    );
    return toProfile(row);
  }
  async updateProfile(wallet: Wallet, patch: ProfilePatch) {
    const row = one(
      await this.db.from("profiles").update(profileUpdate(patch)).eq("wallet_address", wallet).select(PROFILE).single(),
    );
    return toProfile(row);
  }
  async listProfilesByKyc(statuses: KycStatus[]) {
    const rows = one(
      await this.db.from("profiles").select(PROFILE).in("kyc_status", statuses).order("created_at", { ascending: false }).limit(200),
    );
    return rows.map(toProfile);
  }

  async getStaffRole(wallet: Wallet) {
    const row = maybe(await this.db.from("staff").select("role").eq("wallet_address", wallet).maybeSingle());
    return row ? (row.role as StaffRole) : null;
  }

  async insertOrg(name: string) {
    return one(await this.db.from("orgs").insert({ name }).select("id, name, active").single());
  }
  async getOrg(id: number) {
    return maybe(await this.db.from("orgs").select("id, name, active").eq("id", id).maybeSingle());
  }
  async listOrgs() {
    return one(await this.db.from("orgs").select("id, name, active").order("id"));
  }
  async setOrgActive(id: number, active: boolean) {
    done(await this.db.from("orgs").update({ active }).eq("id", id));
  }
  async upsertOfficer(o: Officer) {
    done(
      await this.db
        .from("org_officers")
        .upsert({ org_id: o.orgId, wallet_address: o.wallet, title: o.title, active: o.active }, { onConflict: "org_id,wallet_address" }),
    );
  }
  async isActiveOfficer(orgId: number, wallet: Wallet) {
    const row = maybe(
      await this.db.from("org_officers").select("active").eq("org_id", orgId).eq("wallet_address", wallet).maybeSingle(),
    );
    return row?.active === true;
  }
  async listOfficerOrgs(wallet: Wallet) {
    const rows = one(
      await this.db
        .from("org_officers")
        .select("org_id, title, orgs(name)")
        .eq("wallet_address", wallet)
        .eq("active", true)
        .order("org_id"),
    );
    return rows.map((r) => ({ orgId: r.org_id, title: r.title, name: r.orgs?.name ?? "" }));
  }
  async listActiveOrgsWithOfficers() {
    const orgs = one(await this.db.from("orgs").select("id, name, active").eq("active", true).order("id"));
    const officers = one(
      await this.db.from("org_officers").select("org_id, wallet_address, title").eq("active", true).in("org_id", orgs.map((o) => o.id)),
    );
    const wallets = [...new Set(officers.map((o) => o.wallet_address))];
    const names = wallets.length
      ? one(await this.db.from("profiles").select("wallet_address, display_name").in("wallet_address", wallets))
      : [];
    const nameOf = new Map(names.map((n) => [n.wallet_address, n.display_name]));
    return orgs.map((org) => ({
      ...org,
      officers: officers
        .filter((o) => o.org_id === org.id)
        .map((o) => ({ wallet: o.wallet_address as Wallet, title: o.title, displayName: nameOf.get(o.wallet_address) ?? null })),
    }));
  }

  async insertClaim(c: NewClaim) {
    const row = one(await this.db.from("claims").insert(claimInsert(c)).select(CLAIM).returns<ClaimRow[]>().single());
    return toClaim(row);
  }
  async getClaim(id: string) {
    const row = maybe(await this.claims().eq("id", id).maybeSingle());
    return row ? toClaim(row) : null;
  }
  async updateClaim(id: string, patch: ClaimPatch) {
    const row = one(await this.db.from("claims").update(claimUpdate(patch)).eq("id", id).select(CLAIM).returns<ClaimRow[]>().single());
    return toClaim(row);
  }
  async transitionClaim(id: string, from: ClaimStatus[], patch: ClaimPatch) {
    // one statement with the status in the filter, so a second request racing this one updates nothing
    const row = maybe(
      await this.db
        .from("claims")
        .update(claimUpdate(patch))
        .eq("id", id)
        .in("status", from)
        .select(CLAIM)
        .returns<ClaimRow[]>()
        .maybeSingle(),
    );
    return row ? toClaim(row) : null;
  }
  async listClaims(scope: ClaimScope) {
    let query = this.claims().order("created_at", { ascending: false });
    if (scope.kind === "reported") query = query.neq("asuc_outcome", "none");
    if (scope.kind === "wallet") {
      const clauses = [`recipient_wallet.eq.${scope.wallet}`, `guarantor_wallet.eq.${scope.wallet}`];
      const orgIds = scope.officerOrgIds.filter((id) => Number.isSafeInteger(id));
      if (orgIds.length > 0) clauses.push(`org_id.in.(${orgIds.join(",")})`);
      query = query.or(clauses.join(","));
    }
    return one(await query).map(toClaim);
  }
  async listClaimsByStatus(statuses: ClaimStatus[]) {
    return one(await this.claims().in("status", statuses)).map(toClaim);
  }

  async insertDocument(d: Omit<ClaimDocument, "id" | "createdAt" | "sha256"> & { id?: string }) {
    const row = one(
      await this.db
        .from("claim_documents")
        .insert({
          ...(d.id ? { id: d.id } : {}),
          claim_id: d.claimId,
          storage_path: d.storagePath,
          mime_type: d.mimeType,
          size_bytes: d.sizeBytes,
          uploaded_by: d.uploadedBy,
        })
        .select(DOCUMENT)
        .single(),
    );
    return toDocument(row);
  }
  async getDocument(id: string) {
    const row = maybe(await this.db.from("claim_documents").select(DOCUMENT).eq("id", id).maybeSingle());
    return row ? toDocument(row) : null;
  }
  async listDocuments(claimId: string) {
    const rows = one(await this.db.from("claim_documents").select(DOCUMENT).eq("claim_id", claimId).order("created_at"));
    return rows.map(toDocument);
  }
  async setDocumentHash(id: string, sha256: string) {
    const row = one(await this.db.from("claim_documents").update({ sha256 }).eq("id", id).select(DOCUMENT).single());
    return toDocument(row);
  }

  async insertInvite(i: Omit<GuarantorInvite, "id" | "createdAt" | "usedAt">) {
    const row = one(
      await this.db
        .from("guarantor_invites")
        .insert({ claim_id: i.claimId, guarantor_wallet: i.guarantorWallet, token_hash: i.tokenHash, expires_at: i.expiresAt })
        .select(INVITE)
        .single(),
    );
    return toInvite(row);
  }
  async getInviteByTokenHash(tokenHash: string) {
    const row = maybe(await this.db.from("guarantor_invites").select(INVITE).eq("token_hash", tokenHash).maybeSingle());
    return row ? toInvite(row) : null;
  }
  async markInviteUsed(id: string) {
    done(
      await this.db.from("guarantor_invites").update({ used_at: new Date().toISOString() }).eq("id", id).is("used_at", null),
    );
  }
  async countInvitesSince(claimId: string, since: string) {
    const result = await this.db
      .from("guarantor_invites")
      .select("id", { count: "exact", head: true })
      .eq("claim_id", claimId)
      .gte("created_at", since);
    if (result.error) fail(result.error);
    return result.count ?? 0;
  }

  async recordLedgerTx(tx: Omit<LedgerTx, "createdAt">) {
    done(
      await this.db.from("ledger_txs").upsert(
        { tx_hash: tx.txHash, tx_type: tx.txType, account: tx.account, claim_id: tx.claimId, purpose: tx.purpose, result: tx.result },
        { onConflict: "tx_hash", ignoreDuplicates: true },
      ),
    );
  }
  async listLedgerTxs(filter: { claimId?: string; account?: Wallet; limit?: number }) {
    let query = this.db.from("ledger_txs").select(LEDGER_TX).order("created_at").limit(filter.limit ?? 50);
    if (filter.claimId !== undefined) query = query.eq("claim_id", filter.claimId);
    if (filter.account !== undefined) query = query.eq("account", filter.account);
    return one(await query).map(toLedgerTx);
  }

  async insertAdminAction(a: { actorWallet: Wallet; action: string; target: string; payload: Record<string, unknown> }) {
    done(
      await this.db
        .from("admin_actions")
        .insert({ actor_wallet: a.actorWallet, action: a.action, target: a.target, payload: a.payload as { [key: string]: Json } }),
    );
  }

  async recordNotification(n: NotificationKey) {
    const result = await this.db.from("notifications").insert({ wallet_address: n.wallet, kind: n.kind, claim_id: n.claimId });
    if (result.error?.code === "23505") return false;
    done(result);
    return true;
  }

  async claimOnce(key: string) {
    const result = await this.db.from("once_keys").insert({ key });
    if (result.error?.code === "23505") return false;
    done(result);
    return true;
  }
  async releaseOnce(key: string) {
    done(await this.db.from("once_keys").delete().eq("key", key));
  }

  async getSyncLedger(key: string) {
    const row = maybe(await this.db.from("sync_state").select("last_ledger").eq("key", key).maybeSingle());
    return row ? row.last_ledger : null;
  }
  async setSyncLedger(key: string, ledger: number) {
    done(await this.db.from("sync_state").upsert({ key, last_ledger: ledger, updated_at: new Date().toISOString() }));
  }
}
