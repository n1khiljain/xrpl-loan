import { z } from "zod";
import { type TokenVerifier, requireCaller } from "../_shared/auth.ts";
import { loadClaim, requireClaimant, uuid } from "../_shared/claims.ts";
import type { Db } from "../_shared/db/types.ts";
import { renderEmail, usd } from "../_shared/emails.ts";
import { type Handler, HttpError, badRequest, conflict, forbidden, json, methodNotAllowed, notFound, readJson } from "../_shared/http.ts";
import type { Mailer } from "../_shared/mail.ts";
import { sha256Hex } from "../_shared/storage.ts";

export type InviteDeps = {
  auth: TokenVerifier;
  db: Db;
  mailer: Mailer;
  appBaseUrl: string;
  now?: () => Date;
};

/** Invite links expire after 7 days. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** At most this many invites (and emails) per claim in any 24 hours. */
export const MAX_INVITES_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const PostBody = z.strictObject({ claimId: uuid });
const encoder = new TextEncoder();

export const hashToken = (token: string) => sha256Hex(encoder.encode(token));

/** 32 random bytes as unpadded base64url: 43 characters. */
export function newInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * POST: the claimant creates a 7-day invite link for their guarantor and we email it. Only the token's
 * hash is stored, and a claim gets at most `MAX_INVITES_PER_DAY` a day. GET `?invite=`: the guarantor opens it and
 * gets the claim summary to sign off on; an invite that was already used to sign answers 410.
 */
export function createInviteHandler(deps: InviteDeps): Handler {
  const now = deps.now ?? (() => new Date());
  const { db } = deps;

  async function create(req: Request, caller: Awaited<ReturnType<typeof requireCaller>>) {
    const { claimId } = await readJson(req, PostBody);
    const claim = await loadClaim(db, claimId);
    requireClaimant(caller, claim);
    if (!claim.packetHash || !claim.guarantorWallet) throw conflict("freeze the packet first", "not_frozen");
    if (claim.status !== "Draft") throw conflict("this claim was already submitted", "not_draft");
    if (!(await db.isActiveOfficer(claim.orgId, claim.guarantorWallet))) {
      throw conflict("the guarantor is no longer an active officer of the org", "not_officer");
    }

    const since = new Date(now().getTime() - DAY_MS).toISOString();
    if ((await db.countInvitesSince(claimId, since)) >= MAX_INVITES_PER_DAY) {
      throw new HttpError(429, "rate_limited", "you've sent this sign-off request enough times today; try again tomorrow");
    }

    const token = newInviteToken();
    const expiresAt = new Date(now().getTime() + INVITE_TTL_MS).toISOString();
    await db.insertInvite({ claimId, guarantorWallet: claim.guarantorWallet, tokenHash: await hashToken(token), expiresAt });
    const inviteUrl = `${deps.appBaseUrl.replace(/\/+$/, "")}/guarantee?invite=${token}`;

    const guarantor = await db.getProfile(claim.guarantorWallet);
    let emailed = false;
    if (guarantor?.email) {
      const org = await db.getOrg(claim.orgId);
      await deps.mailer.send(
        renderEmail(guarantor.email, {
          kind: "guaranty_requested",
          claimantName: caller.profile.displayName ?? "A member of your org",
          orgName: org?.name ?? "your org",
          amount: usd(claim.requestedAmount),
          link: inviteUrl,
          expires: new Date(expiresAt).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" }),
        }),
      );
      await db.recordNotification({ wallet: claim.guarantorWallet, kind: "guaranty_requested", claimId });
      emailed = true;
    }
    return json({ inviteUrl, expiresAt, emailed }, { status: 201 });
  }

  async function resolve(req: Request, caller: Awaited<ReturnType<typeof requireCaller>>) {
    const token = new URL(req.url).searchParams.get("invite");
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw badRequest("invite must be an invite token");
    const invite = await db.getInviteByTokenHash(await hashToken(token));
    if (!invite) throw notFound("no such invite");
    if (invite.guarantorWallet !== caller.profile.wallet) throw forbidden("this invite is for a different wallet", "wrong_guarantor");
    if (invite.usedAt !== null) throw new HttpError(410, "used", "this invite was already used to sign off");
    if (Date.parse(invite.expiresAt) <= now().getTime()) throw new HttpError(410, "expired", "this invite expired; ask for a new one");

    const claim = await loadClaim(db, invite.claimId);
    const [org, claimant, documents] = await Promise.all([
      db.getOrg(claim.orgId),
      db.getProfile(claim.recipientWallet),
      db.listDocuments(claim.id),
    ]);
    const signed = claim.guarantySignedAt !== null;
    return json({
      claim: {
        id: claim.id,
        orgId: claim.orgId,
        orgName: org?.name ?? null,
        claimantName: claimant?.displayName ?? null,
        recipientWallet: claim.recipientWallet,
        faceValue: claim.faceValue,
        requestedAmount: claim.requestedAmount,
        callinkPrNumber: claim.callinkPrNumber,
        description: claim.description,
        documentCount: documents.length,
        packetHash: claim.packetHash,
        status: claim.status,
      },
      expiresAt: invite.expiresAt,
      signed,
      signable: !signed && claim.status === "Draft" && claim.packetHash !== null,
    });
  }

  return async (req) => {
    const caller = await requireCaller(req, deps);
    if (req.method === "POST") return create(req, caller);
    if (req.method === "GET") return resolve(req, caller);
    throw methodNotAllowed(["GET", "POST"]);
  };
}
