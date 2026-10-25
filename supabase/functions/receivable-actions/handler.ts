import type { NetworkConfig } from "@app/config";
import { z } from "zod";
import { type Caller, type TokenVerifier, requireCaller, requireStaff } from "../_shared/auth.ts";
import { receivableView, loadReceivable, requireSeller, unitsString, uuid } from "../_shared/receivables.ts";
import type { Receivable, ReceivablePatch, ReceivableStatus, Db } from "../_shared/db/types.ts";
import { renderEmail } from "../_shared/emails.ts";
import { type Handler, badRequest, conflict, forbidden, json, methodNotAllowed, readJson } from "../_shared/http.ts";
import type { Mailer } from "../_shared/mail.ts";

export type ReceivableActionsDeps = { auth: TokenVerifier; db: Db; config: NetworkConfig; mailer: Mailer; appBaseUrl: string; now?: () => Date };

const Body = z.discriminatedUnion("action", [
  /** seller: send a signed-off draft for review. Finance agents at the seller's organization see it before an admin does. */
  z.strictObject({ action: z.literal("submit"), receivableId: uuid }),
  /** finance agent: send a request on to the admin review queue */
  z.strictObject({ action: z.literal("send-to-admin"), receivableId: uuid }),
  /** seller: withdraw a request that hasn't been paid */
  z.strictObject({ action: z.literal("cancel"), receivableId: uuid }),
  /** underwriter: approve up to what was asked for */
  z.strictObject({ action: z.literal("approve"), receivableId: uuid, amount: unitsString }),
  /** underwriter: turn it down, with a short reason code */
  z.strictObject({ action: z.literal("reject"), receivableId: uuid, reason: z.string().trim().min(1).max(200) }),
  /** seller: the payer rejected it or paid less */
  z.strictObject({
    action: z.literal("report-outcome"),
    receivableId: uuid,
    outcome: z.enum(["rejected", "short_paid"]),
    note: z.string().trim().max(2000).optional(),
  }),
  /** attester: ask the guarantor to cover what's left */
  z.strictObject({ action: z.literal("call-guarantor"), receivableId: uuid, reason: z.enum(["payer_rejected", "partial_shortfall", "overdue"]) }),
  /** attester: write off principal the guarantor didn't cover after the grace period */
  z.strictObject({ action: z.literal("write-off"), receivableId: uuid }),
]);
type Action = z.infer<typeof Body>;

const iso = (d: Date) => d.toISOString();
const plus = (d: Date, seconds: number) => new Date(d.getTime() + seconds * 1000);

/**
 * Moves a receivable along its lifecycle. Each step checks who's asking and that the receivable is in the state the step
 * starts from, then changes it in one conditional update, so two clicks can't both apply. Every staff step is
 * logged in admin_actions; admins can take any staff step. Funding and payments are XRPL transactions and live in
 * their own functions.
 */
