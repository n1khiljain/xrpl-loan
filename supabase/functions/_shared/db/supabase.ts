import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables, TablesInsert, TablesUpdate } from "./database.types.ts";
import {
  type Claim,
  type ClaimDocument,
  type ClaimPatch,
  type ClaimScope,
  type ClaimStatus,
  type Db,
  type FraxnetConnection,
  type FraxnetConnectionPatch,
  type FraxnetOAuthState,
  type GuarantorInvite,
  type NewClaim,
  type NotificationData,
  type NotificationKey,
  type Officer,
  type Org,
  type PendingNotification,
  type Profile,
  type StaffRole,
  UniqueViolation,
  type Wallet,
} from "./types.ts";

export type ServiceClient = SupabaseClient<Database>;

type PgError = { code?: string; message: string };

/**
 * numeric(78,0) columns take wei as decimal strings, which Postgres parses exactly. The generated types say
 * `number` because that's how PostgREST would *return* them; we always read them back with `::text`.
 */
const numeric = (wei: string) => wei as unknown as number;

const PROFILE =
  "wallet_address, privy_user_id, email, display_name, kyc_status, kyc_source, kyc_updated_by, kyc_updated_at, fraxnet_account_ref, liquidation_address, created_at";
const CLAIM =
  "id, onchain_claim_id, org_id, recipient_wallet, recipient_type, face_value::text, requested_amount::text, callink_pr_number, description, packet_json, packet_hash, guarantor_wallet, guaranty_signature, guaranty_nonce::text, guaranty_deadline, status_cache, asuc_outcome, asuc_outcome_note, asuc_outcome_at, created_at, updated_at";
const DOCUMENT = "id, claim_id, storage_path, sha256, mime_type, size_bytes, uploaded_by, created_at";
const FRAXNET_CONNECTION =
  "wallet_address, fraxnet_user_id, org_id, org_name, org_verified, org_verified_at, org_is_business, email, scopes, refresh_token, access_token, access_expires_at, needs_reconnect, wallet_added_at, connected_at, checked_at";
const INVITE = "id, claim_id, guarantor_wallet, token_hash, expires_at, used_at, created_at";

type ClaimRow = Omit<Tables<"claims">, "face_value" | "requested_amount" | "guaranty_nonce"> & {
  face_value: string;
  requested_amount: string;
  guaranty_nonce: string | null;
};

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

function toProfile(r: Tables<"profiles">): Profile {
  return {
    wallet: r.wallet_address as Wallet,
    privyUserId: r.privy_user_id,
    email: r.email,
    displayName: r.display_name,
    kycStatus: r.kyc_status,
    kycSource: r.kyc_source,
    kycUpdatedBy: r.kyc_updated_by as Wallet | null,
    kycUpdatedAt: r.kyc_updated_at,
    fraxnetAccountRef: r.fraxnet_account_ref,
    liquidationAddress: r.liquidation_address as Wallet | null,
    createdAt: r.created_at,
  };
}

function profileUpdate(p: Partial<Omit<Profile, "wallet" | "privyUserId" | "createdAt">>): TablesUpdate<"profiles"> {
  const u: TablesUpdate<"profiles"> = {};
  if (p.email !== undefined) u.email = p.email;
  if (p.displayName !== undefined) u.display_name = p.displayName;
  if (p.kycStatus !== undefined) u.kyc_status = p.kycStatus;
  if (p.kycSource !== undefined) u.kyc_source = p.kycSource;
  if (p.kycUpdatedBy !== undefined) u.kyc_updated_by = p.kycUpdatedBy;
  if (p.kycUpdatedAt !== undefined) u.kyc_updated_at = p.kycUpdatedAt;
  if (p.fraxnetAccountRef !== undefined) u.fraxnet_account_ref = p.fraxnetAccountRef;
  if (p.liquidationAddress !== undefined) u.liquidation_address = p.liquidationAddress;
  return u;
}

function toFraxnetConnection(r: Tables<"fraxnet_connections">): FraxnetConnection {
  return {
    wallet: r.wallet_address as Wallet,
    fraxnetUserId: r.fraxnet_user_id,
    orgId: r.org_id,
    orgName: r.org_name,
    orgVerified: r.org_verified,
    orgVerifiedAt: r.org_verified_at,
    orgIsBusiness: r.org_is_business,
    email: r.email,
    scopes: r.scopes,
    refreshToken: r.refresh_token,
    accessToken: r.access_token,
    accessExpiresAt: r.access_expires_at,
    needsReconnect: r.needs_reconnect,
    walletAddedAt: r.wallet_added_at,
    connectedAt: r.connected_at,
    checkedAt: r.checked_at,
  };
}

