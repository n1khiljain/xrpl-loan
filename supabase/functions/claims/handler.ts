import type { NetworkConfig } from "@app/config";
import { z } from "zod";
import { type Caller, type TokenVerifier, requireCaller, requireStaff } from "../_shared/auth.ts";
import {
  canViewClaim,
  claimView,
  documentView,
  isEditable,
  loadClaim,
  requireClaimant,
  requireKycApproved,
  unitsString,
  uuid,
  xrplAddress,
} from "../_shared/claims.ts";
import { type Claim, type ClaimPatch, type Db, UniqueViolation, type Wallet } from "../_shared/db/types.ts";
import { type Handler, badRequest, conflict, json, methodNotAllowed, notFound, readJson } from "../_shared/http.ts";

export type ClaimsDeps = { auth: TokenVerifier; db: Db; config: NetworkConfig };

const Fields = {
  recipientType: z.enum(["member", "org_treasurer"]),
  faceValue: unitsString,
  requestedAmount: unitsString,
  callinkPrNumber: z.string().trim().min(1).max(64),
  description: z.string().trim().max(2000).nullable(),
  guarantorWallet: xrplAddress.nullable(),
};

const CreateBody = z.strictObject({
  orgId: z.int().positive(),
  recipientType: Fields.recipientType.default("member"),
  faceValue: Fields.faceValue,
  requestedAmount: Fields.requestedAmount,
  callinkPrNumber: Fields.callinkPrNumber,
  description: Fields.description.optional(),
  guarantorWallet: Fields.guarantorWallet.optional(),
});

const PatchBody = z.strictObject({
  id: uuid,
  recipientType: Fields.recipientType.optional(),
  faceValue: Fields.faceValue.optional(),
  requestedAmount: Fields.requestedAmount.optional(),
  callinkPrNumber: Fields.callinkPrNumber.optional(),
  description: Fields.description.optional(),
  guarantorWallet: Fields.guarantorWallet.optional(),
});

/**
 * Drafts and lists claims. GET `?id=` returns one claim with its documents; GET alone lists what the caller sells,
 * guarantees, or oversees as an officer; staff can pass `?scope=all` or `?scope=reported`. POST creates a
 * draft and PATCH edits one until its packet is frozen.
 */
export function createClaimsHandler(deps: ClaimsDeps): Handler {
  const { db, config } = deps;
  const perClaimCap = BigInt(config.params.perClaimCap);

  async function checkTerms(caller: Caller, c: Pick<Claim, "orgId" | "faceValue" | "requestedAmount" | "guarantorWallet">) {
    if (BigInt(c.requestedAmount) > BigInt(c.faceValue)) throw badRequest("requestedAmount can't exceed faceValue", "over_face_value");
    if (BigInt(c.requestedAmount) > perClaimCap) throw badRequest("requestedAmount is over the per-claim cap", "over_cap");
    if (c.guarantorWallet) {
      if (c.guarantorWallet === caller.profile.wallet) {
        throw badRequest("the guarantor must be someone other than the claimant", "self_guaranty");
      }
      if (!(await db.isActiveOfficer(c.orgId, c.guarantorWallet))) {
        throw badRequest("the guarantor must be an active officer of the org", "not_officer");
      }
    }
  }

  async function withDocuments(claim: Claim) {
    return { claim: claimView(claim), documents: (await db.listDocuments(claim.id)).map(documentView) };
  }

  async function get(req: Request, caller: Caller) {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (id) {
      if (!uuid.safeParse(id).success) throw badRequest("id must be a UUID");
      const claim = await db.getClaim(id);
      if (!claim || !(await canViewClaim(db, caller, claim))) throw notFound("no such claim");
      return json(await withDocuments(claim));
    }
    const scope = url.searchParams.get("scope");
    if (scope === "all" || scope === "reported") {
      requireStaff(caller, ["underwriter", "attester", "admin"]);
      return json({ claims: (await db.listClaims({ kind: scope })).map(claimView) });
    }
    if (scope !== null && scope !== "mine") throw badRequest("scope must be mine, all, or reported");
    const officerOrgIds = (await db.listOfficerOrgs(caller.profile.wallet)).map((o) => o.orgId);
    const claims = await db.listClaims({ kind: "wallet", wallet: caller.profile.wallet, officerOrgIds });
    return json({ claims: claims.map(claimView) });
  }

  async function create(req: Request, caller: Caller) {
    const body = await readJson(req, CreateBody);
    requireKycApproved(caller, "member");
    const org = await db.getOrg(body.orgId);
    if (!org) throw notFound("no such org");
    if (!org.active) throw conflict("that org isn't active", "org_inactive");
    const draft = {
      orgId: body.orgId,
      recipientWallet: caller.profile.wallet,
      recipientType: body.recipientType,
      faceValue: body.faceValue,
      requestedAmount: body.requestedAmount,
      callinkPrNumber: body.callinkPrNumber,
      description: body.description ?? null,
      guarantorWallet: (body.guarantorWallet ?? null) as Wallet | null,
    };
    await checkTerms(caller, draft);
    try {
      return json(await withDocuments(await db.insertClaim(draft)), { status: 201 });
    } catch (error) {
      if (error instanceof UniqueViolation) {
        throw conflict("this payment reference already has a loan", "duplicate_callink");
      }
      throw error;
    }
  }

  async function patch(req: Request, caller: Caller) {
    const { id, ...changes } = await readJson(req, PatchBody);
    const claim = await loadClaim(db, id);
    requireClaimant(caller, claim);
    if (!isEditable(claim)) throw conflict("the packet is frozen, so the draft can't change", "frozen");
    const next = { ...claim, ...changes } as Claim;
    await checkTerms(caller, next);
    const update: ClaimPatch = {};
    for (const [key, value] of Object.entries(changes)) {
      if (value !== undefined) (update as Record<string, unknown>)[key] = value;
    }
    try {
      return json(await withDocuments(await db.updateClaim(id, update)));
    } catch (error) {
      if (error instanceof UniqueViolation) {
        throw conflict("this payment reference already has a loan", "duplicate_callink");
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

