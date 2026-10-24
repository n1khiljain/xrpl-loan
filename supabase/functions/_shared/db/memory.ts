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

type Drip = { id: string; wallet: Wallet; at: number; txHash: string | null; amountWei: bigint };

/** In-memory `Db` with the same constraints the migrations enforce. Tests use it; it never ships. */
export class MemoryDb implements Db {
  readonly profiles = new Map<Wallet, Profile>();
  readonly staff = new Map<Wallet, StaffRole>();
  readonly orgs = new Map<number, Org>();
  readonly officers = new Map<string, Officer>();
  readonly claims = new Map<string, Claim>();
  readonly documents = new Map<string, ClaimDocument>();
  readonly invites = new Map<string, GuarantorInvite>();
  readonly drips = new Map<string, Drip>();
  readonly adminActions: Array<{ actorWallet: Wallet; action: string; target: string; payload: Record<string, unknown> }> = [];
  readonly notifications = new Map<
    string,
    NotificationKey & { id: string; data: NotificationData; sentAt: string | null; attempts: number; lastError: string | null }
  >();
  readonly sync = new Map<string, number>();
  readonly onceKeys = new Set<string>();
  readonly fraxnetStates = new Map<string, FraxnetOAuthState>();
  readonly fraxnetConnections = new Map<Wallet, FraxnetConnection>();
  private seq = 0;

  constructor(private readonly now: () => Date = () => new Date()) {}

  private stamp() {
    return this.now().toISOString();
  }
  private uuid() {
    return crypto.randomUUID();
  }

  async getProfile(wallet: Wallet) {
    return this.profiles.get(wallet) ?? null;
  }
  async getProfileByPrivyId(privyUserId: string) {
    return [...this.profiles.values()].find((p) => p.privyUserId === privyUserId) ?? null;
  }
  async insertProfile(p: Pick<Profile, "wallet" | "privyUserId" | "email" | "displayName">) {
    if (this.profiles.has(p.wallet)) throw new UniqueViolation("profiles_pkey");
    if (await this.getProfileByPrivyId(p.privyUserId)) throw new UniqueViolation("profiles_privy_user_id_key");
    const row: Profile = {
      ...p,
      kycStatus: "not_started",
      kycSource: null,
      kycUpdatedBy: null,
      kycUpdatedAt: null,
      fraxnetAccountRef: null,
      liquidationAddress: null,
      createdAt: this.stamp(),
    };
    this.profiles.set(p.wallet, row);
    return row;
  }
  async updateProfile(wallet: Wallet, patch: Partial<Omit<Profile, "wallet" | "privyUserId" | "createdAt">>) {
    const row = this.profiles.get(wallet);
    if (!row) throw new Error(`no profile ${wallet}`);
    const next = { ...row, ...patch };
    this.profiles.set(wallet, next);
    return next;
  }

  async getStaffRole(wallet: Wallet) {
    return this.staff.get(wallet) ?? null;
  }

  async insertFraxnetState(s: FraxnetOAuthState) {
    if (!this.profiles.has(s.wallet)) throw new Error("fraxnet_oauth_states_wallet_address_fkey");
    if (this.fraxnetStates.has(s.state)) throw new UniqueViolation("fraxnet_oauth_states_pkey");
    for (const [key, old] of this.fraxnetStates) {
      if (old.wallet === s.wallet && old.expiresAt < this.stamp()) this.fraxnetStates.delete(key);
    }
    this.fraxnetStates.set(s.state, { ...s });
  }
  async takeFraxnetState(state: string, wallet: Wallet) {
    const row = this.fraxnetStates.get(state);
    if (!row || row.wallet !== wallet) return null;
    this.fraxnetStates.delete(state);
    return row;
  }
  async getFraxnetConnection(wallet: Wallet) {
    return this.fraxnetConnections.get(wallet) ?? null;
  }
  async upsertFraxnetConnection(c: Omit<FraxnetConnection, "connectedAt" | "checkedAt">) {
    if (!this.profiles.has(c.wallet)) throw new Error("fraxnet_connections_wallet_address_fkey");
    for (const other of this.fraxnetConnections.values()) {
      if (other.wallet !== c.wallet && other.fraxnetUserId === c.fraxnetUserId) {
        throw new UniqueViolation("fraxnet_connections_fraxnet_user_id_key");
      }
    }
    const row: FraxnetConnection = { ...c, scopes: [...c.scopes], connectedAt: this.stamp(), checkedAt: this.stamp() };
    this.fraxnetConnections.set(c.wallet, row);
    return row;
  }
  async updateFraxnetConnection(wallet: Wallet, patch: FraxnetConnectionPatch) {
    const row = this.fraxnetConnections.get(wallet);
    if (!row) throw new Error(`no fraxnet connection ${wallet}`);
    const next = { ...row, ...patch };
    this.fraxnetConnections.set(wallet, next);
    return next;
  }

