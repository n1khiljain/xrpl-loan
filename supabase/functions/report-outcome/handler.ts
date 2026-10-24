import type { ChainReader } from "@app/adapters";
import { z } from "zod";
import { type TokenVerifier, requireCaller } from "../_shared/auth.ts";
import { claimView, loadClaim, requireClaimant, uuid } from "../_shared/claims.ts";
import type { Db } from "../_shared/db/types.ts";
import { type Handler, conflict, json, methodNotAllowed, readJson } from "../_shared/http.ts";

export type ReportOutcomeDeps = { auth: TokenVerifier; db: Db; chain: ChainReader; now?: () => Date };

const Body = z.strictObject({
  claimId: uuid,
  outcome: z.enum(["rejected", "short_paid"]),
  note: z.string().trim().max(2000).optional(),
});

/**
 * The claimant reports "ASUC rejected" or "ASUC paid less" on a purchased claim. The report shows up in the
 * attester's exceptions list (`claims?scope=reported`), who decides whether to call the guarantor (FR-B11).
 */
export function createReportOutcomeHandler(deps: ReportOutcomeDeps): Handler {
  const now = deps.now ?? (() => new Date());
  return async (req) => {
    const caller = await requireCaller(req, deps);
    if (req.method !== "POST") throw methodNotAllowed(["POST"]);
    const body = await readJson(req, Body);
    const claim = await loadClaim(deps.db, body.claimId);
    requireClaimant(caller, claim);
    if (claim.onchainClaimId === null) throw conflict("this claim hasn't been submitted onchain", "not_onchain");
    // read the chain, not status_cache, so a lagging sync can't block or allow a report
    const onchain = await deps.chain.getClaim(BigInt(claim.onchainClaimId));
    // UNCERTAIN: U-58
    if (onchain.state !== "Funded") throw conflict(`reports are for purchased claims; this one is ${onchain.state}`, "not_funded");
    const updated = await deps.db.updateClaim(claim.id, {
      asucOutcome: body.outcome,
      asucOutcomeNote: body.note ?? null,
      asucOutcomeAt: now().toISOString(),
    });
    return json({ claim: claimView(updated) });
  };
}
