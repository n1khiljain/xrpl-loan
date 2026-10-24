import type { FraxNetClient } from "@app/adapters";
import { type TokenVerifier, authenticate, normalizeWallet, requireCaller, requireStaff } from "../_shared/auth.ts";
import type { Db } from "../_shared/db/types.ts";
import { recheck } from "../_shared/fraxnet.ts";
import { type Handler, badRequest, json, methodNotAllowed } from "../_shared/http.ts";

export type DirectoryDeps = { auth: TokenVerifier; db: Db; fraxnet: FraxNetClient; now?: () => Date };

/**
 * Lookups the web app needs that no other function returns (U-60). `?view=orgs`: active orgs and their active
 * officers' names, for choosing a guarantor (PRD 8.1 step 4); any signed-in user. `?view=people&wallets=a,b`:
 * display names and KYC status for the review queue (PRD 8.3 step 2); staff only. Each member who connected FraxNet
 * is asked about again first, so the Approve button never rests on a verification FraxNet has since withdrawn
 * (security campaign E-2f). The approval itself is an onchain Safe transaction, so this is the last server check.
 */
// UNCERTAIN: U-60
export function createDirectoryHandler(deps: DirectoryDeps): Handler {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  return async (req) => {
    await authenticate(req, deps.auth);
    if (req.method !== "GET") throw methodNotAllowed(["GET"]);
    const url = new URL(req.url);
    const view = url.searchParams.get("view");

    if (view === "orgs") return json({ orgs: await db.listActiveOrgsWithOfficers() });

    if (view === "people") {
      requireStaff(await requireCaller(req, deps), ["underwriter", "attester", "admin"]);
      const wallets = (url.searchParams.get("wallets") ?? "").split(",").filter(Boolean);
      if (wallets.length === 0 || wallets.length > 50) throw badRequest("pass 1 to 50 wallets");
      const people = await Promise.all(
        wallets.map(async (w) => {
          const wallet = normalizeWallet(w);
          const stored = await db.getProfile(wallet);
          // UNCERTAIN: U-90 (if FraxNet is down, the stored status stands)
          const profile = stored && (await recheck({ db, fraxnet: deps.fraxnet, now, walletChainId: null }, stored)).profile;
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
