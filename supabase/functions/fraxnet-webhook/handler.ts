import { z } from "zod";
import { normalizeWallet } from "../_shared/auth.ts";
import type { Db } from "../_shared/db/types.ts";
import { type Handler, HttpError, badRequest, conflict, json, methodNotAllowed, unauthorized } from "../_shared/http.ts";

export type WebhookDeps = { db: Db; secret: string | undefined; now?: () => Date };

export const SIGNATURE_HEADER = "x-fraxnet-signature";

// UNCERTAIN: U-51 (the payload shape is ours until Frax documents theirs)
const Payload = z.object({
  wallet: z.string(),
  status: z.enum(["not_started", "pending", "approved", "rejected"]),
  kind: z.enum(["individual", "business"]).optional(),
  approvedAt: z.string().optional(),
});

const encoder = new TextEncoder();

export async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * FraxNet calls this when a linked user's verification changes, if Frax offers webhooks. It carries no Privy token;
 * the HMAC SHA-256 of the raw body with `FRAXNET_WEBHOOK_SECRET` proves it came from Frax (U-49, U-51).
 *
 * The signature covers only the body, with no timestamp or event ID, so each signed body is applied at most once
 * (its HMAC is kept in `once_keys`) and a replay gets 409 (security campaign E-2c). A manual rejection made at
 * `/admin/kyc/` stands: a webhook never overrides it (E-2d).
 */
export function createWebhookHandler(deps: WebhookDeps): Handler {
  const now = deps.now ?? (() => new Date());
  return async (req) => {
    // UNCERTAIN: U-49 (HMAC instead of a Privy token)
    if (!deps.secret) throw new HttpError(503, "not_configured", "FRAXNET_WEBHOOK_SECRET is not set");
    if (req.method !== "POST") throw methodNotAllowed(["POST"]);
    const raw = await req.text();
    const given = req.headers.get(SIGNATURE_HEADER)?.trim().toLowerCase() ?? "";
    const expected = await hmacHex(deps.secret, raw);
    if (!given || !timingSafeEqual(given, expected)) throw unauthorized("bad webhook signature");

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw badRequest("body must be JSON");
    }
    const payload = Payload.safeParse(parsed);
    if (!payload.success) throw badRequest("unexpected webhook payload");

    const wallet = normalizeWallet(payload.data.wallet);
    const profile = await deps.db.getProfile(wallet);
    // a wallet that never signed up here is not an error for the sender, so no retry storm
    if (!profile) return json({ updated: false }, { status: 202 });
    // UNCERTAIN: U-87 (replay protection by body digest until Frax's webhook signs a timestamp or event ID)
    const once = `fraxnet-webhook:${expected}`;
    if (!(await deps.db.claimOnce(once))) throw conflict("this delivery was already applied", "replayed");
    if (profile.kycSource === "manual" && profile.kycStatus === "rejected") return json({ updated: false }, { status: 202 });
    try {
      await deps.db.updateProfile(wallet, {
        kycStatus: payload.data.status,
        kycSource: "fraxnet_api",
        kycUpdatedBy: null,
        kycUpdatedAt: now().toISOString(),
      });
    } catch (error) {
      await deps.db.releaseOnce(once);
      throw error;
    }
    return json({ updated: true });
  };
}