export function createReceivableActionsHandler(deps: ReceivableActionsDeps): Handler {
  const now = deps.now ?? (() => new Date());
  const { db, config } = deps;
  const perReceivableCap = BigInt(config.params.perReceivableCap);

  async function move(receivable: Receivable, from: ReceivableStatus[], patch: ReceivablePatch): Promise<Receivable> {
    if (!from.includes(receivable.status)) throw conflict(`this can't happen while it's ${receivable.status}`, "invalid_state");
    const moved = await db.transitionReceivable(receivable.id, from, patch);
    if (!moved) throw conflict("this changed since the page loaded; refresh to see where it is now", "invalid_state");
    return moved;
  }

  async function log(caller: Caller, action: string, receivable: Receivable, payload: Record<string, unknown>) {
    await db.insertAdminAction({ actorWallet: caller.profile.wallet, action, target: receivable.id, payload: { ...payload, at: iso(now()) } });
  }

  async function email(receivable: Receivable) {
    const recipient = await db.getProfile(receivable.recipientWallet);
    if (!recipient?.email) return;
    if (!(await db.recordNotification({ wallet: receivable.recipientWallet, kind: "receivable_approved", receivableId: receivable.id }))) return;
    const link = `${deps.appBaseUrl.replace(/\/+$/, "")}/receivable/?id=${receivable.id}`;
    await deps.mailer.send(renderEmail(recipient.email, { kind: "receivable_approved", amount: receivable.approvedAmount, link })).catch((e) => console.error(e));
  }

  async function run(caller: Caller, body: Action, receivable: Receivable): Promise<Receivable> {
    switch (body.action) {
      case "submit": {
        requireSeller(caller, receivable);
        if (!receivable.packetHash) throw conflict("finish the request first", "not_frozen");
        if (receivable.guarantorWallet && !receivable.guarantySignedAt) throw conflict("your officer has to sign off first", "not_signed");
        if (receivable.guarantorWallet && receivable.orgId !== null && !(await db.isActiveOfficer(receivable.orgId, receivable.guarantorWallet))) {
          throw conflict("the officer who signed off isn't active in the org anymore; pick another", "not_officer");
        }
        // other finance agents in the seller's organization review it before it reaches an admin
        const member = await db.getMember(caller.profile.wallet);
        const org = member ? await db.getOrg(member.orgId) : null;
        const peers = org?.active ? (await db.listFinanceAgents(org.id)).filter((wallet) => wallet !== caller.profile.wallet) : [];
        const next = peers.length > 0 ? "FinanceReview" : "Submitted";
        return move(receivable, ["Draft"], { status: next, submittedAt: iso(now()) });
      }

      case "send-to-admin": {
        const member = await db.getMember(caller.profile.wallet);
        if (!member?.financeAgent) throw forbidden("only a finance agent at the organization can send this on");
        const seller = await db.getMember(receivable.recipientWallet);
        if (!seller || seller.orgId !== member.orgId) throw forbidden("this request isn't for your organization");
        if (receivable.recipientWallet === caller.profile.wallet) throw conflict("you can't send your own request on", "self_approval");
        const org = await db.getOrg(member.orgId);
        if (!org?.active) throw conflict("that organization isn't active", "org_inactive");
        const moved = await move(receivable, ["FinanceReview"], {
          status: "Submitted",
          financeClearedAt: iso(now()),
          financeClearedBy: caller.profile.wallet,
        });
        await log(caller, "send_to_admin", receivable, {});
        return moved;
      }

      case "cancel":
        requireSeller(caller, receivable);
        return move(receivable, ["FinanceReview", "Submitted", "Approved"], { status: "Cancelled" });

      case "approve": {
        requireStaff(caller, ["underwriter", "admin"]);
        if (receivable.recipientWallet === caller.profile.wallet) throw conflict("you can't approve your own receivable", "self_approval");
        const amount = BigInt(body.amount);
        if (amount > BigInt(receivable.requestedAmount)) throw badRequest("that's more than was asked for", "over_requested");
        if (amount > perReceivableCap) throw badRequest("that's over the per-receivable cap", "over_cap");
        const recipient = await db.getProfile(receivable.recipientWallet);
        if (recipient?.kycStatus !== "approved") throw conflict("the seller isn't verified", "kyc_required");
        // an admin doesn't have to wait for the organization's finance agent
        const moved = await move(receivable, ["FinanceReview", "Submitted"], {
          status: "Approved",
          approvedAmount: amount.toString(),
          approvedBy: caller.profile.wallet,
          approvalExpiresAt: iso(plus(now(), config.params.approvalExpirySeconds)),
          feeBps: config.params.feeBps,
        });
        await log(caller, "approve", receivable, { amount: body.amount });
        await email(moved);
        return moved;
      }

      case "reject": {
        requireStaff(caller, ["underwriter", "admin"]);
        const moved = await move(receivable, ["FinanceReview", "Submitted"], { status: "Rejected", rejectReason: body.reason });
        await log(caller, "reject", receivable, { reason: body.reason });
        return moved;
      }

      case "report-outcome":
        requireSeller(caller, receivable);
        if (receivable.status !== "Funded") throw conflict(`reports are for paid receivables; this one is ${receivable.status}`, "not_funded");
        return db.updateReceivable(receivable.id, { payerOutcome: body.outcome, payerOutcomeNote: body.note ?? null, payerOutcomeAt: iso(now()) });

      case "call-guarantor": {
        requireStaff(caller, ["attester", "admin"]);
        if (!receivable.guarantorWallet) throw conflict("this receivable has no guarantor", "no_guarantor");
        if (body.reason === "overdue" && (!receivable.dueAt || Date.parse(receivable.dueAt) > now().getTime())) {
          throw conflict("it isn't overdue yet", "not_overdue");
        }
        const moved = await move(receivable, ["Funded"], {
          status: "GuarantorCalled",
          callReason: body.reason,
          guarantorCalledAt: iso(now()),
          writeOffEligibleAt: iso(plus(now(), config.params.writeOffGraceSeconds)),
        });
        await log(caller, "call_guarantor", receivable, { reason: body.reason });
        return moved;
      }

      case "write-off": {
        requireStaff(caller, ["attester", "admin"]);
        if (!receivable.writeOffEligibleAt || Date.parse(receivable.writeOffEligibleAt) > now().getTime()) {
          throw conflict("the grace period hasn't ended yet", "too_early");
        }
        const unpaid = BigInt(receivable.purchasePrice) - BigInt(receivable.amountPaid);
        const moved = await move(receivable, ["GuarantorCalled"], {
          status: "WrittenOff",
          principalWrittenOff: true,
          writtenOffPrincipal: (unpaid > 0n ? unpaid : 0n).toString(),
        });
        await log(caller, "write_off", receivable, { writtenOff: moved.writtenOffPrincipal });
        return moved;
      }
    }
  }

  return async (req) => {
    const caller = await requireCaller(req, deps);
    if (req.method !== "POST") throw methodNotAllowed(["POST"]);
    const body = await readJson(req, Body);
    const receivable = await loadReceivable(db, body.receivableId);
    return json({ receivable: receivableView(await run(caller, body, receivable)) });
  };
}

