import { amountDue, interestRateTenths, principalUnits } from "@app/adapters";
import type { NetworkConfig } from "@app/config";
import { paramsAsBigInt } from "@app/config";
import { LoanPayFlags, type LoanPay, type LoanSet } from "xrpl";
import type { TokenVerifier } from "../_shared/auth.ts";
import { requireCaller } from "../_shared/auth.ts";
import { amountRemaining, claimView, loadClaim, requireClaimant } from "../_shared/claims.ts";
import type { ClaimStatus, Db } from "../_shared/db/types.ts";
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
  claimId: z.uuid(),
});

const PAYABLE: ClaimStatus[] = ["Funded", "GuarantorCalled", "WrittenOff"];

/**
 * Funding and repayment. An approved claim becomes one loan from the vault; the borrower pays that loan back
 * from their custodial wallet. Both keys stay on the server, so each is one button.
 */
export function createLoansHandler(deps: LoansDeps): Handler {
  const now = deps.now ?? (() => new Date());
  return async (req) => {
    if (req.method !== "POST") throw methodNotAllowed(["POST"]);
    const caller = await requireCaller(req, deps);
    const body = await readJson(req, Body);
    const claim = await loadClaim(deps.db, body.claimId);
    requireClaimant(caller, claim);
    if (body.action === "fund") return fund(deps, claim.id, now());
    return pay(deps, claim.id, now());
  };
}

async function fund(deps: LoansDeps, claimId: string, now: Date): Promise<Response> {
  const claim = await loadClaim(deps.db, claimId);
  if (claim.status !== "Approved") throw conflict("this isn't waiting to be funded", "invalid_state");
  if (!claim.approvalExpiresAt || Date.parse(claim.approvalExpiresAt) <= now.getTime()) {
    throw conflict("this approval has expired", "approval_expired");
  }
  const profile = await deps.db.getProfile(claim.recipientWallet);
  if (profile?.kycStatus !== "approved") throw conflict("finish verification before you take this loan", "kyc_required");
  const setup = readySetup(deps.config);
  if (deps.config.params.writeOffGraceSeconds > deps.config.params.overdueWindowSeconds) {
    throw conflict("the grace period is longer than the loan term, which the ledger refuses", "terms");
  }

  const params = paramsAsBigInt(deps.config);
  const principal = principalUnits(BigInt(claim.approvedAmount), deps.config.params.advanceRateBps);
  if (principal <= 0n) throw conflict("this approval is for nothing", "zero");
  if (principal > params.perClaimCap) throw conflict("this is above the largest loan", "over_cap");
  const open = await deps.db.listClaimsByStatus(["Funded", "GuarantorCalled", "WrittenOff"]);
  const used = open.filter((other) => other.orgId === claim.orgId).reduce((sum, other) => sum + BigInt(other.purchasePrice), 0n);
  if (used + principal > params.perOrgCap) throw conflict("this business is at its loan limit", "over_org_cap");

  const snapshot = await vaultSnapshot(deps.ledger, deps.config, Math.floor(now.getTime() / 1000));
  if (snapshot.phase === "subscription") throw conflict("loans start once the deposit window closes", "vault_phase");
  if (snapshot.phase === "closed") throw conflict("a loan of this length would end after the vault's redemption date", "vault_phase");

  const key = `fund:${claim.id}`;
  if (!(await deps.db.claimOnce(key))) throw conflict("this loan is already being created", "in_progress");
  let sent = false;
  try {
    const seed = signingSeed(deps.env, "BROKER_SEED");
    await ensureAccess({ ledger: deps.ledger, custody: deps.custody, config: deps.config, brokerSeed: seed, holder: claim.recipientWallet });
    const borrower = await deps.custody.signer(claim.recipientWallet);
    const broker = brokerWallet(deps.config, seed);
    const tx: LoanSet = {
      TransactionType: "LoanSet",
      Account: borrower.classicAddress,
      Counterparty: broker.classicAddress,
      LoanBrokerID: setup.loanBrokerId,
      PrincipalRequested: issuedAmount(deps.config, principal).value,
      InterestRate: interestRateTenths(claim.feeBps),
      LateInterestRate: 0,
      CloseInterestRate: 0,
      OverpaymentInterestRate: 0,
      PaymentTotal: 1,
      PaymentInterval: deps.config.params.overdueWindowSeconds,
      GracePeriod: deps.config.params.writeOffGraceSeconds,
    };
    const submitted = await deps.ledger.submitCoSigned(borrower, broker, tx, { purpose: "fund_loan", claimId: claim.id });
    sent = true;
    const loanId = loanIndex(submitted.createdId);
    const entry = await deps.ledger.readEntry(loanId);
    const formula = amountDue(principal, BigInt(claim.feeBps), deps.config.params.overdueWindowSeconds);
    const priced = paymentDueUnits(entry);
    const due = priced !== null && priced > formula ? priced : formula;
    const dueAt = dueAtFromLoan(entry, new Date(now.getTime() + deps.config.params.overdueWindowSeconds * 1000));
    const moved = await deps.db.transitionClaim(claim.id, ["Approved"], {
      status: "Funded",
      purchasePrice: principal.toString(),
      amountDue: due.toString(),
      amountPaid: "0",
      purchasedAt: now.toISOString(),
      dueAt,
      loanId,
    });
    if (!moved) throw conflict("this changed since the page loaded", "invalid_state");
    return json({ claim: claimView(moved) });
  } catch (error) {
    if (!sent) await deps.db.releaseOnce(key);
    rethrowLedger(error);
  }
}

async function pay(deps: LoansDeps, claimId: string, now: Date): Promise<Response> {
  const claim = await loadClaim(deps.db, claimId);
  if (!PAYABLE.includes(claim.status)) throw conflict("this loan isn't waiting on a payment", "invalid_state");
  if (!claim.loanId) throw conflict("this loan isn't on the ledger", "no_loan");
  const remaining = amountRemaining(claim);
  if (remaining <= 0n) throw conflict("this loan is already paid", "paid");

  const key = `pay:${claim.id}`;
  if (!(await deps.db.claimOnce(key))) throw conflict("this payment is already being sent", "in_progress");
  let sent = false;
  try {
    const borrower = await deps.custody.signer(claim.recipientWallet);
    const late = claim.dueAt !== null && Date.parse(claim.dueAt) < now.getTime();
    const tx: LoanPay = {
      TransactionType: "LoanPay",
      Account: borrower.classicAddress,
      LoanID: claim.loanId,
      Amount: issuedAmount(deps.config, remaining),
      ...(late ? { Flags: LoanPayFlags.tfLoanLatePayment } : {}),
    };
    await deps.ledger.submit(borrower, tx, { purpose: "pay_loan", claimId: claim.id });
    sent = true;
    const patch = { status: "Settled" as const, amountPaid: claim.amountDue };
    const moved =
      (await deps.db.transitionClaim(claim.id, PAYABLE, patch)) ?? (await deps.db.updateClaim(claim.id, patch));
    return json({ claim: claimView(moved) });
  } catch (error) {
    if (!sent) await deps.db.releaseOnce(key);
    rethrowLedger(error);
  }
}

function loanIndex(id: string | null): string {
  const upper = (id ?? "").toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(upper)) throw conflict("the ledger didn't return the loan", "no_loan");
  return upper;
}
