import { amountDue, interestRateTenths, principalUnits } from "@app/adapters";
import type { NetworkConfig } from "@app/config";
import { paramsAsBigInt } from "@app/config";
import { LoanPayFlags, type LoanPay, type LoanSet } from "xrpl";
import type { TokenVerifier } from "../_shared/auth.ts";
import { requireCaller } from "../_shared/auth.ts";
import { amountRemaining, receivableView, loadReceivable, requireSeller } from "../_shared/receivables.ts";
import type { ReceivableStatus, Db } from "../_shared/db/types.ts";
import type { Env } from "../_shared/env.ts";
import { type Handler, conflict, json, methodNotAllowed, readJson } from "../_shared/http.ts";
import type { Ledger } from "../_shared/ledger.ts";
import {
  brokerWallet,
  dueAtFromLoan,
  ensureAccess,
  issuedAmount,
  paymentDueUnits,
  readySetup,
  rethrowLedger,
  signingSeed,
  vaultSnapshot,
} from "../_shared/lending.ts";
import type { Custody } from "../_shared/wallets.ts";
import { z } from "zod";

export type LoansDeps = {
  auth: TokenVerifier;
  db: Db;
  ledger: Ledger;
  custody: Custody;
  config: NetworkConfig;
  env: Env;
  now?: () => Date;
};

const Body = z.strictObject({
  action: z.enum(["fund", "pay"]),
  receivableId: z.uuid(),
});

const PAYABLE: ReceivableStatus[] = ["Funded", "GuarantorCalled", "WrittenOff"];

/**
 * Funding and repayment. An approved receivable becomes one loan from the vault, running to the payer's due date; the
 * borrower pays that loan back from their custodial wallet. Both keys stay on the server, so each is one button.
 */
export function createLoansHandler(deps: LoansDeps): Handler {
  const now = deps.now ?? (() => new Date());
  return async (req) => {
    if (req.method !== "POST") throw methodNotAllowed(["POST"]);
    const caller = await requireCaller(req, deps);
    const body = await readJson(req, Body);
    const receivable = await loadReceivable(deps.db, body.receivableId);
    requireSeller(caller, receivable);
    if (body.action === "fund") return fund(deps, receivable.id, now());
    return pay(deps, receivable.id, now());
  };
}

async function fund(deps: LoansDeps, receivableId: string, now: Date): Promise<Response> {
  const receivable = await loadReceivable(deps.db, receivableId);
  if (receivable.status !== "Approved") throw conflict("this isn't waiting to be funded", "invalid_state");
  if (!receivable.approvalExpiresAt || Date.parse(receivable.approvalExpiresAt) <= now.getTime()) {
    throw conflict("this approval has expired", "approval_expired");
  }
  const profile = await deps.db.getProfile(receivable.recipientWallet);
  if (profile?.kycStatus !== "approved") throw conflict("finish verification before you take this loan", "kyc_required");
  const setup = readySetup(deps.config);
  // the loan runs to the receivable's due date: the end of that day, UTC
  const term = loanTermSeconds(receivable.dueDate, now);
  if (term < MIN_TERM_SECONDS) throw conflict("the payer's due date is too close to start a loan now", "due_too_soon");
  // the ledger refuses a grace period longer than the payment interval, so a short loan gets a shorter grace
  const grace = Math.min(deps.config.params.writeOffGraceSeconds, term);

  const params = paramsAsBigInt(deps.config);
  const principal = principalUnits(BigInt(receivable.approvedAmount), deps.config.params.advanceRateBps);
  if (principal <= 0n) throw conflict("this approval is for nothing", "zero");
  if (principal > params.perReceivableCap) throw conflict("this is above the largest loan", "over_cap");
  if (receivable.orgId !== null) {
    const open = await deps.db.listReceivablesByStatus(["Funded", "GuarantorCalled", "WrittenOff"]);
    const used = open.filter((other) => other.orgId === receivable.orgId).reduce((sum, other) => sum + BigInt(other.purchasePrice), 0n);
    if (used + principal > params.perOrgCap) throw conflict("this business is at its loan limit", "over_org_cap");
  }

  const snapshot = await vaultSnapshot(deps.ledger, deps.config, Math.floor(now.getTime() / 1000));
  if (snapshot.phase === "subscription") throw conflict("loans start once the deposit window closes", "vault_phase");
  if (snapshot.phase === "closed") throw conflict("a loan of this length would end after the vault's redemption date", "vault_phase");

  const key = `fund:${receivable.id}`;
  if (!(await deps.db.claimOnce(key))) throw conflict("this loan is already being created", "in_progress");
  let sent = false;
  try {
    const seed = signingSeed(deps.env, "BROKER_SEED");
    await ensureAccess({ ledger: deps.ledger, custody: deps.custody, config: deps.config, brokerSeed: seed, holder: receivable.recipientWallet });
    const borrower = await deps.custody.signer(receivable.recipientWallet);
    const broker = brokerWallet(deps.config, seed);
    const tx: LoanSet = {
      TransactionType: "LoanSet",
      Account: borrower.classicAddress,
      Counterparty: broker.classicAddress,
      LoanBrokerID: setup.loanBrokerId,
      PrincipalRequested: issuedAmount(deps.config, principal).value,
      InterestRate: interestRateTenths(receivable.feeBps),
      LateInterestRate: 0,
      CloseInterestRate: 0,
      OverpaymentInterestRate: 0,
      PaymentTotal: 1,
      PaymentInterval: term,
      GracePeriod: grace,
    };
    const submitted = await deps.ledger.submitCoSigned(borrower, broker, tx, { purpose: "fund_loan", receivableId: receivable.id });
    sent = true;
    const loanId = loanIndex(submitted.createdId);
    const entry = await deps.ledger.readEntry(loanId);
    const formula = amountDue(principal, BigInt(receivable.feeBps), term);
    const priced = paymentDueUnits(entry);
    const due = priced !== null && priced > formula ? priced : formula;
    const dueAt = dueAtFromLoan(entry, new Date(now.getTime() + term * 1000));
    const moved = await deps.db.transitionReceivable(receivable.id, ["Approved"], {
      status: "Funded",
      purchasePrice: principal.toString(),
      amountDue: due.toString(),
      amountPaid: "0",
      purchasedAt: now.toISOString(),
      dueAt,
      loanId,
    });
    if (!moved) throw conflict("this changed since the page loaded", "invalid_state");
    return json({ receivable: receivableView(moved) });
  } catch (error) {
    if (!sent) await deps.db.releaseOnce(key);
    rethrowLedger(error);
  }
}

