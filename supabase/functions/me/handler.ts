import { z } from "zod";
import { type TokenVerifier, authenticate } from "../_shared/auth.ts";
import { type Db, type Profile, UniqueViolation, type Wallet } from "../_shared/db/types.ts";
import { type Handler, badRequest, json, methodNotAllowed, readJson } from "../_shared/http.ts";
import type { Ledger } from "../_shared/ledger.ts";
import type { Custody } from "../_shared/wallets.ts";

export type MeDeps = { auth: TokenVerifier; db: Db; custody: Custody; ledger: Ledger };

const PostBody = z.strictObject({
  /** A Privy identity token for the same user; its linked email marks the profile's email as verified. */
  identityToken: z.string().max(8192).optional(),
  email: z.email().max(254).nullable().optional(),
  displayName: z.string().trim().min(1).max(80).nullable().optional(),
});

/**
 * GET: the caller's profile, staff role, and officer orgs. POST: set up the account the first time, which makes
 * the custodial XRPL wallet and asks the faucet to fund it, or update email and display name after that. A Privy
 * identity token proves the email; without one the email is stored unverified.
 */
export function createMeHandler(deps: MeDeps): Handler {
  const { db } = deps;

  async function view(profile: Profile | null) {
    if (!profile) return { profile: null, staffRole: null, officerOrgs: [], wallet: null };
    const [staffRole, officerOrgs, wallet] = await Promise.all([
      db.getStaffRole(profile.wallet),
      db.listOfficerOrgs(profile.wallet),
      db.getWallet(profile.wallet),
    ]);
    return { profile, staffRole, officerOrgs, wallet: { address: profile.wallet, funded: Boolean(wallet?.fundedTx), fundedTx: wallet?.fundedTx ?? null } };
  }

  /** Funds a wallet once. A faucet hiccup leaves it unfunded; the next POST tries again. */
  async function ensureFunded(address: Wallet) {
    const row = await db.getWallet(address);
    if (!row || row.fundedTx) return;
    try {
      const { txHash } = await deps.ledger.fund(address);
      await db.setWalletFunded(address, txHash ?? "faucet");
    } catch (error) {
      console.error(`funding ${address} failed`, error);
    }
  }

  return async (req) => {
    const user = await authenticate(req, deps.auth);
    const existing = await db.getProfileByPrivyId(user.userId);

    if (req.method === "GET") return json(await view(existing));
    if (req.method !== "POST") throw methodNotAllowed(["GET", "POST"]);

    const body = await readJson(req, PostBody);
    let verifiedEmail: string | null = null;
    if (body.identityToken) {
      const identity = await deps.auth.verifyIdentity(body.identityToken).catch(() => null);
      if (!identity || identity.userId !== user.userId) throw badRequest("the identity token isn't for this account", "bad_identity");
      const wanted = (body.email ?? existing?.email ?? identity.verifiedEmails[0] ?? null)?.toLowerCase() ?? null;
      verifiedEmail = wanted && identity.verifiedEmails.includes(wanted) ? wanted : null;
    }
    const email = verifiedEmail ?? body.email ?? undefined;

    if (existing) {
      const patch = {
        ...(email !== undefined ? { email, emailVerified: verifiedEmail !== null && email === verifiedEmail } : {}),
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
      };
      // an email that's verified now and wasn't before moves KYC from not started to waiting on staff
      const kyc = patch.emailVerified && existing.kycStatus === "not_started" ? { kycStatus: "pending" as const } : {};
      const profile = Object.keys(patch).length > 0 ? await db.updateProfile(existing.wallet, { ...patch, ...kyc }) : existing;
      await ensureFunded(profile.wallet);
      return json(await view(profile));
    }

    const created = await deps.custody.create();
    await db.insertWallet(created);
    let profile: Profile;
    try {
      profile = await db.insertProfile({
        wallet: created.address,
        privyUserId: user.userId,
        email: email ?? null,
        emailVerified: verifiedEmail !== null,
        displayName: body.displayName ?? null,
      });
    } catch (error) {
      // two first-time POSTs raced; the other one made the account
      if (error instanceof UniqueViolation) return json(await view(await db.getProfileByPrivyId(user.userId)));
      throw error;
    }
    if (verifiedEmail) profile = await db.updateProfile(profile.wallet, { kycStatus: "pending" });
    await ensureFunded(profile.wallet);
    return json(await view(profile), { status: 201 });
  };
}
