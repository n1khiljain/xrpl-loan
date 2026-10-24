import type { ChainEvent, ChainReader, ClaimEvent } from "@app/adapters";
import { type NetworkConfig, requireDeployed } from "@app/config";
import { type TokenVerifier, bearerToken, requireCaller, requireStaff } from "../_shared/auth.ts";
import type { Claim, ClaimStatus, Db, NotificationKind, Wallet } from "../_shared/db/types.ts";
import { type EmailData, emailDataFrom, renderEmail } from "../_shared/emails.ts";
import { type Handler, methodNotAllowed, json } from "../_shared/http.ts";
import type { Mailer } from "../_shared/mail.ts";

export type ChainSyncDeps = {
  auth: TokenVerifier;
  db: Db;
  chain: ChainReader;
  mailer: Mailer;
  config: NetworkConfig;
  appBaseUrl: string;
  /** `CHAIN_SYNC_SECRET`, sent by pg_cron. Unset means only staff can trigger a sync. */
  cronSecret: string | undefined;
  /** Most blocks read per run; the next run picks up the rest. */
  maxBlocks?: number;
  now?: () => Date;
};

export const CURSOR = "chain-sync";
/** FR-B9: email when a claim is 14 days from its due date. */
export const DUE_SOON_SECONDS = 14 * 24 * 60 * 60;
/** Most queued emails sent per run. */
export const OUTBOX_BATCH = 50;

const STATUS: Partial<Record<ClaimEvent["name"], ClaimStatus>> = {
  ClaimSubmitted: "Submitted",
  ClaimCancelled: "Cancelled",
  ClaimApproved: "Approved",
  ClaimRejected: "Rejected",
  ClaimPurchased: "Funded",
  ClaimSettled: "Settled",
  GuarantorCalled: "GuarantorCalled",
  ClaimRecovered: "Recovered",
  ClaimWrittenOff: "WrittenOff",
};

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Mirrors the chain into Postgres (SYSTEM_DESIGN 5.2): orgs and officers from `OrgRegistry`, `status_cache` and
 * `onchain_claim_id` from `ClaimRegistry` (linked by `packetHash`), and the FR-B9 emails. pg_cron calls it every
 * minute with `CHAIN_SYNC_SECRET`; staff can also call it with their Privy token (U-49). Replaying a range is safe:
 * every write is an upsert and every email is queued once. Emails go through the `notifications` outbox, so a
 * failed send is retried on the next run even though the cursor has moved on.
 */
