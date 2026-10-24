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
  type Org,
  type Profile,
  type ProfilePatch,
  type StaffRole,
  UniqueViolation,
  type Wallet,
  type WalletRow,
} from "./types.ts";

/** In-memory `Db` with the same constraints the migrations enforce. Tests use it; it never ships. */
export class MemoryDb implements Db {
  readonly wallets = new Map<Wallet, WalletRow>();
  readonly profiles = new Map<Wallet, Profile>();
  readonly staff = new Map<Wallet, StaffRole>();
  readonly orgs = new Map<number, Org>();
  readonly officers = new Map<string, Officer>();
  readonly claims = new Map<string, Claim>();
  readonly documents = new Map<string, ClaimDocument>();
  readonly invites = new Map<string, GuarantorInvite>();
  readonly ledgerTxs: LedgerTx[] = [];
  readonly adminActions: Array<{ actorWallet: Wallet; action: string; target: string; payload: Record<string, unknown> }> = [];
  readonly notifications = new Set<string>();
  readonly sync = new Map<string, number>();
  readonly onceKeys = new Set<string>();
  private orgSeq = 0;
  private claimSeq = 0;

  constructor(private readonly now: () => Date = () => new Date()) {}

  private stamp() {
    return this.now().toISOString();
  }

  async insertWallet(w: Pick<WalletRow, "address" | "encryptedSeed">) {
    if (this.wallets.has(w.address)) throw new UniqueViolation("wallets_pkey");
    const row: WalletRow = { ...w, fundedTx: null, createdAt: this.stamp() };
    this.wallets.set(w.address, row);
    return row;
  }
  async getWallet(address: Wallet) {
    return this.wallets.get(address) ?? null;
  }
  async setWalletFunded(address: Wallet, txHash: string) {
    const row = this.wallets.get(address);
    if (row) this.wallets.set(address, { ...row, fundedTx: txHash });
  }

