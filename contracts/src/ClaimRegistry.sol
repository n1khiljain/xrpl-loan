// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IClaimRegistry} from "./interfaces/IClaimRegistry.sol";
import {IReceivablesPool} from "./interfaces/IReceivablesPool.sol";
import {IClaimNFT} from "./interfaces/IClaimNFT.sol";
import {IOrgRegistry} from "./interfaces/IOrgRegistry.sol";
import {
    Claim,
    ClaimState,
    RecipientType,
    CallReason,
    Params,
    SubmitClaimParams,
    InvalidState,
    NotRecipient,
    OrgInactive,
    NotOfficer,
    GuarantorIsRecipient,
    InvalidGuaranty,
    GuarantyExpired,
    AmountExceedsLimit,
    ApprovalExpired,
    OrgCapExceeded,
    InsufficientIdleCash,
    NotOverdue,
    WriteOffTooEarly,
    PacketAlreadyUsed,
    ZeroPacketHash,
    ZeroAmount,
    ZeroAddress,
    InvalidParams,
    OrgNotFound,
    InvalidCallReason,
    MissingReasonCode
} from "./libraries/ClaimTypes.sol";

/// @title ClaimRegistry
/// @notice The claim lifecycle from PRD section 7 (FR-C6). Claimants submit claims backed by an officer's EIP-712
/// guaranty, the underwriter approves or rejects, the claimant sells the approved claim to the pool, and anyone
/// settles it. The attester calls the guarantor and writes off losses.
/// @dev Not upgradeable (U-03). Uses purchase language throughout (U-09).
contract ClaimRegistry is IClaimRegistry, AccessControl, Pausable, ReentrancyGuard, EIP712, Nonces {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    /// @notice Role that approves and rejects claims.
    // UNCERTAIN: U-13
    bytes32 public constant UNDERWRITER_ROLE = keccak256("UNDERWRITER_ROLE");
    /// @notice Role that calls guarantors and writes off claims.
    bytes32 public constant ATTESTER_ROLE = keccak256("ATTESTER_ROLE");
    /// @notice Role that can pause. Only the admin can unpause.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    /// @notice EIP-712 type hash of the guaranty an officer signs (FR-C7).
    bytes32 public constant GUARANTY_TYPEHASH = keccak256(
        "Guaranty(address guarantor,address recipient,uint64 orgId,uint128 faceValue,uint128 requestedAmount,bytes32 packetHash,uint256 nonce,uint256 deadline)"
    );

    uint256 private constant BPS = 10_000;
    /// @dev the fee rate is per 365-day year
    uint256 private constant FEE_YEAR = 365 days;

    /// @notice The frxUSD token, read from the pool's ERC-4626 asset.
    IERC20 public immutable frxUSD;
    /// @inheritdoc IClaimRegistry
    IReceivablesPool public immutable pool;
    /// @inheritdoc IClaimRegistry
    IClaimNFT public immutable nft;
    /// @inheritdoc IClaimRegistry
    IOrgRegistry public immutable orgs;

    Params private _params;
    uint256 private _claimCount;
    mapping(uint256 claimId => Claim) private _claims;
    mapping(uint64 orgId => uint256) private _orgOutstanding;
    mapping(bytes32 packetHash => bool) private _packetUsed;
    mapping(uint64 orgId => uint128) private _orgCapOverride;

    /// @notice Deploys the registry. The pool and NFT must then be wired to it with their one-time `setRegistry`.
    /// @param admin The initial admin, holding `DEFAULT_ADMIN_ROLE` only.
    /// @param pool_ The receivables pool.
    /// @param nft_ The claim NFT contract.
    /// @param orgs_ The org registry.
    /// @param initialParams The starting product terms.
    constructor(
        address admin,
        IReceivablesPool pool_,
        IClaimNFT nft_,
        IOrgRegistry orgs_,
        Params memory initialParams
    ) EIP712("FraxCollegeClaimRegistry", "1") {
        if (
            admin == address(0) || address(pool_) == address(0) || address(nft_) == address(0)
                || address(orgs_) == address(0)
        ) revert ZeroAddress();
        pool = pool_;
        nft = nft_;
        orgs = orgs_;
        frxUSD = IERC20(IERC4626(address(pool_)).asset());
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _setParams(initialParams);
    }

    // ---------------------------------------------------------------- claimant

    /// @inheritdoc IClaimRegistry
    function submitClaim(SubmitClaimParams calldata p, uint256 deadline, bytes calldata guarantySig)
        external
        whenNotPaused
        returns (uint256 claimId)
    {
        _checkSubmission(p);
        if (block.timestamp > deadline) revert GuarantyExpired();
        bytes32 digest = _guarantyDigest(
            p.guarantor,
            msg.sender,
            p.orgId,
            p.faceValue,
            p.requestedAmount,
            p.packetHash,
            _useNonce(p.guarantor),
            deadline
        );
        // UNCERTAIN: U-10 (ERC-1271 smart wallets work through SignatureChecker)
        if (!SignatureChecker.isValidSignatureNow(p.guarantor, digest, guarantySig)) revert InvalidGuaranty();
        claimId = _storeClaim(p);
        // every call above is a view or an internal library call, so nothing can reenter before this event
        // forge-lint: disable-start(reentrancy-events)
        emit ClaimSubmitted(
            claimId,
            p.orgId,
            msg.sender,
            p.guarantor,
            p.recipientType,
            p.faceValue,
            p.requestedAmount,
            p.packetHash
        );
        // forge-lint: disable-end(reentrancy-events)
    }

    /// @inheritdoc IClaimRegistry
    function cancelClaim(uint256 claimId) external {
        Claim storage c = _claims[claimId];
        if (c.state != ClaimState.Submitted) revert InvalidState(claimId, c.state);
        if (c.recipient != msg.sender) revert NotRecipient();
        c.state = ClaimState.Cancelled;
        emit ClaimCancelled(claimId);
    }

    /// @inheritdoc IClaimRegistry
    function purchaseClaim(uint256 claimId) external nonReentrant whenNotPaused {
        Claim storage c = _claims[claimId];
        uint128 price = _checkPurchase(claimId, c);
        _recordPurchase(claimId, c, price);
        // all state is written before these calls to our own NFT and pool; the guard is the OZ modifier itself
        // forge-lint: disable-next-line(reentrancy-no-eth)
        nft.mint(address(pool), claimId);
        // forge-lint: disable-next-line(reentrancy-no-eth)
        pool.fundPurchase(msg.sender, price);
    }

    // ---------------------------------------------------------------- anyone

    /// @inheritdoc IClaimRegistry
    // UNCERTAIN: U-26 (settle stays open while paused)
    function settle(uint256 claimId, uint256 amount) external nonReentrant returns (uint256 paid) {
        Claim storage c = _claims[claimId];
        ClaimState state = c.state;
        if (state != ClaimState.Funded && state != ClaimState.GuarantorCalled && state != ClaimState.WrittenOff) {
            revert InvalidState(claimId, state);
        }
        _accrueFee(claimId, c);
        uint256 remaining = c.amountDue - c.amountPaid;
        paid = Math.min(amount, remaining);
        if (paid == 0) revert ZeroAmount();
        remaining -= paid;

        uint256 principalPortion = Math.min(paid, c.purchasePrice - _principalPaid(c));
        // after a write-off the principal is already off the books, so the whole payment lands as new pool assets
        bool bookPrincipal = !c.principalWrittenOff && principalPortion > 0;
        c.amountPaid += paid.toUint128();
        if (bookPrincipal) _orgOutstanding[c.orgId] -= principalPortion;

        // no external call has happened yet in this function; the lint reads SafeCast and Math as external calls
        // forge-lint: disable-next-line(reentrancy-events)
        emit ClaimSettlementPaid(claimId, msg.sender, paid, principalPortion, remaining);
        if (remaining == 0) {
            if (state == ClaimState.Funded) {
                c.state = ClaimState.Settled;
                // forge-lint: disable-next-line(reentrancy-events)
                emit ClaimSettled(claimId);
            } else {
                c.state = ClaimState.Recovered;
                // forge-lint: disable-next-line(reentrancy-events)
                emit ClaimRecovered(claimId);
            }
        }

        // effects are done; the pool is our own contract and frxUSD is a plain ERC-20 (U-31)
        // forge-lint: disable-next-line(reentrancy-no-eth)
        if (bookPrincipal) pool.recordPrincipalReturned(principalPortion);
        frxUSD.safeTransferFrom(msg.sender, address(pool), paid);
    }

    // ---------------------------------------------------------------- underwriter

    /// @inheritdoc IClaimRegistry
    // UNCERTAIN: U-24 (KYC is checked offchain before this call)
    function approveClaim(uint256 claimId, uint128 amount) external onlyRole(UNDERWRITER_ROLE) whenNotPaused {
        Claim storage c = _claims[claimId];
        ClaimState state = c.state;
        if (state != ClaimState.Submitted && state != ClaimState.Approved) revert InvalidState(claimId, state);
        if (amount == 0) revert ZeroAmount();
        if (amount > c.requestedAmount) revert AmountExceedsLimit(amount, c.requestedAmount);
        uint128 cap = _params.perClaimCap;
        if (amount > cap) revert AmountExceedsLimit(amount, cap);

        uint40 expiresAt = (block.timestamp + _params.approvalExpiry).toUint40();
        c.approvedAmount = amount;
        c.approvalExpiresAt = expiresAt;
        c.state = ClaimState.Approved;
        emit ClaimApproved(claimId, amount, expiresAt);
    }

    /// @inheritdoc IClaimRegistry
    function rejectClaim(uint256 claimId, bytes32 reasonCode) external onlyRole(UNDERWRITER_ROLE) {
        Claim storage c = _claims[claimId];
        ClaimState state = c.state;
        if (state != ClaimState.Submitted && state != ClaimState.Approved) revert InvalidState(claimId, state);
        // UNCERTAIN: U-48 (the fixed list of codes is enforced by the admin app, not here)
        if (reasonCode == bytes32(0)) revert MissingReasonCode();
        c.state = ClaimState.Rejected;
        emit ClaimRejected(claimId, reasonCode);
    }

    // ---------------------------------------------------------------- attester

    /// @inheritdoc IClaimRegistry
    function callGuarantor(uint256 claimId, CallReason reason) external onlyRole(ATTESTER_ROLE) {
        Claim storage c = _claims[claimId];
        if (c.state != ClaimState.Funded) revert InvalidState(claimId, c.state);
        if (reason == CallReason.None) revert InvalidCallReason();
        // UNCERTAIN: U-29 (AsucRejected and PartialShortfall can be called at any time)
        if (reason == CallReason.Overdue && block.timestamp < c.dueAt) revert NotOverdue();
        _accrueFee(claimId, c);

        uint40 eligibleAt = (block.timestamp + _params.writeOffGrace).toUint40();
        c.callReason = reason;
        c.guarantorCalledAt = block.timestamp.toUint40();
        c.writeOffEligibleAt = eligibleAt;
        c.state = ClaimState.GuarantorCalled;
        // no external call precedes this event; the lint reads SafeCast as an external call
        // forge-lint: disable-next-line(reentrancy-events)
        emit GuarantorCalled(claimId, c.guarantor, reason, c.amountDue - c.amountPaid, eligibleAt);
    }

    /// @inheritdoc IClaimRegistry
    function writeOff(uint256 claimId) external onlyRole(ATTESTER_ROLE) {
        Claim storage c = _claims[claimId];
        if (c.state != ClaimState.GuarantorCalled) revert InvalidState(claimId, c.state);
        if (block.timestamp < c.writeOffEligibleAt) revert WriteOffTooEarly();
        // UNCERTAIN: U-84 (the fee stops accruing at write-off)
        _accrueFee(claimId, c);

        uint128 unpaid = c.purchasePrice - _principalPaid(c);
        _orgOutstanding[c.orgId] -= unpaid;
        c.principalWrittenOff = true;
        c.writtenOffPrincipal = unpaid;
        c.state = ClaimState.WrittenOff;
        // the only external call (pool.realizeLoss) comes after; the lint reads SafeCast as an external call
        // forge-lint: disable-next-line(reentrancy-events)
        emit ClaimWrittenOff(claimId, unpaid);

        // UNCERTAIN: U-44 (only the fee is left unpaid, so nothing to book)
        if (unpaid > 0) pool.realizeLoss(unpaid);
    }

    // ---------------------------------------------------------------- admin and pauser

    /// @inheritdoc IClaimRegistry
    // UNCERTAIN: U-12 (no timelock on parameter changes)
    function setParams(Params calldata newParams) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setParams(newParams);
    }

    /// @inheritdoc IClaimRegistry
    // UNCERTAIN: U-69 (per-org cap overrides are not in the PRD)
    function setOrgCap(uint64 orgId, uint128 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (orgId == 0 || orgId > orgs.orgCount()) revert OrgNotFound(orgId);
        uint128 oldCap = _orgCapOverride[orgId];
        _orgCapOverride[orgId] = cap;
        emit OrgCapSet(orgId, oldCap, cap);
    }

    /// @inheritdoc IClaimRegistry
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @inheritdoc IClaimRegistry
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------- views

    /// @inheritdoc IClaimRegistry
    function paused() public view override(IClaimRegistry, Pausable) returns (bool) {
        return super.paused();
    }

    /// @inheritdoc IClaimRegistry
    function getClaim(uint256 claimId) external view returns (Claim memory) {
        return _claims[claimId];
    }

    /// @inheritdoc IClaimRegistry
    function claimCount() external view returns (uint256) {
        return _claimCount;
    }

    /// @inheritdoc IClaimRegistry
    function params() external view returns (Params memory) {
        return _params;
    }

    /// @inheritdoc IClaimRegistry
    function orgOutstanding(uint64 orgId) external view returns (uint256) {
        return _orgOutstanding[orgId];
    }

    /// @inheritdoc IClaimRegistry
    function orgCap(uint64 orgId) public view returns (uint128) {
        uint128 cap = _orgCapOverride[orgId];
        return cap == 0 ? _params.perOrgCap : cap;
    }

    /// @inheritdoc IClaimRegistry
    function orgCapOverride(uint64 orgId) external view returns (uint128) {
        return _orgCapOverride[orgId];
    }

    /// @inheritdoc IClaimRegistry
    function amountRemaining(uint256 claimId) external view returns (uint256) {
        Claim storage c = _claims[claimId];
        return c.amountDue + _pendingFee(c) - c.amountPaid;
    }

    /// @inheritdoc IClaimRegistry
    function isOverdue(uint256 claimId) external view returns (bool) {
        Claim storage c = _claims[claimId];
        return c.state == ClaimState.Funded && block.timestamp >= c.dueAt;
    }

    /// @inheritdoc IClaimRegistry
    function isApprovalExpired(uint256 claimId) external view returns (bool) {
        Claim storage c = _claims[claimId];
        return c.state == ClaimState.Approved && block.timestamp >= c.approvalExpiresAt;
    }

    /// @inheritdoc IClaimRegistry
    function isPacketUsed(bytes32 packetHash) external view returns (bool) {
        return _packetUsed[packetHash];
    }

    /// @inheritdoc IClaimRegistry
    function guarantyDigest(
        address guarantor,
        address recipient,
        uint64 orgId,
        uint128 faceValue,
        uint128 requestedAmount,
        bytes32 packetHash,
        uint256 nonce,
        uint256 deadline
    ) external view returns (bytes32) {
        return _guarantyDigest(guarantor, recipient, orgId, faceValue, requestedAmount, packetHash, nonce, deadline);
    }

    /// @inheritdoc IClaimRegistry
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @inheritdoc IClaimRegistry
    function nonces(address owner) public view override(IClaimRegistry, Nonces) returns (uint256) {
        return super.nonces(owner);
    }

    // ---------------------------------------------------------------- internal

    function _checkSubmission(SubmitClaimParams calldata p) private view {
        if (!orgs.isActiveOrg(p.orgId)) revert OrgInactive(p.orgId);
        // UNCERTAIN: U-34
        if (p.guarantor == msg.sender) revert GuarantorIsRecipient();
        if (!orgs.isActiveOfficer(p.orgId, p.guarantor)) revert NotOfficer(p.orgId, p.guarantor);
        if (p.recipientType == RecipientType.OrgTreasurer && !orgs.isActiveOfficer(p.orgId, msg.sender)) {
            revert NotOfficer(p.orgId, msg.sender);
        }
        if (p.requestedAmount == 0) revert ZeroAmount();
        uint256 advanceLimit = uint256(p.faceValue) * _params.advanceRateBps / BPS;
        if (p.requestedAmount > advanceLimit) revert AmountExceedsLimit(p.requestedAmount, advanceLimit);
        uint128 cap = _params.perClaimCap;
        if (p.requestedAmount > cap) revert AmountExceedsLimit(p.requestedAmount, cap);
        if (p.packetHash == bytes32(0)) revert ZeroPacketHash();
        if (_packetUsed[p.packetHash]) revert PacketAlreadyUsed(p.packetHash);
    }

    function _storeClaim(SubmitClaimParams calldata p) private returns (uint256 claimId) {
        _packetUsed[p.packetHash] = true;
        claimId = ++_claimCount;
        Claim storage c = _claims[claimId];
        c.id = claimId;
        c.recipient = msg.sender;
        c.orgId = p.orgId;
        c.recipientType = p.recipientType;
        c.state = ClaimState.Submitted;
        c.guarantor = p.guarantor;
        c.submittedAt = block.timestamp.toUint40();
        c.faceValue = p.faceValue;
        c.requestedAmount = p.requestedAmount;
        c.packetHash = p.packetHash;
    }

    function _checkPurchase(uint256 claimId, Claim storage c) private view returns (uint128 price) {
        if (c.state != ClaimState.Approved) revert InvalidState(claimId, c.state);
        if (c.recipient != msg.sender) revert NotRecipient();
        // UNCERTAIN: U-45 (the approval stops being purchasable at approvalExpiresAt)
        if (block.timestamp >= c.approvalExpiresAt) revert ApprovalExpired();
        uint64 orgId = c.orgId;
        if (!orgs.isActiveOrg(orgId)) revert OrgInactive(orgId);
        if (!orgs.isActiveOfficer(orgId, c.guarantor)) revert NotOfficer(orgId, c.guarantor);

        // UNCERTAIN: U-43 (perClaimCap is checked at approval, not again here, per FR-C9)
        price = c.approvedAmount;
        uint256 outstandingAfter = _orgOutstanding[orgId] + price;
        uint128 cap = orgCap(orgId);
        if (outstandingAfter > cap) revert OrgCapExceeded(orgId, outstandingAfter, cap);
        uint256 idle = pool.idleCash();
        if (price > idle) revert InsufficientIdleCash(price, idle);
    }

    function _recordPurchase(uint256 claimId, Claim storage c, uint128 price) private {
        // UNCERTAIN: U-08 (feeBps is 0 at launch), U-84 (an annual rate on unpaid principal, not a flat fee)
        uint16 feeBps = _params.feeBps;
        // nothing has accrued yet; the fee is added as time passes
        uint128 amountDue = price;
        uint40 dueAt = (block.timestamp + _params.overdueWindow).toUint40();

        c.feeBps = feeBps;
        c.purchasePrice = price;
        c.amountDue = amountDue;
        c.purchasedAt = block.timestamp.toUint40();
        c.feeAccruedAt = block.timestamp.toUint40();
        c.dueAt = dueAt;
        c.state = ClaimState.Funded;
        _orgOutstanding[c.orgId] += price;
        // only view calls and internal library calls precede this event
        // forge-lint: disable-next-line(reentrancy-events)
        emit ClaimPurchased(claimId, msg.sender, price, amountDue, feeBps, dueAt);
    }

    function _setParams(Params memory newParams) private {
        if (
            newParams.advanceRateBps > BPS || newParams.feeBps > BPS || newParams.perClaimCap == 0
                || newParams.perOrgCap == 0 || newParams.overdueWindow == 0 || newParams.approvalExpiry == 0
                || newParams.writeOffGrace == 0
        ) revert InvalidParams();
        Params memory oldParams = _params;
        _params = newParams;
        emit ParamsUpdated(oldParams, newParams);
    }

    /// @dev Adds the fee accrued since `feeAccruedAt` to `amountDue`.
    function _accrueFee(uint256 claimId, Claim storage c) private {
        uint256 fee = _pendingFee(c);
        c.feeAccruedAt = block.timestamp.toUint40();
        // slither-disable-next-line incorrect-equality
        if (fee == 0) return;
        uint256 due = c.amountDue + fee;
        uint128 amountDue = due.toUint128();
        c.amountDue = amountDue;
        // no external call precedes this event; the lint reads SafeCast and Math as external calls
        // forge-lint: disable-next-line(reentrancy-events)
        emit FeeAccrued(claimId, fee, amountDue);
    }

    /// @dev Fee on unpaid principal since `feeAccruedAt`, at `feeBps` a year, rounded up in the pool's favor. Only
    /// `Funded` and `GuarantorCalled` claims accrue: principal paid in full, or written off, stops it.
    function _pendingFee(Claim storage c) private view returns (uint256) {
        ClaimState state = c.state;
        if (state != ClaimState.Funded && state != ClaimState.GuarantorCalled) return 0;
        uint256 unpaid = c.purchasePrice - _principalPaid(c);
        uint256 elapsed = block.timestamp - c.feeAccruedAt;
        return Math.mulDiv(unpaid, uint256(c.feeBps) * elapsed, BPS * FEE_YEAR, Math.Rounding.Ceil);
    }

    /// @dev Principal is paid before the fee, so principal paid so far is capped at the purchase price.
    function _principalPaid(Claim storage c) private view returns (uint128) {
        uint128 paidSoFar = c.amountPaid;
        uint128 price = c.purchasePrice;
        return paidSoFar < price ? paidSoFar : price;
    }

    function _guarantyDigest(
        address guarantor,
        address recipient,
        uint64 orgId,
        uint128 faceValue,
        uint128 requestedAmount,
        bytes32 packetHash,
        uint256 nonce,
        uint256 deadline
    ) private view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    GUARANTY_TYPEHASH,
                    guarantor,
                    recipient,
                    orgId,
                    faceValue,
                    requestedAmount,
                    packetHash,
                    nonce,
                    deadline
                )
            )
        );
    }
}