async function pay(deps: LoansDeps, receivableId: string, now: Date): Promise<Response> {
  const receivable = await loadReceivable(deps.db, receivableId);
  if (!PAYABLE.includes(receivable.status)) throw conflict("this loan isn't waiting on a payment", "invalid_state");
  if (!receivable.loanId) throw conflict("this loan isn't on the ledger", "no_loan");
  const remaining = amountRemaining(receivable);
  if (remaining <= 0n) throw conflict("this loan is already paid", "paid");

  const key = `pay:${receivable.id}`;
  if (!(await deps.db.claimOnce(key))) throw conflict("this payment is already being sent", "in_progress");
  let sent = false;
  try {
    const borrower = await deps.custody.signer(receivable.recipientWallet);
    const late = receivable.dueAt !== null && Date.parse(receivable.dueAt) < now.getTime();
    const tx: LoanPay = {
      TransactionType: "LoanPay",
      Account: borrower.classicAddress,
      LoanID: receivable.loanId,
      Amount: issuedAmount(deps.config, remaining),
      ...(late ? { Flags: LoanPayFlags.tfLoanLatePayment } : {}),
    };
    await deps.ledger.submit(borrower, tx, { purpose: "pay_loan", receivableId: receivable.id });
    sent = true;
    const patch = { status: "Settled" as const, amountPaid: receivable.amountDue };
    const moved =
      (await deps.db.transitionReceivable(receivable.id, PAYABLE, patch)) ?? (await deps.db.updateReceivable(receivable.id, patch));
    return json({ receivable: receivableView(moved) });
  } catch (error) {
    if (!sent) await deps.db.releaseOnce(key);
    rethrowLedger(error);
  }
}

/** A loan shorter than a day isn't worth opening; the receivable form already asks for a date after today. */
export const MIN_TERM_SECONDS = 86_400;

/** Seconds from `now` to the end of the receivable's due date (YYYY-MM-DD, UTC). The receivables function caps how far out that is. */
export function loanTermSeconds(dueDate: string, now: Date): number {
  const end = Date.parse(`${dueDate}T23:59:59Z`);
  return Math.max(0, Math.floor((end - now.getTime()) / 1000));
}

function loanIndex(id: string | null): string {
  const upper = (id ?? "").toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(upper)) throw conflict("the ledger didn't return the loan", "no_loan");
  return upper;
}
