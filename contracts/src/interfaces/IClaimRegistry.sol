// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Claim, Params, SubmitClaimParams, RecipientType, CallReason} from "../libraries/ClaimTypes.sol";
import {IReceivablesPool} from "./IReceivablesPool.sol";
import {IClaimNFT} from "./IClaimNFT.sol";
import {IOrgRegistry} from "./IOrgRegistry.sol";

/// @title IClaimRegistry
/// @notice The claim state machine from PRD section 7 (FR-C6). The events below are enough to rebuild every
/// claim from logs alone (FR-C16).
interface IClaimRegistry {
    /// @notice Emitted when a claimant submits a claim with a guaranty.
    /// @param claimId The new claim ID. IDs start at 1.
    /// @param orgId The org.
    /// @param recipient The claimant, who gets paid.
    /// @param guarantor The officer who signed the guaranty.
    /// @param recipientType Member or org treasurer.
    /// @param faceValue The amount on the CalLink purchase request.
    /// @param requestedAmount The amount the claimant asked the pool to pay.
    /// @param packetHash Hash of the offchain claim packet.
    event ClaimSubmitted(
        uint256 indexed claimId,
        uint64 indexed orgId,
        address indexed recipient,
        address guarantor,
        RecipientType recipientType,
        uint128 faceValue,
        uint128 requestedAmount,
        bytes32 packetHash
    );

    /// @notice Emitted when the claimant cancels a submitted claim.
    /// @param claimId The claim.
    event ClaimCancelled(uint256 indexed claimId);

    /// @notice Emitted when the underwriter approves or re-approves a claim.
    /// @param claimId The claim.
    /// @param amount The approved purchase price.
    /// @param approvalExpiresAt The time the approval stops being purchasable.
    event ClaimApproved(uint256 indexed claimId, uint128 amount, uint40 approvalExpiresAt);

    /// @notice Emitted when the underwriter rejects a claim.
    /// @param claimId The claim.
    /// @param reasonCode A code from the admin app's fixed list, such as `MISSING_RECEIPTS`.
    event ClaimRejected(uint256 indexed claimId, bytes32 reasonCode);

    /// @notice Emitted when the pool buys a claim and pays the claimant.
    /// @param claimId The claim.
    /// @param recipient The claimant.
    /// @param purchasePrice The frxUSD sent to the claimant.
    /// @param amountDue The amount due at purchase, the purchase price; the fee is added as it accrues.
    /// @param feeBps The annual fee rate snapshot, in basis points of unpaid principal per year (U-84).
    /// @param dueAt The time after which the claim can be called overdue.
    event ClaimPurchased(
        uint256 indexed claimId,
        address indexed recipient,
        uint128 purchasePrice,
        uint128 amountDue,
        uint16 feeBps,
        uint40 dueAt
    );

    /// @notice Emitted when fee accrued since the last payment, guarantor call, or write-off is added to the amount
    /// due (U-84).
    /// @param claimId The claim.
    /// @param fee The fee added.
    /// @param amountDue The new amount due.
    event FeeAccrued(uint256 indexed claimId, uint256 fee, uint128 amountDue);

    /// @notice Emitted for every settlement payment, partial or full.
    /// @param claimId The claim.
    /// @param payer The wallet that paid.
    /// @param paid The frxUSD taken from the payer.
    /// @param principalPortion The part of `paid` that went to principal.
    /// @param amountRemaining The amount still due after this payment.
    event ClaimSettlementPaid(
        uint256 indexed claimId, address indexed payer, uint256 paid, uint256 principalPortion, uint256 amountRemaining
    );

    /// @notice Emitted when a `Funded` claim is paid in full.
    /// @param claimId The claim.
    event ClaimSettled(uint256 indexed claimId);

    /// @notice Emitted when the attester calls the guarantor.
    /// @param claimId The claim.
    /// @param guarantor The guarantor who now owes the remainder.
    /// @param reason Why the guarantor was called.
    /// @param amountRemaining The amount still due.
    /// @param writeOffEligibleAt The earliest time the attester can write the claim off.
    event GuarantorCalled(
        uint256 indexed claimId,
        address indexed guarantor,
        CallReason reason,
        uint256 amountRemaining,
        uint40 writeOffEligibleAt
    );

