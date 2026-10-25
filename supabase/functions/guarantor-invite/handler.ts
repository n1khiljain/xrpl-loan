import { z } from "zod";
import { type TokenVerifier, requireCaller } from "../_shared/auth.ts";
import { loadReceivable, requireSeller, uuid } from "../_shared/receivables.ts";
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

/** At most this many invites (and emails) per receivable in any 24 hours. */
export const MAX_INVITES_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const PostBody = z.strictObject({ receivableId: uuid });
const encoder = new TextEncoder();

export const hashToken = (token: string) => sha256Hex(encoder.encode(token));

/** 32 random bytes as unpadded base64url: 43 characters. */
export function newInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * POST: the seller creates a 7-day invite link for their guarantor and we email it. Only the token's
 * hash is stored, and a receivable gets at most `MAX_INVITES_PER_DAY` a day. GET `?invite=`: the guarantor opens it and
 * gets the receivable summary to sign off on; an invite that was already used to sign answers 410.
 */
export function createInviteHandler(deps: InviteDeps): Handler {
  const now = deps.now ?? (() => new Date());
  const { db } = deps;

  async function create(req: Request, caller: Awaited<ReturnType<typeof requireCaller>>) {
    const { receivableId } = await readJson(req, PostBody);
    const receivable = await loadReceivable(db, receivableId);
    requireSeller(caller, receivable);
    if (!receivable.packetHash || !receivable.guarantorWallet) throw conflict("freeze the packet first", "not_frozen");
    if (receivable.status !== "Draft") throw conflict("this receivable was already submitted", "not_draft");
    if (receivable.orgId === null || !(await db.isActiveOfficer(receivable.orgId, receivable.guarantorWallet))) {
      throw conflict("the guarantor is no longer an active officer of the org", "not_officer");
    }

    const since = new Date(now().getTime() - DAY_MS).toISOString();
    if ((await db.countInvitesSince(receivableId, since)) >= MAX_INVITES_PER_DAY) {
      throw new HttpError(429, "rate_limited", "you've sent this sign-off request enough times today; try again tomorrow");
    }

    const token = newInviteToken();
    const expiresAt = new Date(now().getTime() + INVITE_TTL_MS).toISOString();
    await db.insertInvite({ receivableId, guarantorWallet: receivable.guarantorWallet, tokenHash: await hashToken(token), expiresAt });
    const inviteUrl = `${deps.appBaseUrl.replace(/\/+$/, "")}/guarantee?invite=${token}`;

    const guarantor = await db.getProfile(receivable.guarantorWallet);
    let emailed = false;
    if (guarantor?.email) {
      const org = receivable.orgId === null ? null : await db.getOrg(receivable.orgId);
      await deps.mailer.send(
        renderEmail(guarantor.email, {
          kind: "guaranty_requested",
          sellerName: caller.profile.displayName ?? "A member of your org",
          orgName: org?.name ?? "your org",
          amount: usd(receivable.requestedAmount),
          link: inviteUrl,
          expires: new Date(expiresAt).toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" }),
        }),
      );
      await db.recordNotification({ wallet: receivable.guarantorWallet, kind: "guaranty_requested", receivableId });
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

    const receivable = await loadReceivable(db, invite.receivableId);
    const [org, seller, documents] = await Promise.all([
      receivable.orgId === null ? Promise.resolve(null) : db.getOrg(receivable.orgId),
      db.getProfile(receivable.recipientWallet),
      db.listDocuments(receivable.id),
    ]);
    const signed = receivable.guarantySignedAt !== null;
    return json({
      receivable: {
        id: receivable.id,
        orgId: receivable.orgId,
        orgName: org?.name ?? null,
        sellerName: seller?.displayName ?? null,
        recipientWallet: receivable.recipientWallet,
        faceValue: receivable.faceValue,
        requestedAmount: receivable.requestedAmount,
        type: receivable.type,
        payerName: receivable.payerName,
        dueDate: receivable.dueDate,
        reference: receivable.reference,
        description: receivable.description,
        documentCount: documents.length,
        packetHash: receivable.packetHash,
        status: receivable.status,
      },
      expiresAt: invite.expiresAt,
      signed,
      signable: !signed && receivable.status === "Draft" && receivable.packetHash !== null,
    });
  }

  return async (req) => {
    const caller = await requireCaller(req, deps);
    if (req.method === "POST") return create(req, caller);
    if (req.method === "GET") return resolve(req, caller);
    throw methodNotAllowed(["GET", "POST"]);
  };
}
