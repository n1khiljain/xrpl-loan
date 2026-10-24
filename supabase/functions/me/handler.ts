import { z } from "zod";
import { type TokenVerifier, authenticate, normalizeWallet, verifyWalletBinding } from "../_shared/auth.ts";
import { hexSignature } from "../_shared/claims.ts";
import { type Db, UniqueViolation } from "../_shared/db/types.ts";
import { type Handler, conflict, json, methodNotAllowed, readJson } from "../_shared/http.ts";

export type MeDeps = { auth: TokenVerifier; db: Db; now?: () => Date };

const PostBody = z.strictObject({
  wallet: z.string(),
  /** personal_sign over bindingMessage(); needed only the first time a wallet is linked (U-50) */
  signature: hexSignature.optional(),
  issuedAt: z.string().optional(),
  // UNCERTAIN: U-56
  email: z.email().max(254).nullable().optional(),
  displayName: z.string().trim().min(1).max(80).nullable().optional(),
});

/**
 * GET: the caller's profile, staff role, and officer orgs. POST: link a wallet the first time (with a wallet
 * signature), or update email and display name after that.
 */
export function createMeHandler(deps: MeDeps): Handler {
  const now = deps.now ?? (() => new Date());
  const { db } = deps;

  async function view(wallet: `0x${string}` | null) {
    if (!wallet) return { profile: null, staffRole: null, officerOrgs: [] };
    const [profile, staffRole, officerOrgs] = await Promise.all([
      db.getProfile(wallet),
      db.getStaffRole(wallet),
      db.listOfficerOrgs(wallet),
    ]);
    return { profile, staffRole, officerOrgs };
  }

  return async (req) => {
    const user = await authenticate(req, deps.auth);
    const existing = await db.getProfileByPrivyId(user.userId);

    if (req.method === "GET") return json(await view(existing?.wallet ?? null));
    if (req.method !== "POST") throw methodNotAllowed(["GET", "POST"]);

    const body = await readJson(req, PostBody);
    const wallet = normalizeWallet(body.wallet);
    const details = {
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
    };

    if (existing) {
      if (existing.wallet !== wallet) throw conflict("this account already has a different wallet linked", "wallet_already_linked");
      if (Object.keys(details).length > 0) await db.updateProfile(wallet, details);
      return json(await view(wallet));
    }

    if (!body.signature || !body.issuedAt) {
      throw conflict("sign the link message with this wallet first", "binding_required");
    }
    await verifyWalletBinding({
      privyUserId: user.userId,
      wallet,
      issuedAt: body.issuedAt,
      signature: body.signature,
      now: now(),
    });
    try {
      await db.insertProfile({
        wallet,
        privyUserId: user.userId,
        email: body.email ?? null,
        displayName: body.displayName ?? null,
      });
    } catch (error) {
      if (error instanceof UniqueViolation) throw conflict("this wallet is linked to another account", "wallet_taken");
      throw error;
    }
    return json(await view(wallet), { status: 201 });
  };
}