  async getOrg(id: number) {
    return this.orgs.get(id) ?? null;
  }
  async upsertOrg(org: Org) {
    this.orgs.set(org.id, { ...org });
  }
  async setOrgActive(id: number, active: boolean) {
    const org = this.orgs.get(id);
    if (org) this.orgs.set(id, { ...org, active });
  }
  async upsertOfficer(o: Omit<Officer, "title">) {
    const key = `${o.orgId}:${o.wallet}`;
    this.officers.set(key, { title: this.officers.get(key)?.title ?? null, ...o });
  }
  async isActiveOfficer(orgId: number, wallet: Wallet) {
    return this.officers.get(`${orgId}:${wallet}`)?.active === true;
  }
  async listOfficerOrgs(wallet: Wallet) {
    return [...this.officers.values()]
      .filter((o) => o.wallet === wallet && o.active)
      .map((o) => ({ orgId: o.orgId, name: this.orgs.get(o.orgId)?.name ?? "", title: o.title }))
      .sort((a, b) => a.orgId - b.orgId);
  }

  async listActiveOrgsWithOfficers() {
    return [...this.orgs.values()]
      .filter((o) => o.active)
      .sort((a, b) => a.id - b.id)
      .map((org) => ({
        ...org,
        officers: [...this.officers.values()]
          .filter((o) => o.orgId === org.id && o.active)
          .map((o) => ({ wallet: o.wallet, title: o.title, displayName: this.profiles.get(o.wallet)?.displayName ?? null })),
      }));
  }