export function createChainSyncHandler(deps: ChainSyncDeps): Handler {
  const { db, chain, config } = deps;
  const now = deps.now ?? (() => new Date());
  const maxBlocks = BigInt(deps.maxBlocks ?? 10_000);
  const base = deps.appBaseUrl.replace(/\/+$/, "");
  const link = (claim: Claim) => `${base}/claim?id=${claim.id}`;

  // UNCERTAIN: U-49 (cron secret or a staff Privy token)
  async function authorize(req: Request) {
    const token = bearerToken(req);
    if (deps.cronSecret && token && constantTimeEqual(token, deps.cronSecret)) return;
    requireStaff(await requireCaller(req, deps), ["underwriter", "attester", "admin"]);
  }

  /** Queues one email; the outbox flush sends it, now or on a later run if the provider is down. */
  async function notify(wallet: Wallet | null, kind: NotificationKind, claim: Claim, data: EmailData) {
    if (!wallet) return;
    const { kind: _kind, ...fields } = data;
    await db.enqueueNotification({ wallet, kind, claimId: claim.id }, fields);
  }

  /** Sends queued emails. A failure stays queued for the next run; it never blocks the sync. */
  async function flush(): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    for (const pending of await db.listPendingNotifications(OUTBOX_BATCH)) {
      const profile = await db.getProfile(pending.wallet);
      const data = emailDataFrom(pending.kind, pending.data);
      if (!profile?.email || !data) {
        // nowhere to send it, or nothing to say; close it out instead of retrying forever
        await db.markNotificationSent(pending.id);
        continue;
      }
      try {
        await deps.mailer.send(renderEmail(profile.email, data));
        await db.markNotificationSent(pending.id);
        sent++;
      } catch (error) {
        await db.markNotificationFailed(pending.id, error instanceof Error ? error.message : String(error));
        failed++;
      }
    }
    return { sent, failed };
  }

  async function apply(event: ChainEvent) {
    if (event.contract === "OrgRegistry") {
      const orgId = Number(event.orgId);
      if (event.name === "OrgAdded") await db.upsertOrg({ id: orgId, name: String(event.args.name), active: true });
      if (event.name === "OrgActiveSet") await db.setOrgActive(orgId, event.args.active === true);
      if (event.name === "OfficerSet") {
        await db.upsertOfficer({
          orgId,
          wallet: String(event.args.officer).toLowerCase() as Wallet,
          active: event.args.active === true,
        });
      }
      return;
    }

    const onchainId = Number(event.claimId);
    let claim: Claim | null;
    if (event.name === "ClaimSubmitted") {
      claim = await db.getClaimByPacketHash(String(event.args.packetHash).toLowerCase());
      // a claim submitted outside this app has no draft to link
      if (!claim) return;
      if (claim.onchainClaimId !== onchainId) claim = await db.updateClaim(claim.id, { onchainClaimId: onchainId });
    } else {
      claim = await db.getClaimByOnchainId(onchainId);
      if (!claim) return;
    }

    const status = STATUS[event.name];
    if (status && claim.statusCache !== status) claim = await db.updateClaim(claim.id, { statusCache: status });

    if (event.name === "ClaimApproved") {
      await notify(claim.recipientWallet, "claim_approved", claim, {
        kind: "claim_approved",
        amount: String(event.args.amount),
        link: link(claim),
      });
    }
    if (event.name === "ClaimPurchased") {
      await notify(claim.recipientWallet, "claim_funded", claim, {
        kind: "claim_funded",
        price: String(event.args.purchasePrice),
        due: String(event.args.amountDue),
        dueAt: Number(event.args.dueAt),
        link: link(claim),
      });
    }
    if (event.name === "GuarantorCalled") {
      await notify(claim.guarantorWallet, "guarantor_called", claim, {
        kind: "guarantor_called",
        remaining: String(event.args.amountRemaining),
        link: link(claim),
      });
    }
  }

  /** Emails claimants whose purchased claim is due within 14 days. */
  async function dueSoon() {
    const funded = (await db.listClaimsByStatus(["Funded"])).filter((c) => c.onchainClaimId !== null);
    if (funded.length === 0) return;
    const views = await chain.getClaims(funded.map((c) => BigInt(c.onchainClaimId as number)));
    const nowSeconds = Math.floor(now().getTime() / 1000);
    for (const [i, view] of views.entries()) {
      const claim = funded[i];
      if (!claim || view.state !== "Funded") continue;
      const left = view.dueAt - nowSeconds;
      if (left > 0 && left <= DUE_SOON_SECONDS) {
        await notify(claim.recipientWallet, "due_soon", claim, {
          kind: "due_soon",
          remaining: view.amountRemaining.toString(),
          dueAt: view.dueAt,
          link: link(claim),
        });
      }
    }
  }

  return async (req) => {
    await authorize(req);
    if (req.method !== "POST") throw methodNotAllowed(["POST"]);
    const deployedBlock = BigInt(requireDeployed(config).block);
    const last = await db.getSyncBlock(CURSOR);
    const fromBlock = last === null ? deployedBlock : BigInt(last) + 1n;
    const { events, toBlock } = await chain.getEvents({ fromBlock, toBlock: fromBlock + maxBlocks - 1n });
    for (const event of events) await apply(event);
    await dueSoon();
    if (toBlock >= fromBlock) await db.setSyncBlock(CURSOR, Number(toBlock));
    const emails = await flush();
    return json({ fromBlock, toBlock, events: events.length, emails: emails.sent, emailsFailed: emails.failed });
  };
}
