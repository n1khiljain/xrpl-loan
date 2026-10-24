import type { NetworkConfig } from "@app/config";
import { z } from "zod";
import { type Caller, type TokenVerifier, requireCaller, requireStaff } from "../_shared/auth.ts";
import { claimView, loadClaim, requireClaimant, unitsString, uuid } from "../_shared/claims.ts";
import type { Claim, ClaimPatch, ClaimStatus, Db } from "../_shared/db/types.ts";
import { renderEmail } from "../_shared/emails.ts";
import { type Handler, badRequest, conflict, json, methodNotAllowed, readJson } from "../_shared/http.ts";
import type { Mailer } from "../_shared/mail.ts";

export type ClaimActionsDeps = { auth: TokenVerifier; db: Db; config: NetworkConfig; mailer: Mailer; appBaseUrl: string; now?: () => Date };

const Body = z.discriminatedUnion("action", [
  /** claimant: send a signed-off draft for review */
  z.strictObject({ action: z.literal("submit"), claimId: uuid }),
  /** claimant: withdraw a request that hasn't been paid */
  z.strictObject({ action: z.literal("cancel"), claimId: uuid }),
  /** underwriter: approve up to what was asked for */
  z.strictObject({ action: z.literal("approve"), claimId: uuid, amount: unitsString }),
  /** underwriter: turn it down, with a short reason code */
  z.strictObject({ action: z.literal("reject"), claimId: uuid, reason: z.string().trim().min(1).max(200) }),
  /** claimant: the payer rejected it or paid less */
  z.strictObject({
    action: z.literal("report-outcome"),
    claimId: uuid,
    outcome: z.enum(["rejected", "short_paid"]),
    note: z.string().trim().max(2000).optional(),
  }),
  /** attester: ask the guarantor to cover what's left */
  z.strictObject({ action: z.literal("call-guarantor"), claimId: uuid, reason: z.enum(["asuc_rejected", "partial_shortfall", "overdue"]) }),
  /** attester: write off principal the guarantor didn't cover after the grace period */
  z.strictObject({ action: z.literal("write-off"), claimId: uuid }),
]);
type Action = z.infer<typeof Body>;

const iso = (d: Date) => d.toISOString();
const plus = (d: Date, seconds: number) => new Date(d.getTime() + seconds * 1000);

/**
 * Moves a claim along its lifecycle. Each step checks who's asking and that the claim is in the state the step
 * starts from, then changes it in one conditional update, so two clicks can't both apply. Every staff step is
 * logged in admin_actions; admins can take any staff step. Funding and payments are XRPL transactions and live in
 * their own functions.
 */
