// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Shared enums, structs, and errors for the claim registry, pool, NFT, and org registry.
// Events live on each contract's interface in ../interfaces.

/// @notice Lifecycle state of a claim. See PRD section 7 for the transition table.
enum ClaimState {
    None,
    Submitted,
    Approved,
    Funded,
    GuarantorCalled,
    Settled,
    Recovered,
    WrittenOff,
    Rejected,
    Cancelled
}

// UNCERTAIN: U-11
/// @notice Who fronted the money on the CalLink purchase request.
enum RecipientType {
    Member,
    OrgTreasurer
}

/// @notice Why the attester called the guarantor.
enum CallReason {
    None,
    AsucRejected,
    PartialShortfall,
    Overdue
}

/// @notice Everything the registry stores about one claim (FR-C8). Amounts are frxUSD with 18 decimals.
struct Claim {
    // claim ID, equal to the claim NFT token ID
    uint256 id;
    // wallet that submitted the claim and gets paid
    address recipient;
    uint64 orgId;
    RecipientType recipientType;
    ClaimState state;
    CallReason callReason;
    // set by writeOff; later payments go straight to pool assets
    bool principalWrittenOff;
    address guarantor;
    // annual fee rate snapshot taken at purchase, in basis points of unpaid principal per year
    // UNCERTAIN: U-84
    uint16 feeBps;
    uint40 submittedAt;
    uint40 approvalExpiresAt;
    // amount on the CalLink purchase request
    uint128 faceValue;
    uint128 requestedAmount;
    uint128 approvedAmount;
    // equals approvedAmount at purchase
    uint128 purchasePrice;
    // purchasePrice plus the fee accrued through feeAccruedAt, each accrual rounded up
    uint128 amountDue;
    uint128 amountPaid;
    uint128 writtenOffPrincipal;
    uint40 purchasedAt;
    uint40 dueAt;
    uint40 guarantorCalledAt;
    uint40 writeOffEligibleAt;
    // last time the fee was added to amountDue; accrual stops once principal is paid or written off
    uint40 feeAccruedAt;
    // keccak256 of the offchain claim packet; the only claim data that goes onchain
    // UNCERTAIN: U-20
    bytes32 packetHash;
}

// UNCERTAIN: U-12
/// @notice Admin-settable product terms (PRD section 6). Changes apply to later approvals and purchases.
struct Params {
    // max share of face value the pool pays, at most 10_000
    uint16 advanceRateBps;
    // annual fee rate on unpaid principal, accrued every second from purchase, at most 10_000
    // UNCERTAIN: U-08, U-84
    uint16 feeBps;
    // max purchase price for one claim
    uint128 perClaimCap;
    // max outstanding principal across one org's claims
    uint128 perOrgCap;
    // seconds after purchase before a claim can be called overdue
    // UNCERTAIN: U-14
    uint32 overdueWindow;
    // seconds an approval stays valid
    // UNCERTAIN: U-28
    uint32 approvalExpiry;
    // seconds after the guarantor is called before a write-off is allowed
    // UNCERTAIN: U-30
    uint32 writeOffGrace;
}

/// @notice Claimant input to `submitClaim`. The recipient is always `msg.sender`.
struct SubmitClaimParams {
    uint64 orgId;
    RecipientType recipientType;
    address guarantor;
    uint128 faceValue;
    uint128 requestedAmount;
    bytes32 packetHash;
}

/// @notice The claim is not in a state that allows this call.
/// @param claimId The claim.
/// @param current The claim's current state.
error InvalidState(uint256 claimId, ClaimState current);

/// @notice Only the claim's recipient can make this call.
error NotRecipient();

/// @notice The org does not exist or is deactivated.
/// @param orgId The org.
error OrgInactive(uint64 orgId);

/// @notice The account is not an active officer of the org.
/// @param orgId The org.
/// @param account The account that had to be an officer.
error NotOfficer(uint64 orgId, address account);

/// @notice The guarantor and the recipient are the same wallet.
error GuarantorIsRecipient();

/// @notice The guaranty signature does not match the guarantor and the claim terms.
error InvalidGuaranty();

/// @notice The guaranty deadline has passed.
error GuarantyExpired();

/// @notice An amount is above the limit that applies to it.
/// @param amount The amount that was asked for.
/// @param limit The limit it exceeded.
error AmountExceedsLimit(uint256 amount, uint256 limit);

/// @notice The approval expired before the claimant purchased.
error ApprovalExpired();

/// @notice The purchase would push the org's outstanding principal past its cap (`orgCap`).
/// @param orgId The org.
/// @param outstanding The org's outstanding principal if the purchase went through.
/// @param cap The org's current cap.
error OrgCapExceeded(uint64 orgId, uint256 outstanding, uint256 cap);

/// @notice The pool does not hold enough idle frxUSD.
/// @param needed The amount required.
/// @param available The pool's idle cash.
error InsufficientIdleCash(uint256 needed, uint256 available);

/// @notice The claim has not reached its due date.
error NotOverdue();

/// @notice The write-off grace period has not ended.
error WriteOffTooEarly();

/// @notice The packet hash was already used by another claim.
/// @param packetHash The packet hash.
error PacketAlreadyUsed(bytes32 packetHash);

/// @notice The packet hash is zero.
error ZeroPacketHash();

/// @notice The amount is zero.
error ZeroAmount();

/// @notice An address argument is the zero address.
error ZeroAddress();

/// @notice A parameter is out of range.
error InvalidParams();

/// @notice The call reason is `None`.
error InvalidCallReason();

/// @notice The reject reason code is empty.
error MissingReasonCode();

/// @notice Only the claim registry can make this call.
error OnlyRegistry();

/// @notice The registry address was already set and cannot change.
error RegistryAlreadySet();

/// @notice The registry is not wired to this contract.
/// @param registry The address that was passed.
error InvalidRegistry(address registry);

/// @notice The lender allowlist is on and this address is not on it.
/// @param account The address that is not allowed.
error LenderNotAllowed(address account);

/// @notice The deposit would push total pool assets past the deposit cap.
error DepositCapExceeded();

/// @notice Deposits are paused while the claim registry is paused.
error DepositsPaused();

/// @notice Emergency mode permanently disables this operation.
error EmergencyModeActive();

/// @notice Emergency withdrawals require the admin to activate emergency mode first.
error EmergencyModeInactive();

/// @notice An emergency withdrawal cannot send cash back to the pool itself.
error InvalidEmergencyReceiver();

/// @notice Claim NFTs cannot be transferred.
error TransfersDisabled();

/// @notice The org ID does not exist.
/// @param orgId The org ID.
error OrgNotFound(uint64 orgId);

/// @notice The org name is empty.
error EmptyOrgName();