  async insertClaim(c: NewClaim) {
    if (!this.orgs.has(c.orgId)) throw new Error("claims_org_id_fkey");
    if (!this.profiles.has(c.recipientWallet)) throw new Error("claims_recipient_wallet_fkey");
    for (const other of this.claims.values()) {
      if (other.orgId === c.orgId && other.callinkPrNumber === c.callinkPrNumber) {
        throw new UniqueViolation("claims_org_id_callink_pr_number_key");
      }
    }
    const at = this.stamp();
    const row: Claim = {
      ...c,
      id: this.uuid(),
      onchainClaimId: null,
      packetJson: null,
      packetHash: null,
      guarantySignature: null,
      guarantyNonce: null,
      guarantyDeadline: null,
      statusCache: "Draft",
      asucOutcome: "none",
      asucOutcomeNote: null,
      asucOutcomeAt: null,
      createdAt: at,
      updatedAt: at,
    };
    this.claims.set(row.id, row);
    return row;
  }
  async getClaim(id: string) {
    return this.claims.get(id) ?? null;
  }
  async getClaimByPacketHash(packetHash: string) {
    return [...this.claims.values()].find((c) => c.packetHash === packetHash) ?? null;
  }
  async getClaimByOnchainId(onchainClaimId: number) {
    return [...this.claims.values()].find((c) => c.onchainClaimId === onchainClaimId) ?? null;
  }
  async updateClaim(id: string, patch: ClaimPatch) {
    const row = this.claims.get(id);
    if (!row) throw new Error(`no claim ${id}`);
    if (patch.packetHash && [...this.claims.values()].some((c) => c.id !== id && c.packetHash === patch.packetHash)) {
      throw new UniqueViolation("claims_packet_hash_key");
    }
    const next = { ...row, ...patch, updatedAt: this.stamp() };
    this.claims.set(id, next);
    return next;
  }
  async listClaims(scope: ClaimScope) {
    const all = [...this.claims.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (scope.kind === "all") return all;
    if (scope.kind === "reported") return all.filter((c) => c.asucOutcome !== "none");
    return all.filter(
      (c) => c.recipientWallet === scope.wallet || c.guarantorWallet === scope.wallet || scope.officerOrgIds.includes(c.orgId),
    );
  }
  async listClaimsByStatus(statuses: ClaimStatus[]) {
    return [...this.claims.values()].filter((c) => statuses.includes(c.statusCache));
  }

  async insertDocument(d: Omit<ClaimDocument, "id" | "createdAt" | "sha256"> & { id?: string }) {
    if ([...this.documents.values()].some((x) => x.storagePath === d.storagePath)) {
      throw new UniqueViolation("claim_documents_storage_path_key");
    }
    const row: ClaimDocument = { ...d, id: d.id ?? this.uuid(), sha256: null, createdAt: this.stamp() };
    this.documents.set(row.id, row);
    return row;
  }
  async getDocument(id: string) {
    return this.documents.get(id) ?? null;
  }
  async listDocuments(claimId: string) {
    return [...this.documents.values()].filter((d) => d.claimId === claimId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async setDocumentHash(id: string, sha256: string) {
    const row = this.documents.get(id);
    if (!row) throw new Error(`no document ${id}`);
    const next = { ...row, sha256 };
    this.documents.set(id, next);
    return next;
  }

  async insertInvite(i: Omit<GuarantorInvite, "id" | "createdAt" | "usedAt">) {
    const row: GuarantorInvite = { ...i, id: this.uuid(), usedAt: null, createdAt: this.stamp() };
    this.invites.set(row.id, row);
    return row;
  }
  async getInviteByTokenHash(tokenHash: string) {
    return [...this.invites.values()].find((i) => i.tokenHash === tokenHash) ?? null;
  }
  async markInviteUsed(id: string) {
    const row = this.invites.get(id);
    if (row && !row.usedAt) this.invites.set(id, { ...row, usedAt: this.stamp() });
  }

  async countInvitesSince(claimId: string, since: string) {
    return [...this.invites.values()].filter((i) => i.claimId === claimId && Date.parse(i.createdAt) >= Date.parse(since)).length;
  }

  async reserveGasDrip(wallet: Wallet, windowSeconds: number) {
    const cutoff = this.now().getTime() - windowSeconds * 1000;
    for (const d of this.drips.values()) if (d.wallet === wallet && d.at > cutoff) return null;
    const id = String(++this.seq);
    this.drips.set(id, { id, wallet, at: this.now().getTime(), txHash: null, amountWei: 0n });
    return id;
  }
  async confirmGasDrip(id: string, sent: { txHash: `0x${string}` | null; amountWei: bigint }) {
    const row = this.drips.get(id);
    if (row) this.drips.set(id, { ...row, txHash: sent.txHash, amountWei: sent.amountWei });
  }
  async releaseGasDrip(id: string) {
    // same as the SQL: a sent top-up is never released
    if (this.drips.get(id)?.txHash === null) this.drips.delete(id);
  }

  async insertAdminAction(a: { actorWallet: Wallet; action: string; target: string; payload: Record<string, unknown> }) {
    this.adminActions.push(a);
  }

  private key(n: NotificationKey) {
    return `${n.wallet}:${n.kind}:${n.claimId}`;
  }
  async recordNotification(n: NotificationKey) {
    if (this.notifications.has(this.key(n))) return false;
    this.notifications.set(this.key(n), { ...n, id: String(++this.seq), data: {}, sentAt: this.stamp(), attempts: 1, lastError: null });
    return true;
  }
  async enqueueNotification(n: NotificationKey, data: NotificationData) {
    if (this.notifications.has(this.key(n))) return false;
    this.notifications.set(this.key(n), { ...n, id: String(++this.seq), data, sentAt: null, attempts: 0, lastError: null });
    return true;
  }
  async listPendingNotifications(limit: number): Promise<PendingNotification[]> {
    return [...this.notifications.values()]
      .filter((n) => n.sentAt === null)
      .slice(0, limit)
      .map(({ wallet, kind, claimId, id, data, attempts }) => ({ wallet, kind, claimId, id, data, attempts }));
  }
  private byId(id: string) {
    return [...this.notifications.entries()].find(([, n]) => n.id === id);
  }
  async markNotificationSent(id: string) {
    const hit = this.byId(id);
    if (hit) this.notifications.set(hit[0], { ...hit[1], sentAt: this.stamp(), attempts: hit[1].attempts + 1 });
  }
  async markNotificationFailed(id: string, error: string) {
    const hit = this.byId(id);
    if (hit) this.notifications.set(hit[0], { ...hit[1], attempts: hit[1].attempts + 1, lastError: error });
  }

  async claimOnce(key: string) {
    if (this.onceKeys.has(key)) return false;
    this.onceKeys.add(key);
    return true;
  }
  async releaseOnce(key: string) {
    this.onceKeys.delete(key);
  }

  async getSyncBlock(key: string) {
    return this.sync.get(key) ?? null;
  }
  async setSyncBlock(key: string, block: number) {
    this.sync.set(key, block);
  }
}