  async getProfile(wallet: Wallet) {
    return this.profiles.get(wallet) ?? null;
  }
  async getProfileByPrivyId(privyUserId: string) {
    return [...this.profiles.values()].find((p) => p.privyUserId === privyUserId) ?? null;
  }
  async insertProfile(p: Pick<Profile, "wallet" | "privyUserId" | "email" | "emailVerified" | "displayName">) {
    if (!this.wallets.has(p.wallet)) throw new Error("profiles_wallet_address_fkey");
    if (this.profiles.has(p.wallet)) throw new UniqueViolation("profiles_pkey");
    if (await this.getProfileByPrivyId(p.privyUserId)) throw new UniqueViolation("profiles_privy_user_id_key");
    const row: Profile = {
      ...p,
      kycStatus: "not_started",
      kycSource: null,
      kycUpdatedBy: null,
      kycUpdatedAt: null,
      createdAt: this.stamp(),
    };
    this.profiles.set(p.wallet, row);
    return row;
  }
  async updateProfile(wallet: Wallet, patch: ProfilePatch) {
    const row = this.profiles.get(wallet);
    if (!row) throw new Error(`no profile ${wallet}`);
    const next = { ...row, ...patch };
    this.profiles.set(wallet, next);
    return next;
  }
  async listProfilesByKyc(statuses: KycStatus[]) {
    return [...this.profiles.values()].filter((p) => statuses.includes(p.kycStatus)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getStaffRole(wallet: Wallet) {
    return this.staff.get(wallet) ?? null;
  }

  async insertOrg(name: string) {
    if ([...this.orgs.values()].some((o) => o.name === name)) throw new UniqueViolation("orgs_name_key");
    const org = { id: ++this.orgSeq, name, active: true };
    this.orgs.set(org.id, org);
    return org;
  }
  async getOrg(id: number) {
    return this.orgs.get(id) ?? null;
  }
  async listOrgs() {
    return [...this.orgs.values()].sort((a, b) => a.id - b.id);
  }
  async setOrgActive(id: number, active: boolean) {
    const org = this.orgs.get(id);
    if (org) this.orgs.set(id, { ...org, active });
  }
  async upsertOfficer(o: Officer) {
    if (!this.orgs.has(o.orgId)) throw new Error("org_officers_org_id_fkey");
    this.officers.set(`${o.orgId}:${o.wallet}`, { ...o });
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
      id: crypto.randomUUID(),
      number: ++this.claimSeq,
      packetJson: null,
      packetHash: null,
      guarantySignedAt: null,
      status: "Draft",
      submittedAt: null,
      approvedAmount: "0",
      approvedBy: null,
      approvalExpiresAt: null,
      rejectReason: null,
      feeBps: 0,
      purchasePrice: "0",
      amountDue: "0",
      amountPaid: "0",
      purchasedAt: null,
      dueAt: null,
      loanId: null,
      callReason: "none",
      guarantorCalledAt: null,
      writeOffEligibleAt: null,
      principalWrittenOff: false,
      writtenOffPrincipal: "0",
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
  async updateClaim(id: string, patch: ClaimPatch) {
    const row = this.claims.get(id);
    if (!row) throw new Error(`no claim ${id}`);
    if (patch.packetHash && [...this.claims.values()].some((c) => c.id !== id && c.packetHash === patch.packetHash)) {
      throw new UniqueViolation("claims_packet_hash_key");
    }
    const next = { ...row, ...patch, updatedAt: this.stamp() };
    if (BigInt(next.approvedAmount) > BigInt(next.requestedAmount)) throw new Error("approved_within_requested");
    if (BigInt(next.amountPaid) > BigInt(next.amountDue)) throw new Error("paid_within_due");
    this.claims.set(id, next);
    return next;
  }
  async transitionClaim(id: string, from: ClaimStatus[], patch: ClaimPatch) {
    const row = this.claims.get(id);
    if (!row || !from.includes(row.status)) return null;
    return this.updateClaim(id, patch);
  }
  async listClaims(scope: ClaimScope) {
    const all = [...this.claims.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.number - a.number);
    if (scope.kind === "all") return all;
    if (scope.kind === "reported") return all.filter((c) => c.asucOutcome !== "none");
    return all.filter(
      (c) => c.recipientWallet === scope.wallet || c.guarantorWallet === scope.wallet || scope.officerOrgIds.includes(c.orgId),
    );
  }
  async listClaimsByStatus(statuses: ClaimStatus[]) {
    return [...this.claims.values()].filter((c) => statuses.includes(c.status));
  }

  async insertDocument(d: Omit<ClaimDocument, "id" | "createdAt" | "sha256"> & { id?: string }) {
    if ([...this.documents.values()].some((x) => x.storagePath === d.storagePath)) {
      throw new UniqueViolation("claim_documents_storage_path_key");
    }
    const row: ClaimDocument = { ...d, id: d.id ?? crypto.randomUUID(), sha256: null, createdAt: this.stamp() };
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
    const row: GuarantorInvite = { ...i, id: crypto.randomUUID(), usedAt: null, createdAt: this.stamp() };
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

  async recordLedgerTx(tx: Omit<LedgerTx, "createdAt">) {
    if (this.ledgerTxs.some((t) => t.txHash === tx.txHash)) return;
    this.ledgerTxs.push({ ...tx, createdAt: this.stamp() });
  }
  async listLedgerTxs(filter: { claimId?: string; account?: Wallet; limit?: number }) {
    return this.ledgerTxs
      .filter((t) => (filter.claimId === undefined || t.claimId === filter.claimId) && (filter.account === undefined || t.account === filter.account))
      .slice(-(filter.limit ?? 50));
  }

  async insertAdminAction(a: { actorWallet: Wallet; action: string; target: string; payload: Record<string, unknown> }) {
    this.adminActions.push(a);
  }

  async recordNotification(n: NotificationKey) {
    const key = `${n.wallet}:${n.kind}:${n.claimId}`;
    if (this.notifications.has(key)) return false;
    this.notifications.add(key);
    return true;
  }

  async claimOnce(key: string) {
    if (this.onceKeys.has(key)) return false;
    this.onceKeys.add(key);
    return true;
  }
  async releaseOnce(key: string) {
    this.onceKeys.delete(key);
  }

  async getSyncLedger(key: string) {
    return this.sync.get(key) ?? null;
  }
  async setSyncLedger(key: string, ledger: number) {
    this.sync.set(key, ledger);
  }
}
