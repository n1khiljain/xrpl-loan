import type { VerificationStore } from "@app/adapters";
import type { Db, Profile, Wallet } from "./db/types.ts";
import { forbidden } from "./http.ts";

/** Backs the mock FraxNetClient's liquidation addresses with the profile table (U-37). */
// UNCERTAIN: U-37
export function profileLiquidationStore(db: Db): VerificationStore {
  return {
    async getLiquidationAddress(wallet) {
      const profile = await db.getProfile(wallet.toLowerCase() as Wallet);
      return profile?.liquidationAddress ?? null;
    },
  };
}

/**
 * Members must be verified on FraxNet before they sell a claim, and officers before they sign off on one (U-24,
 * U-77). Underwriters can still set a status by hand as a fallback (U-36).
 */
export function requireKycApproved(profile: Profile, role: "member" | "officer"): void {
  if (profile.kycStatus === "approved") return;
  throw forbidden(
    role === "member"
      ? "Connect FraxNet and finish verifying before you ask for a reimbursement."
      : "Connect FraxNet and finish verifying before you sign off.",
    "kyc_required",
  );
}
