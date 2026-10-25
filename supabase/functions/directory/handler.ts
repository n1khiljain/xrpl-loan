import { type TokenVerifier, authenticate, normalizeWallet, requireCaller, requireStaff } from "../_shared/auth.ts";
import type { Db } from "../_shared/db/types.ts";
import { type Handler, badRequest, json, methodNotAllowed } from "../_shared/http.ts";

export type DirectoryDeps = { auth: TokenVerifier; db: Db };

/**
 * Lookups the web app needs that no other function returns. `?view=orgs`: active orgs and their active officers'
 * names, for choosing a guarantor; any signed-in user. `?view=people&wallets=a,b`: display names and KYC status for
 * the review queue; staff only.
 */
export function createDirectoryHandler(deps: DirectoryDeps): Handler {
  const { db } = deps;
  return async (req) => {
    await authenticate(req, deps.auth);
    if (req.method !== "GET") throw methodNotAllowed(["GET"]);
    const url = new URL(req.url);
    const view = url.searchParams.get("view");

    if (view === "orgs") {
      // the join code stays off this list: people type the one a teammate gave them
      const orgs = await db.listActiveOrgsWithOfficers();
      return json({
        orgs: orgs.map((org) => ({ id: org.id, name: org.name, active: org.active, officers: org.officers })),
      });
    }

    if (view === "people") {
      requireStaff(await requireCaller(req, deps), ["underwriter", "attester", "admin"]);
      const wallets = (url.searchParams.get("wallets") ?? "").split(",").filter(Boolean);
      if (wallets.length === 0 || wallets.length > 50) throw badRequest("pass 1 to 50 wallets");
      const people = await Promise.all(
        wallets.map(async (w) => {
          const wallet = normalizeWallet(w);
          const profile = await db.getProfile(wallet);
          return {
            wallet,
            hasProfile: profile !== null,
            displayName: profile?.displayName ?? null,
            kycStatus: profile?.kycStatus ?? null,
          };
        }),
      );
      return json({ people });
    }

    throw badRequest("view must be orgs or people");
  };
}