function fraxnetConnectionUpdate(p: FraxnetConnectionPatch): TablesUpdate<"fraxnet_connections"> {
  const u: TablesUpdate<"fraxnet_connections"> = {};
  if (p.orgId !== undefined) u.org_id = p.orgId;
  if (p.orgName !== undefined) u.org_name = p.orgName;
  if (p.orgVerified !== undefined) u.org_verified = p.orgVerified;
  if (p.orgVerifiedAt !== undefined) u.org_verified_at = p.orgVerifiedAt;
  if (p.orgIsBusiness !== undefined) u.org_is_business = p.orgIsBusiness;
  if (p.email !== undefined) u.email = p.email;
  if (p.scopes !== undefined) u.scopes = p.scopes;
  if (p.refreshToken !== undefined) u.refresh_token = p.refreshToken;
  if (p.accessToken !== undefined) u.access_token = p.accessToken;
  if (p.accessExpiresAt !== undefined) u.access_expires_at = p.accessExpiresAt;
  if (p.needsReconnect !== undefined) u.needs_reconnect = p.needsReconnect;
  if (p.checkedAt !== undefined) u.checked_at = p.checkedAt;
  if (p.walletAddedAt !== undefined) u.wallet_added_at = p.walletAddedAt;
  return u;
}

function toClaim(r: ClaimRow): Claim {
  return {
    id: r.id,
    onchainClaimId: r.onchain_claim_id,
    orgId: r.org_id,
    recipientWallet: r.recipient_wallet as Wallet,
    recipientType: r.recipient_type,
    faceValue: r.face_value,
    requestedAmount: r.requested_amount,
    callinkPrNumber: r.callink_pr_number,
    description: r.description,
    packetJson: r.packet_json,
    packetHash: r.packet_hash as Claim["packetHash"],
    guarantorWallet: r.guarantor_wallet as Wallet | null,
    guarantySignature: r.guaranty_signature as Claim["guarantySignature"],
    guarantyNonce: r.guaranty_nonce,
    guarantyDeadline: r.guaranty_deadline,
    statusCache: r.status_cache,
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

function claimUpdate(p: ClaimPatch): TablesUpdate<"claims"> {
  const u: TablesUpdate<"claims"> = {};
  if (p.onchainClaimId !== undefined) u.onchain_claim_id = p.onchainClaimId;
  if (p.recipientType !== undefined) u.recipient_type = p.recipientType;
  if (p.faceValue !== undefined) u.face_value = numeric(p.faceValue);
  if (p.requestedAmount !== undefined) u.requested_amount = numeric(p.requestedAmount);
  if (p.callinkPrNumber !== undefined) u.callink_pr_number = p.callinkPrNumber;
  if (p.description !== undefined) u.description = p.description;
  if (p.packetJson !== undefined) u.packet_json = p.packetJson as Json;
  if (p.packetHash !== undefined) u.packet_hash = p.packetHash;
  if (p.guarantorWallet !== undefined) u.guarantor_wallet = p.guarantorWallet;
  if (p.guarantySignature !== undefined) u.guaranty_signature = p.guarantySignature;
  if (p.guarantyNonce !== undefined) u.guaranty_nonce = p.guarantyNonce === null ? null : numeric(p.guarantyNonce);
  if (p.guarantyDeadline !== undefined) u.guaranty_deadline = p.guarantyDeadline;
  if (p.statusCache !== undefined) u.status_cache = p.statusCache;
  if (p.asucOutcome !== undefined) u.asuc_outcome = p.asucOutcome;
  if (p.asucOutcomeNote !== undefined) u.asuc_outcome_note = p.asucOutcomeNote;
  if (p.asucOutcomeAt !== undefined) u.asuc_outcome_at = p.asucOutcomeAt;
  return u;
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

/** `Db` over PostgREST with the service role key. Only edge functions build it; the key never leaves them. */
export class SupabaseDb implements Db {
  constructor(private readonly db: ServiceClient) {}

  private claims() {
    return this.db.from("claims").select(CLAIM);
  }

  async getProfile(wallet: Wallet) {
    const row = maybe(await this.db.from("profiles").select(PROFILE).eq("wallet_address", wallet).maybeSingle());
    return row ? toProfile(row) : null;
  }
  async getProfileByPrivyId(privyUserId: string) {
    const row = maybe(await this.db.from("profiles").select(PROFILE).eq("privy_user_id", privyUserId).maybeSingle());
    return row ? toProfile(row) : null;
  }
  async insertProfile(p: Pick<Profile, "wallet" | "privyUserId" | "email" | "displayName">) {
    const row = one(
      await this.db
        .from("profiles")
        .insert({ wallet_address: p.wallet, privy_user_id: p.privyUserId, email: p.email, display_name: p.displayName })
        .select(PROFILE)
        .single(),
    );
    return toProfile(row);
  }
  async updateProfile(wallet: Wallet, patch: Partial<Omit<Profile, "wallet" | "privyUserId" | "createdAt">>) {
    const row = one(
      await this.db.from("profiles").update(profileUpdate(patch)).eq("wallet_address", wallet).select(PROFILE).single(),
    );
    return toProfile(row);
  }

  async getStaffRole(wallet: Wallet) {
    const row = maybe(await this.db.from("staff").select("role").eq("wallet_address", wallet).maybeSingle());
    return row ? (row.role as StaffRole) : null;
  }

  async insertFraxnetState(s: FraxnetOAuthState) {
    done(await this.db.from("fraxnet_oauth_states").delete().eq("wallet_address", s.wallet).lt("expires_at", new Date().toISOString()));
    done(
      await this.db.from("fraxnet_oauth_states").insert({
        state: s.state,
        wallet_address: s.wallet,
        code_verifier: s.codeVerifier,
        nonce: s.nonce,
        expires_at: s.expiresAt,
      }),
    );
  }
  async takeFraxnetState(state: string, wallet: Wallet) {
    // one statement, so two callbacks racing on the same state can't both get it
    const row = maybe(
      await this.db
        .from("fraxnet_oauth_states")
        .delete()
        .eq("state", state)
        .eq("wallet_address", wallet)
        .select("state, wallet_address, code_verifier, nonce, expires_at")
        .maybeSingle(),
    );
    return row
      ? { state: row.state, wallet: row.wallet_address as Wallet, codeVerifier: row.code_verifier, nonce: row.nonce, expiresAt: row.expires_at }
      : null;
  }
  async getFraxnetConnection(wallet: Wallet) {
    const row = maybe(await this.db.from("fraxnet_connections").select(FRAXNET_CONNECTION).eq("wallet_address", wallet).maybeSingle());
    return row ? toFraxnetConnection(row) : null;
  }
  async upsertFraxnetConnection(c: Omit<FraxnetConnection, "connectedAt" | "checkedAt">) {
    const at = new Date().toISOString();
    const row: TablesInsert<"fraxnet_connections"> = {
      wallet_address: c.wallet,
      fraxnet_user_id: c.fraxnetUserId,
      ...fraxnetConnectionUpdate(c),
      org_id: c.orgId,
      org_name: c.orgName,
      org_verified: c.orgVerified,
      connected_at: at,
      checked_at: at,
    };
    return toFraxnetConnection(one(await this.db.from("fraxnet_connections").upsert(row).select(FRAXNET_CONNECTION).single()));
  }
  async updateFraxnetConnection(wallet: Wallet, patch: FraxnetConnectionPatch) {
    return toFraxnetConnection(
      one(
        await this.db
          .from("fraxnet_connections")
          .update(fraxnetConnectionUpdate(patch))
          .eq("wallet_address", wallet)
          .select(FRAXNET_CONNECTION)
          .single(),
      ),
    );
  }

  async getOrg(id: number) {
    return maybe(await this.db.from("orgs").select("id, name, active").eq("id", id).maybeSingle());
  }
  async upsertOrg(org: Org) {
    done(await this.db.from("orgs").upsert({ id: org.id, name: org.name, active: org.active }));
  }
  async setOrgActive(id: number, active: boolean) {
    done(await this.db.from("orgs").update({ active }).eq("id", id));
  }
  async upsertOfficer(o: Omit<Officer, "title">) {
    done(
      await this.db
        .from("org_officers")
        .upsert({ org_id: o.orgId, wallet_address: o.wallet, active: o.active }, { onConflict: "org_id,wallet_address" }),
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
    const row = one(
      await this.db.from("claims").insert(claimInsert(c)).select(CLAIM).single(),
    );
    return toClaim(row);
  }
  async getClaim(id: string) {
    const row = maybe(await this.claims().eq("id", id).maybeSingle());
    return row ? toClaim(row) : null;
  }
  async getClaimByPacketHash(packetHash: string) {
    const row = maybe(await this.claims().eq("packet_hash", packetHash).maybeSingle());
    return row ? toClaim(row) : null;
  }
  async getClaimByOnchainId(onchainClaimId: number) {
    const row = maybe(await this.claims().eq("onchain_claim_id", onchainClaimId).maybeSingle());
    return row ? toClaim(row) : null;
  }
  async updateClaim(id: string, patch: ClaimPatch) {
    const row = one(
      await this.db
        .from("claims")
        .update(claimUpdate(patch))
        .eq("id", id)
        .select(CLAIM)
        .single(),
    );
    return toClaim(row);
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
    return one(await this.claims().in("status_cache", statuses)).map(toClaim);
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

  async reserveGasDrip(wallet: Wallet, windowSeconds: number) {
    const id = maybe(await this.db.rpc("reserve_gas_drip", { p_wallet: wallet, p_window_seconds: windowSeconds }));
    return id === null ? null : String(id);
  }
  async confirmGasDrip(id: string, sent: { txHash: `0x${string}` | null; amountWei: bigint }) {
    done(
      await this.db
        .from("gas_drips")
        .update({ tx_hash: sent.txHash, amount_wei: numeric(sent.amountWei.toString()) })
        .eq("id", Number(id)),
    );
  }
  async releaseGasDrip(id: string) {
    done(await this.db.from("gas_drips").delete().eq("id", Number(id)).is("tx_hash", null));
  }

  async insertAdminAction(a: { actorWallet: Wallet; action: string; target: string; payload: Record<string, unknown> }) {
    done(
      await this.db
        .from("admin_actions")
        .insert({ actor_wallet: a.actorWallet, action: a.action, target: a.target, payload: a.payload as Json }),
    );
  }

  async recordNotification(n: NotificationKey) {
    const result = await this.db
      .from("notifications")
      .insert({ wallet_address: n.wallet, kind: n.kind, claim_id: n.claimId, sent_at: new Date().toISOString(), attempts: 1 });
    if (result.error?.code === "23505") return false;
    done(result);
    return true;
  }
  async enqueueNotification(n: NotificationKey, data: NotificationData) {
    const result = await this.db
      .from("notifications")
      .insert({ wallet_address: n.wallet, kind: n.kind, claim_id: n.claimId, data });
    if (result.error?.code === "23505") return false;
    done(result);
    return true;
  }
  async listPendingNotifications(limit: number): Promise<PendingNotification[]> {
    const rows = one(
      await this.db
        .from("notifications")
        .select("id, wallet_address, kind, claim_id, data, attempts")
        .is("sent_at", null)
        .order("created_at")
        .limit(limit),
    );
    return rows.map((r) => ({
      id: String(r.id),
      wallet: r.wallet_address as Wallet,
      kind: r.kind,
      claimId: r.claim_id,
      data: (r.data ?? {}) as NotificationData,
      attempts: r.attempts,
    }));
  }
  async markNotificationSent(id: string) {
    const row = one(await this.db.from("notifications").select("attempts").eq("id", Number(id)).single());
    done(
      await this.db
        .from("notifications")
        .update({ sent_at: new Date().toISOString(), attempts: row.attempts + 1, last_error: null })
        .eq("id", Number(id)),
    );
  }
  async markNotificationFailed(id: string, error: string) {
    const row = one(await this.db.from("notifications").select("attempts").eq("id", Number(id)).single());
    done(
      await this.db
        .from("notifications")
        .update({ attempts: row.attempts + 1, last_error: error.slice(0, 500) })
        .eq("id", Number(id)),
    );
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

  async getSyncBlock(key: string) {
    const row = maybe(await this.db.from("sync_state").select("last_block").eq("key", key).maybeSingle());
    return row ? row.last_block : null;
  }
  async setSyncBlock(key: string, block: number) {
    done(await this.db.from("sync_state").upsert({ key, last_block: block, updated_at: new Date().toISOString() }));
  }
}
