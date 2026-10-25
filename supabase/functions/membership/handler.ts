import { normalizeJoinCode } from "@app/adapters";
import { z } from "zod";
import { type TokenVerifier, requireCaller } from "../_shared/auth.ts";
import { type Db, UniqueViolation } from "../_shared/db/types.ts";
import { membershipFor } from "../_shared/membership.ts";
import { type Handler, badRequest, conflict, json, methodNotAllowed, notFound, readJson } from "../_shared/http.ts";

export type MembershipDeps = { auth: TokenVerifier; db: Db };

const JoinCode = z.string().trim().min(1).max(20);
const RoleTitle = z.string().trim().min(1).max(80).nullable();

const Body = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("lookup"), joinCode: JoinCode }),
  z.strictObject({ action: z.literal("create"), name: z.string().trim().min(1).max(120), financeAgent: z.boolean(), roleTitle: RoleTitle }),
  z.strictObject({ action: z.literal("join"), joinCode: JoinCode, financeAgent: z.boolean(), roleTitle: RoleTitle }),
]);

/** Finance agent, or a written role. Not both, and not neither. */
function roleOf(financeAgent: boolean, roleTitle: string | null): { financeAgent: boolean; roleTitle: string | null } {
  if (financeAgent && roleTitle === null) return { financeAgent: true, roleTitle: null };
  if (!financeAgent && roleTitle) return { financeAgent: false, roleTitle };
  throw badRequest("choose finance agent or type your role", "role_required");
}

function codeOf(input: string): string {
  const code = normalizeJoinCode(input);
  if (!code) throw badRequest("that organization id isn't valid", "bad_join_code");
  return code;
}

/**
 * A signed-in person creates an organization or joins one with its id. Creating makes the shareable id.
 * Banking details aren't collected yet.
 */
export function createMembershipHandler(deps: MembershipDeps): Handler {
  const { db } = deps;
  return async (req) => {
    const caller = await requireCaller(req, deps);
    if (req.method !== "POST") throw methodNotAllowed(["POST"]);
    const body = await readJson(req, Body);
    const wallet = caller.profile.wallet;

    if (body.action === "lookup") {
      const org = await db.getOrgByJoinCode(codeOf(body.joinCode));
      if (!org?.active) throw notFound("no organization uses that id");
      return json({ org: { name: org.name, joinCode: org.joinCode } });
    }

    if (await db.getMember(wallet)) throw conflict("you already belong to an organization", "already_member");
    const role = roleOf(body.financeAgent, body.roleTitle);

    if (body.action === "create") {
      let org;
      try {
        org = await db.insertOrg(body.name);
      } catch (error) {
        if (error instanceof UniqueViolation) throw conflict("an organization with that name already exists", "duplicate_org");
        throw error;
      }
      await db.insertMember({ orgId: org.id, wallet, ...role });
      return json({ membership: await membershipFor(db, wallet) }, { status: 201 });
    }

    const org = await db.getOrgByJoinCode(codeOf(body.joinCode));
    if (!org?.active) throw notFound("no organization uses that id");
    try {
      await db.insertMember({ orgId: org.id, wallet, ...role });
    } catch (error) {
      if (error instanceof UniqueViolation) throw conflict("you already belong to an organization", "already_member");
      throw error;
    }
    return json({ membership: await membershipFor(db, wallet) }, { status: 201 });
  };
}
