import type { NetworkConfig } from "@app/config";
import { z } from "zod";
import { type Caller, type TokenVerifier, requireCaller, requireStaff } from "../_shared/auth.ts";
import {
  canViewReceivable,
  receivableView,
  documentView,
  isEditable,
  loadReceivable,
  requireSeller,
  requireKycApproved,
  unitsString,
  uuid,
  xrplAddress,
} from "../_shared/receivables.ts";
import { type Receivable, type ReceivablePatch, type Db, UniqueViolation, type Wallet } from "../_shared/db/types.ts";
import { type Handler, badRequest, conflict, json, methodNotAllowed, notFound, readJson } from "../_shared/http.ts";

export type ReceivablesDeps = { auth: TokenVerifier; db: Db; config: NetworkConfig; now?: () => Date };

const Fields = {
  type: z.enum(["card_settlement", "reimbursement", "invoice", "other"]),
  payerName: z.string().trim().min(1).max(120),
  payerEmail: z.email().max(254).nullable(),
  payerWallet: xrplAddress.nullable(),
  dueDate: z.iso.date(),
  orgId: z.int().positive().nullable(),
  faceValue: unitsString,
  requestedAmount: unitsString,
  reference: z.string().trim().min(1).max(64),
  description: z.string().trim().max(2000).nullable(),
  guarantorWallet: xrplAddress.nullable(),
};

const CreateBody = z.strictObject({
  type: Fields.type,
  payerName: Fields.payerName,
  payerEmail: Fields.payerEmail.optional(),
  payerWallet: Fields.payerWallet.optional(),
  dueDate: Fields.dueDate,
  orgId: Fields.orgId.optional(),
  faceValue: Fields.faceValue,
  requestedAmount: Fields.requestedAmount,
  reference: Fields.reference,
  description: Fields.description.optional(),
  guarantorWallet: Fields.guarantorWallet.optional(),
});

const PatchBody = z.strictObject({
  id: uuid,
  type: Fields.type.optional(),
  payerName: Fields.payerName.optional(),
  payerEmail: Fields.payerEmail.optional(),
  payerWallet: Fields.payerWallet.optional(),
  dueDate: Fields.dueDate.optional(),
  faceValue: Fields.faceValue.optional(),
  requestedAmount: Fields.requestedAmount.optional(),
  reference: Fields.reference.optional(),
  description: Fields.description.optional(),
  guarantorWallet: Fields.guarantorWallet.optional(),
});

/**
 * Drafts and lists receivables. GET `?id=` returns one receivable with its documents; GET alone lists what the caller
 * sells, guarantees, or oversees as an officer; staff can pass `?scope=all` or `?scope=reported`. POST creates a draft
 * and PATCH edits one until its packet is frozen. A receivable can belong to an org (a club reimbursement), and only
 * then can it name a guarantor, who must be one of the org's active officers.
 */