    /// @notice Emitted when a `GuarantorCalled` or `WrittenOff` claim is paid in full.
    /// @param claimId The claim.
    event ClaimRecovered(uint256 indexed claimId);

    /// @notice Emitted when the attester writes a claim off.
    /// @param claimId The claim.
    /// @param principalLost The unpaid principal booked as a pool loss.
    event ClaimWrittenOff(uint256 indexed claimId, uint256 principalLost);

    /// @notice Emitted at construction and on every `setParams` call.
    /// @param oldParams The previous terms (all zero at construction).
    /// @param newParams The new terms.
    event ParamsUpdated(Params oldParams, Params newParams);

    /// @notice Emitted when the admin sets or clears an org's own cap.
    /// @param orgId The org.
    /// @param oldCap The previous override, 0 if the org was on `perOrgCap`.
    /// @param newCap The new override, 0 to put the org back on `perOrgCap`.
    event OrgCapSet(uint64 indexed orgId, uint128 oldCap, uint128 newCap);

    /// @notice Submits a claim with the guarantor's EIP-712 guaranty (FR-C7). The caller is the recipient.
    /// @dev Consumes the guarantor's current nonce. Reverts while paused.
    /// @param p The claim terms.
    /// @param deadline The guaranty's deadline, as signed.
    /// @param guarantySig The guarantor's signature over the `Guaranty` struct.
    /// @return claimId The new claim ID.
    function submitClaim(SubmitClaimParams calldata p, uint256 deadline, bytes calldata guarantySig)
        external
        returns (uint256 claimId);

    /// @notice Cancels a `Submitted` claim.
    /// @dev Recipient only.
    /// @param claimId The claim.
    function cancelClaim(uint256 claimId) external;

    /// @notice Sells an `Approved` claim to the pool. Mints the claim NFT to the pool and pays the recipient.
    /// @dev Recipient only. Reverts while paused, after the approval expires, when the org is inactive, when the
    /// org would pass its cap (`orgCap`), or when the pool lacks idle cash.
    /// @param claimId The claim.
    function purchaseClaim(uint256 claimId) external;

    /// @notice Pays toward a purchased claim. Anyone can pay, and payments stay open while paused.
    /// @dev Adds the fee accrued so far, then pulls `min(amount, amountRemaining)` from the caller with
    /// `transferFrom`, principal first, then the fee. Approve a little more than `amountRemaining` to close a claim:
    /// the fee keeps accruing until the payment lands.
    /// The caller must approve this contract for frxUSD.
    /// @param claimId The claim.
    /// @param amount The most the caller wants to pay.
    /// @return paid The amount actually taken.
    function settle(uint256 claimId, uint256 amount) external returns (uint256 paid);

    /// @notice Approves a `Submitted` claim, or re-approves an `Approved` one, which resets the expiry.
    /// @dev Underwriter only. Reverts while paused. KYC is checked offchain before approving (U-24).
    /// @param claimId The claim.
    /// @param amount The purchase price, at most the requested amount and `perClaimCap`.
    function approveClaim(uint256 claimId, uint128 amount) external;

    /// @notice Rejects a `Submitted` or `Approved` claim.
    /// @dev Underwriter only.
    /// @param claimId The claim.
    /// @param reasonCode A nonzero code from the admin app's fixed list.
    function rejectClaim(uint256 claimId, bytes32 reasonCode) external;

    /// @notice Moves a `Funded` claim to `GuarantorCalled`.
    /// @dev Attester only. `AsucRejected` and `PartialShortfall` work at any time; `Overdue` only once `dueAt` passes.
    /// @param claimId The claim.
    /// @param reason Why the guarantor is being called.
    function callGuarantor(uint256 claimId, CallReason reason) external;

    /// @notice Writes off a `GuarantorCalled` claim after the grace period, booking unpaid principal as a loss.
    /// @dev Attester only. The claim still accepts payments and moves to `Recovered` once paid in full.
    /// @param claimId The claim.
    function writeOff(uint256 claimId) external;

    /// @notice Replaces the product terms. Purchased claims keep the terms they were purchased under.
    /// @dev Admin only. Rates at most 10_000 bps, caps and windows above zero.
    /// @param newParams The new terms.
    function setParams(Params calldata newParams) external;

