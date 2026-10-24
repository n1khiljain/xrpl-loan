import { claimRegistryAbi, mockFrxUsdAbi, orgRegistryAbi, receivablesPoolAbi } from "@app/abi";
import { type Abi, BaseError, ContractFunctionRevertedError, type Hex, UserRejectedRequestError, decodeErrorResult } from "viem";
import { ApiError } from "./api";

const ERRORS_ABI = [...claimRegistryAbi, ...receivablesPoolAbi, ...orgRegistryAbi, ...mockFrxUsdAbi].filter(
  (item) => item.type === "error",
) as Abi;

/** The custom error name inside a raw revert, if our contracts define it. */
export function revertName(error: unknown): string | null {
  if (!(error instanceof BaseError)) return null;
  const found = error.walk((e) => typeof (e as { data?: unknown }).data === "string" && ((e as { data: string }).data.startsWith("0x")));
  const data = (found as { data?: Hex } | null)?.data;
  if (!data || data.length < 10) return null;
  try {
    return decodeErrorResult({ abi: ERRORS_ABI, data }).errorName;
  } catch {
    return null;
  }
}

/** What each contract error means to the person who hit it, and what to do next. */
const CONTRACT_ERRORS: Record<string, string> = {
  InvalidState: "This changed since the page loaded. Refresh to see where it is now.",
  NotRecipient: "Only the person who asked for this reimbursement can do that.",
  OrgInactive: "This org isn't active right now, so it can't take new reimbursements.",
  NotOfficer: "That officer isn't active in this org anymore. Pick another officer.",
  GuarantorIsRecipient: "The officer who signs off has to be someone other than you.",
  InvalidGuaranty: "The officer's sign-off doesn't match this. Ask them to sign off again.",
  GuarantyExpired: "The officer's sign-off expired. Ask them to sign off again.",
  AmountExceedsLimit: "That amount is over the limit for one reimbursement.",
  ApprovalExpired: "The approval expired. Send it for review again.",
  OrgCapExceeded: "Your org has reached its limit for now. Try again after others are closed out.",
  InsufficientIdleCash: "Frax doesn't have enough set aside for this right now. Try again later.",
  NotOverdue: "This isn't overdue yet.",
  WriteOffTooEarly: "The grace period hasn't ended yet.",
  PacketAlreadyUsed: "These receipts were already used for another reimbursement.",
  ZeroAmount: "Enter an amount above zero.",
  LenderNotAllowed: "This wallet isn't on the lender allowlist yet.",
  DepositCapExceeded: "That deposit would go over the pool's deposit cap.",
  DepositsPaused: "Deposits are paused right now.",
  EnforcedPause: "The app is paused for maintenance. Settling still works.",
  ERC4626ExceededMaxWithdraw: "That's more than the pool can pay out right now.",
  ERC20InsufficientBalance: "Your wallet doesn't hold enough for that.",
  AccessControlUnauthorizedAccount: "This wallet doesn't have the role for that action.",
};

export function friendlyError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) return "You cancelled in your wallet. Nothing was sent.";
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    const name = (revert instanceof ContractFunctionRevertedError ? revert.data?.errorName : null) ?? revertName(error);
    if (name && CONTRACT_ERRORS[name]) return CONTRACT_ERRORS[name];
    if (revert || name) return "The transaction was refused. Refresh and try again.";
    if (/insufficient funds/i.test(error.message)) return "We couldn't send this yet. Wait a minute and try again.";
    return "That didn't go through. Try again.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "That didn't work. Try again.";
}

export { CONTRACT_ERRORS };