export function createReceivablesHandler(deps: ReceivablesDeps): Handler {
  const { db, config } = deps;
  const now = deps.now ?? (() => new Date());
  const perReceivableCap = BigInt(config.params.perReceivableCap);

  async function checkTerms(
    caller: Caller,
    c: Pick<Receivable, "orgId" | "faceValue" | "requestedAmount" | "guarantorWallet" | "dueDate" | "payerWallet">,
  ) {
    if (BigInt(c.requestedAmount) > BigInt(c.faceValue)) throw badRequest("requestedAmount can't exceed faceValue", "over_face_value");
    if (BigInt(c.requestedAmount) > perReceivableCap) throw badRequest("requestedAmount is over the per-receivable cap", "over_cap");
    // the due date is the loan's term, so it has to be ahead and no further out than the longest term allowed
    const due = Date.parse(`${c.dueDate}T00:00:00Z`);
    const today = Date.parse(`${now().toISOString().slice(0, 10)}T00:00:00Z`);
    if (due <= today) throw badRequest("the due date has to be after today", "due_in_past");
    if (due - today > config.params.overdueWindowSeconds * 1000) {
      throw badRequest(`the due date can be at most ${Math.round(config.params.overdueWindowSeconds / 86_400)} days out`, "due_too_far");
    }
    if (c.payerWallet && c.payerWallet === caller.profile.wallet) throw badRequest("you can't be your own payer", "self_payer");
    if (c.guarantorWallet) {
      if (c.orgId === null) throw badRequest("only an org's receivable can have a guarantor", "guarantor_without_org");
      if (c.guarantorWallet === caller.profile.wallet) {
        throw badRequest("the guarantor must be someone other than the seller", "self_guaranty");
      }
      if (!(await db.isActiveOfficer(c.orgId, c.guarantorWallet))) {
        throw badRequest("the guarantor must be an active officer of the org", "not_officer");
      }
    }
  }

  async function withDocuments(receivable: Receivable) {
    return { receivable: receivableView(receivable), documents: (await db.listDocuments(receivable.id)).map(documentView) };
  }

  async function get(req: Request, caller: Caller) {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (id) {
      if (!uuid.safeParse(id).success) throw badRequest("id must be a UUID");
      const receivable = await db.getReceivable(id);
      if (!receivable || !(await canViewReceivable(db, caller, receivable))) throw notFound("no such receivable");
      return json(await withDocuments(receivable));
    }
    const scope = url.searchParams.get("scope");
    if (scope === "all" || scope === "reported") {
      requireStaff(caller, ["underwriter", "attester", "admin"]);
      return json({ receivables: (await db.listReceivables({ kind: scope })).map(receivableView) });
    }
    if (scope !== null && scope !== "mine") throw badRequest("scope must be mine, all, or reported");
    const [officerOrgs, member] = await Promise.all([db.listOfficerOrgs(caller.profile.wallet), db.getMember(caller.profile.wallet)]);
    const receivables = await db.listReceivables({
      kind: "wallet",
      wallet: caller.profile.wallet,
      officerOrgIds: officerOrgs.map((o) => o.orgId),
      financeOrgId: member?.financeAgent ? member.orgId : null,
    });
    return json({ receivables: receivables.map(receivableView) });
  }

  async function create(req: Request, caller: Caller) {
    const body = await readJson(req, CreateBody);
    requireKycApproved(caller, "member");
    const orgId = body.orgId ?? null;
    if (orgId !== null) {
      const org = await db.getOrg(orgId);
      if (!org) throw notFound("no such org");
      if (!org.active) throw conflict("that org isn't active", "org_inactive");
    }
    const draft = {
      type: body.type,
      recipientWallet: caller.profile.wallet,
      payerName: body.payerName,
      payerEmail: body.payerEmail ?? null,
      payerWallet: (body.payerWallet ?? null) as Wallet | null,
      dueDate: body.dueDate,
      orgId,
      faceValue: body.faceValue,
      requestedAmount: body.requestedAmount,
      reference: body.reference,
      description: body.description ?? null,
      guarantorWallet: (body.guarantorWallet ?? null) as Wallet | null,
    };
    await checkTerms(caller, draft);
    try {
      return json(await withDocuments(await db.insertReceivable(draft)), { status: 201 });
    } catch (error) {
      if (error instanceof UniqueViolation) throw conflict("you already have a loan for this payment reference", "duplicate_reference");
      throw error;
    }
  }

  async function patch(req: Request, caller: Caller) {
    const { id, ...changes } = await readJson(req, PatchBody);
    const receivable = await loadReceivable(db, id);
    requireSeller(caller, receivable);
    if (!isEditable(receivable)) throw conflict("the packet is frozen, so the draft can't change", "frozen");
    const next = { ...receivable, ...changes } as Receivable;
    await checkTerms(caller, next);
    const update: ReceivablePatch = {};
    for (const [key, value] of Object.entries(changes)) {
      if (value !== undefined) (update as Record<string, unknown>)[key] = value;
    }
    try {
      return json(await withDocuments(await db.updateReceivable(id, update)));
    } catch (error) {
      if (error instanceof UniqueViolation) {
        throw conflict("you already have a loan for this payment reference", "duplicate_reference");
      }
      throw error;
    }
  }

  return async (req) => {
    const caller = await requireCaller(req, deps);
    switch (req.method) {
      case "GET":
        return get(req, caller);
      case "POST":
        return create(req, caller);
      case "PATCH":
        return patch(req, caller);
      default:
        throw methodNotAllowed(["GET", "POST", "PATCH"]);
    }
  };
}