    /// @notice Gives one org its own outstanding-principal cap in place of `perOrgCap`.
    /// @dev Admin only. Reverts with `OrgNotFound` for an unknown org. A cap of 0 clears the override. Lowering a
    /// cap below the org's outstanding principal only blocks new purchases; claims already funded are untouched.
    /// @param orgId The org.
    /// @param cap The new cap in frxUSD (18 decimals), or 0 to use `perOrgCap`.
    function setOrgCap(uint64 orgId, uint128 cap) external;

    /// @notice Pauses submit, approve, purchase, and pool deposits. Settle and withdraw stay open.
    /// @dev Pauser only.
    function pause() external;

    /// @notice Lifts the pause.
    /// @dev Admin only.
    function unpause() external;

    /// @notice Whether the registry, and so pool deposits, are paused.
    /// @return True if paused.
    function paused() external view returns (bool);

    /// @notice Full stored record of a claim. Returns an empty record for an unknown ID.
    /// @param claimId The claim.
    /// @return The claim.
    function getClaim(uint256 claimId) external view returns (Claim memory);

    /// @notice Number of claims submitted so far. Claim IDs run from 1 to this value.
    /// @return The count.
    function claimCount() external view returns (uint256);

    /// @notice The current product terms.
    /// @return The terms.
    function params() external view returns (Params memory);

    /// @notice Unpaid principal across the org's `Funded` and `GuarantorCalled` claims.
    /// @param orgId The org.
    /// @return The outstanding principal.
    function orgOutstanding(uint64 orgId) external view returns (uint256);

    /// @notice The cap checked at purchase for this org: its override if one is set, otherwise `perOrgCap`.
    /// @param orgId The org.
    /// @return The effective cap.
    function orgCap(uint64 orgId) external view returns (uint128);

    /// @notice The org's own cap as set by `setOrgCap`, or 0 when it uses `perOrgCap`.
    /// @param orgId The org.
    /// @return The override.
    function orgCapOverride(uint64 orgId) external view returns (uint128);

    /// @notice Amount still due on a claim right now, including fee accrued up to this block. Zero before purchase
    /// and after full payment.
    /// @param claimId The claim.
    /// @return The remaining amount due.
    function amountRemaining(uint256 claimId) external view returns (uint256);

    /// @notice Whether a `Funded` claim is past its due date, so the attester can call it `Overdue`.
    /// @param claimId The claim.
    /// @return True if overdue.
    function isOverdue(uint256 claimId) external view returns (bool);

    /// @notice Whether an `Approved` claim's approval has expired.
    /// @param claimId The claim.
    /// @return True if expired.
    function isApprovalExpired(uint256 claimId) external view returns (bool);

    /// @notice Whether a packet hash has been used by a submitted claim.
    /// @param packetHash The packet hash.
    /// @return True if used.
    function isPacketUsed(bytes32 packetHash) external view returns (bool);

    /// @notice The EIP-712 digest a guarantor signs for these claim terms.
    /// @param guarantor The officer signing.
    /// @param recipient The claimant.
    /// @param orgId The org.
    /// @param faceValue The amount on the purchase request.
    /// @param requestedAmount The amount requested from the pool.
    /// @param packetHash Hash of the offchain claim packet.
    /// @param nonce The guarantor's nonce, from `nonces(guarantor)`.
    /// @param deadline The last timestamp at which the guaranty can be used.
    /// @return The digest.
    function guarantyDigest(
        address guarantor,
        address recipient,
        uint64 orgId,
        uint128 faceValue,
        uint128 requestedAmount,
        bytes32 packetHash,
        uint256 nonce,
        uint256 deadline
    ) external view returns (bytes32);

    /// @notice The EIP-712 domain separator for guaranties.
    /// @return The domain separator.
    function domainSeparator() external view returns (bytes32);

    /// @notice The next guaranty nonce for an account.
    /// @param owner The guarantor.
    /// @return The nonce.
    function nonces(address owner) external view returns (uint256);

    /// @notice The pool that buys claims.
    /// @return The pool.
    function pool() external view returns (IReceivablesPool);

    /// @notice The claim NFT contract.
    /// @return The NFT contract.
    function nft() external view returns (IClaimNFT);

    /// @notice The org registry.
    /// @return The org registry.
    function orgs() external view returns (IOrgRegistry);
}