export function createClaimActionsHandler(deps: ClaimActionsDeps): Handler {
  const now = deps.now ?? (() => new Date());
  const { db, config } = deps;
  const perClaimCap = BigInt(config.params.perClaimCap);

  async function move(claim: Claim, from: ClaimStatus[], patch: ClaimPatch): Promise<Claim> {
    if (!from.includes(claim.status)) throw conflict(`this can't happen while it's ${claim.status}`, "invalid_state");
    const moved = await db.transitionClaim(claim.id, from, patch);
    if (!moved) throw conflict("this changed since the page loaded; refresh to see where it is now", "invalid_state");
    return moved;
  }

  async function log(caller: Caller, action: string, claim: Claim, payload: Record<string, unknown>) {
    await db.insertAdminAction({ actorWallet: caller.profile.wallet, action, target: claim.id, payload: { ...payload, at: iso(now()) } });
  }

  async function email(claim: Claim) {
    const recipient = await db.getProfile(claim.recipientWallet);
    if (!recipient?.email) return;
    if (!(await db.recordNotification({ wallet: claim.recipientWallet, kind: "claim_approved", claimId: claim.id }))) return;
    const link = `${deps.appBaseUrl.replace(/\/+$/, "")}/claim/?id=${claim.id}`;
    await deps.mailer.send(renderEmail(recipient.email, { kind: "claim_approved", amount: claim.approvedAmount, link })).catch((e) => console.error(e));
  }

  async function run(caller: Caller, body: Action, claim: Claim): Promise<Claim> {
    switch (body.action) {
      case "submit":
        requireClaimant(caller, claim);
        if (!claim.packetHash || !claim.guarantySignedAt) throw conflict("your officer has to sign off first", "not_signed");
        if (claim.guarantorWallet && !(await db.isActiveOfficer(claim.orgId, claim.guarantorWallet))) {
          throw conflict("the officer who signed off isn't active in the org anymore; pick another", "not_officer");
        }
        return move(claim, ["Draft"], { status: "Submitted", submittedAt: iso(now()) });

      case "cancel":
        requireClaimant(caller, claim);
        return move(claim, ["Submitted", "Approved"], { status: "Cancelled" });

      case "approve": {
        requireStaff(caller, ["underwriter", "admin"]);
        if (claim.recipientWallet === caller.profile.wallet) throw conflict("you can't approve your own claim", "self_approval");
        const amount = BigInt(body.amount);
        if (amount > BigInt(claim.requestedAmount)) throw badRequest("that's more than was asked for", "over_requested");
        if (amount > perClaimCap) throw badRequest("that's over the per-claim cap", "over_cap");
        const recipient = await db.getProfile(claim.recipientWallet);
        if (recipient?.kycStatus !== "approved") throw conflict("the claimant isn't verified", "kyc_required");
        const moved = await move(claim, ["Submitted"], {
          status: "Approved",
          approvedAmount: amount.toString(),
          approvedBy: caller.profile.wallet,
          approvalExpiresAt: iso(plus(now(), config.params.approvalExpirySeconds)),
          feeBps: config.params.feeBps,
        });
        await log(caller, "approve", claim, { amount: body.amount });
        await email(moved);
        return moved;
      }

      case "reject": {
        requireStaff(caller, ["underwriter", "admin"]);
        const moved = await move(claim, ["Submitted"], { status: "Rejected", rejectReason: body.reason });
        await log(caller, "reject", claim, { reason: body.reason });
        return moved;
      }

      case "report-outcome":
        requireClaimant(caller, claim);
        if (claim.status !== "Funded") throw conflict(`reports are for paid claims; this one is ${claim.status}`, "not_funded");
        return db.updateClaim(claim.id, { asucOutcome: body.outcome, asucOutcomeNote: body.note ?? null, asucOutcomeAt: iso(now()) });

      case "call-guarantor": {
        requireStaff(caller, ["attester", "admin"]);
        if (!claim.guarantorWallet) throw conflict("this claim has no guarantor", "no_guarantor");
        if (body.reason === "overdue" && (!claim.dueAt || Date.parse(claim.dueAt) > now().getTime())) {
          throw conflict("it isn't overdue yet", "not_overdue");
        }
        const moved = await move(claim, ["Funded"], {
          status: "GuarantorCalled",
          callReason: body.reason,
          guarantorCalledAt: iso(now()),
          writeOffEligibleAt: iso(plus(now(), config.params.writeOffGraceSeconds)),
        });
        await log(caller, "call_guarantor", claim, { reason: body.reason });
        return moved;
      }

      case "write-off": {
        requireStaff(caller, ["attester", "admin"]);
        if (!claim.writeOffEligibleAt || Date.parse(claim.writeOffEligibleAt) > now().getTime()) {
          throw conflict("the grace period hasn't ended yet", "too_early");
        }
        const unpaid = BigInt(claim.purchasePrice) - BigInt(claim.amountPaid);
        const moved = await move(claim, ["GuarantorCalled"], {
          status: "WrittenOff",
          principalWrittenOff: true,
          writtenOffPrincipal: (unpaid > 0n ? unpaid : 0n).toString(),
        });
        await log(caller, "write_off", claim, { writtenOff: moved.writtenOffPrincipal });
        return moved;
      }
    }
  }

  return async (req) => {
    const caller = await requireCaller(req, deps);
    if (req.method !== "POST") throw methodNotAllowed(["POST"]);
    const body = await readJson(req, Body);
    const claim = await loadClaim(db, body.claimId);
    return json({ claim: claimView(await run(caller, body, claim)) });
  };
}

