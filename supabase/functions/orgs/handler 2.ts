import { z } from "zod";
import { type TokenVerifier, requireCaller, requireStaff } from "../_shared/auth.ts";
import { xrplAddress } from "../_shared/claims.ts";
import { type Db, UniqueViolation } from "../_shared/db/types.ts";
import { type Handler, conflict, json, methodNotAllowed, notFound, readJson } from "../_shared/http.ts";

export type OrgsDeps = { auth: TokenVerifier; db: Db };

const Body = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("create"), name: z.string().trim().min(1).max(120) }),
  z.strictObject({ action: z.literal("set-active"), orgId: z.int().positive(), active: z.boolean() }),
  z.strictObject({
    action: z.literal("set-officer"),
    orgId: z.int().positive(),
    wallet: xrplAddress,
    title: z.string().trim().max(80).nullable().optional(),
    active: z.boolean(),
  }),
]);

/** Admins manage orgs and their officers. GET lists every org with its officers; POST changes one. Each change is logged. */
export function createOrgsHandler(deps: OrgsDeps): Handler {
  const { db } = deps;
  return async (req) => {
    const caller = await requireCaller(req, deps);
    requireStaff(caller, ["admin"]);
    if (req.method === "GET") {
      const [orgs, active] = await Promise.all([db.listOrgs(), db.listActiveOrgsWithOfficers()]);
      const officersOf = new Map(active.map((o) => [o.id, o.officers]));
      return json({ orgs: orgs.map((o) => ({ ...o, officers: officersOf.get(o.id) ?? [] })) });
    }
    if (req.method !== "POST") throw methodNotAllowed(["GET", "POST"]);
    const body = await readJson(req, Body);
    const log = (target: string, payload: Record<string, unknown>) =>
      db.insertAdminAction({ actorWallet: caller.profile.wallet, action: `org_${body.action}`, target, payload });

    if (body.action === "create") {
      try {
        const org = await db.insertOrg(body.name);
        await log(String(org.id), { name: org.name });
        return json({ org }, { status: 201 });
      } catch (error) {
        if (error instanceof UniqueViolation) throw conflict("an org with that name already exists", "duplicate_org");
        throw error;
      }
    }
    const org = await db.getOrg(body.orgId);
    if (!org) throw notFound("no such org");
    if (body.action === "set-active") {
      await db.setOrgActive(org.id, body.active);
      await log(String(org.id), { active: body.active });
      return json({ org: { ...org, active: body.active } });
    }
    if (!(await db.getProfile(body.wallet))) throw notFound("that wallet has no account yet; ask them to sign up first");
    await db.upsertOfficer({ orgId: org.id, wallet: body.wallet, title: body.title ?? null, active: body.active });
    await log(String(org.id), { wallet: body.wallet, title: body.title ?? null, active: body.active });
    return json({ ok: true });
  };
}
