// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ClaimRegistry} from "../../src/ClaimRegistry.sol";
import {ReceivablesPool} from "../../src/ReceivablesPool.sol";
import {OrgRegistry} from "../../src/OrgRegistry.sol";
import {MockFrxUSD} from "../../src/mocks/MockFrxUSD.sol";
import {
    Claim, ClaimState, RecipientType, CallReason, Params, SubmitClaimParams
} from "../../src/libraries/ClaimTypes.sol";

/// @notice Drives every role through valid calls only, so the invariant run can use `fail_on_revert = true`.
/// Each action checks its own preconditions and returns early when a call would legitimately revert. Ghost
/// variables record what the invariants in `Invariants.t.sol` need: money in and out of the pool, share price
/// moves, org cap checks at purchase, and every claim's previous state.
contract Handler is Test {
    ClaimRegistry public registry;
    ReceivablesPool public pool;
    OrgRegistry public orgs;
    MockFrxUSD public frxUSD;

    address public admin;
    address public underwriter;
    address public attester;
    address public pauser;

    address[] public lenders;
    address[] public members;
    address[] public officers;
    mapping(address => uint256) internal _officerKey;
    uint64[] public orgIds;

    // money in and out of the pool, for I-7
    uint256 public ghostDeposited;
    uint256 public ghostSettledIn;
    uint256 public ghostDonated;
    uint256 public ghostPurchasedOut;
    uint256 public ghostWithdrawnOut;
    bool public ghostOutflowOutsideAllowedPath;

    // I-4, I-5, I-6
    bool public ghostSharePriceDroppedOutsideWriteOff;
    bool public ghostOrgCapBreachedAtPurchase;
    bool public ghostTerminalStateChanged;
    bool public ghostWrittenOffMovedElsewhere;
    bool public ghostDepositOpenWhilePaused;
    mapping(uint256 claimId => ClaimState) public ghostLastState;

    mapping(bytes32 action => uint256) public calls;
    uint256 internal _packetNonce;

    constructor(
        ClaimRegistry registry_,
        ReceivablesPool pool_,
        OrgRegistry orgs_,
        MockFrxUSD frxUSD_,
        address[4] memory roles,
        address[] memory lenders_,
        address[] memory members_,
        address[] memory officers_,
        uint256[] memory officerKeys,
        uint64[] memory orgIds_
    ) {
        registry = registry_;
        pool = pool_;
        orgs = orgs_;
        frxUSD = frxUSD_;
        (admin, underwriter, attester, pauser) = (roles[0], roles[1], roles[2], roles[3]);
        lenders = lenders_;
        members = members_;
        officers = officers_;
        for (uint256 i = 0; i < officers_.length; i++) {
            _officerKey[officers_[i]] = officerKeys[i];
        }
        orgIds = orgIds_;
    }

    // ---------------------------------------------------------------- bookkeeping

    /// @dev Wraps every action: records share price and pool balance before, checks them after, and replays
    /// every claim's state against the last one seen.
    modifier tracked(bool mayLowerSharePrice, bool mayMoveMoneyOut) {
        uint256 priceBefore = sharePrice();
        uint256 balanceBefore = frxUSD.balanceOf(address(pool));
        _;
        // I-4 allows 1 wei of rounding
        if (!mayLowerSharePrice && sharePrice() + 1 < priceBefore) ghostSharePriceDroppedOutsideWriteOff = true;
        if (!mayMoveMoneyOut && frxUSD.balanceOf(address(pool)) < balanceBefore) {
            ghostOutflowOutsideAllowedPath = true;
        }
        _recordStates();
    }

    function sharePrice() public view returns (uint256) {
        return pool.convertToAssets(10 ** pool.decimals());
    }

    function lenderCount() external view returns (uint256) {
        return lenders.length;
    }

    function orgCount() external view returns (uint256) {
        return orgIds.length;
    }

    function _recordStates() internal {
        uint256 count = registry.claimCount();
        for (uint256 id = 1; id <= count; id++) {
            ClaimState previous = ghostLastState[id];
            ClaimState current = registry.getClaim(id).state;
            if (_isTerminal(previous) && current != previous) ghostTerminalStateChanged = true;
            if (
                previous == ClaimState.WrittenOff && current != ClaimState.WrittenOff
                    && current != ClaimState.Recovered
            ) ghostWrittenOffMovedElsewhere = true;
            ghostLastState[id] = current;
        }
    }

    function _isTerminal(ClaimState s) internal pure returns (bool) {
        return s == ClaimState.Settled || s == ClaimState.Recovered || s == ClaimState.Rejected
            || s == ClaimState.Cancelled;
    }

    uint256 internal constant SUBMITTED = 1 << uint8(ClaimState.Submitted);
    uint256 internal constant APPROVED = 1 << uint8(ClaimState.Approved);
    uint256 internal constant FUNDED = 1 << uint8(ClaimState.Funded);
    uint256 internal constant CALLED = 1 << uint8(ClaimState.GuarantorCalled);
    uint256 internal constant WRITTEN_OFF = 1 << uint8(ClaimState.WrittenOff);

    /// @dev Scans claims from a seed-picked start and returns the first one whose state is in `mask`, so actions
    /// land on claims they can act on and runs reach deep states.
    function _findClaim(uint256 seed, uint256 mask) internal view returns (uint256 id, Claim memory c) {
        uint256 count = registry.claimCount();
        if (count == 0) return (0, c);
        uint256 start = seed % count;
        for (uint256 i = 0; i < count; i++) {
            uint256 candidate = (start + i) % count + 1;
            Claim memory found = registry.getClaim(candidate);
            if (mask & (1 << uint8(found.state)) != 0) return (candidate, found);
        }
        return (0, c);
    }

    function _hit(bytes32 action) internal {
        calls[action]++;
    }

    /// @notice How many claims are in each state right now, indexed by `ClaimState`.
    function stateCounts() external view returns (uint256[10] memory counts) {
        uint256 count = registry.claimCount();
        for (uint256 id = 1; id <= count; id++) {
            counts[uint8(registry.getClaim(id).state)]++;
        }
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    // ---------------------------------------------------------------- lenders

    function deposit(uint256 lenderSeed, uint256 amount) external tracked(false, false) {
        address lender = lenders[lenderSeed % lenders.length];
        uint256 max = _min(pool.maxDeposit(lender), 100_000e18);
        if (max == 0) return;
        amount = bound(amount, 1, max);
        frxUSD.mint(lender, amount);
        vm.startPrank(lender);
        frxUSD.approve(address(pool), amount);
        pool.deposit(amount, lender);
        vm.stopPrank();
        ghostDeposited += amount;
        _hit("deposit");
    }

    function mint(uint256 lenderSeed, uint256 shares) external tracked(false, false) {
        address lender = lenders[lenderSeed % lenders.length];
        uint256 max = _min(pool.maxMint(lender), pool.previewDeposit(100_000e18));
        if (max == 0) return;
        shares = bound(shares, 1, max);
        uint256 assets = pool.previewMint(shares);
        frxUSD.mint(lender, assets);
        vm.startPrank(lender);
        frxUSD.approve(address(pool), assets);
        pool.mint(shares, lender);
        vm.stopPrank();
        ghostDeposited += assets;
        _hit("mint");
    }

    function withdraw(uint256 lenderSeed, uint256 amount) external tracked(false, true) {
        address lender = lenders[lenderSeed % lenders.length];
        uint256 max = pool.maxWithdraw(lender);
        if (max == 0) return;
        amount = bound(amount, 1, max);
        vm.prank(lender);
        pool.withdraw(amount, lender, lender);
        ghostWithdrawnOut += amount;
        _hit("withdraw");
    }

    function redeem(uint256 lenderSeed, uint256 shares) external tracked(false, true) {
        address lender = lenders[lenderSeed % lenders.length];
        uint256 max = pool.maxRedeem(lender);
        if (max == 0) return;
        shares = bound(shares, 1, max);
        vm.prank(lender);
        ghostWithdrawnOut += pool.redeem(shares, lender, lender);
        _hit("redeem");
    }

    function transferShares(uint256 fromSeed, uint256 toSeed, uint256 shares)
        external
        tracked(false, false)
    {
        address from = lenders[fromSeed % lenders.length];
        address to = lenders[toSeed % lenders.length];
        uint256 balance = pool.balanceOf(from);
        if (balance == 0) return;
        shares = bound(shares, 1, balance);
        vm.prank(from);
        pool.transfer(to, shares);
        _hit("transferShares");
    }

    function donate(uint256 amount) external tracked(false, false) {
        amount = bound(amount, 1, 1_000e18);
        frxUSD.mint(address(pool), amount);
        ghostDonated += amount;
        _hit("donate");
    }

    // ---------------------------------------------------------------- claimants

    function submitClaim(
        uint256 claimantSeed,
        uint256 guarantorSeed,
        uint256 orgSeed,
        uint256 face,
        uint256 requested,
        bool asTreasurer
    ) external tracked(false, false) {
        _doSubmit(claimantSeed, guarantorSeed, orgSeed, face, requested, asTreasurer);
    }

    /// @dev Submit, approve, and purchase one claim in a single step. Each stage runs the same checks as the
    /// single-step actions and stops at the first one that would revert. Without this, a 50-call run rarely lines
    /// up the three steps, and few claims reach the states after purchase.
    function fastTrack(uint256 seed, uint256 face, uint256 requested, uint256 amount) external tracked(false, true) {
        uint256 id = _fastSubmit(seed, face, requested);
        if (id != 0) _fastApproveAndPurchase(id, amount);
    }

    function _fastSubmit(uint256 seed, uint256 face, uint256 requested) internal returns (uint256) {
        return _doSubmit(seed, seed >> 8, seed >> 16, face, requested, (seed >> 24) % 3 == 0);
    }

    function _fastApproveAndPurchase(uint256 id, uint256 amount) internal {
        _doApprove(id, registry.getClaim(id), amount);
        Claim memory c = registry.getClaim(id);
        if (_purchasable(c)) _doPurchase(id, c);
        _hit("fastTrack");
    }

    function _doSubmit(
        uint256 claimantSeed,
        uint256 guarantorSeed,
        uint256 orgSeed,
        uint256 face,
        uint256 requested,
        bool asTreasurer
    ) internal returns (uint256) {
        if (registry.paused()) return 0;
        uint64 orgId = orgIds[orgSeed % orgIds.length];
        if (!orgs.isActiveOrg(orgId)) return 0;
        (address claimant, address guarantor) = _pickParties(claimantSeed, guarantorSeed, asTreasurer);
        SubmitClaimParams memory sp = _buildClaim(orgId, guarantor, face, requested, asTreasurer);
        if (sp.requestedAmount == 0) return 0;
        return _signAndSubmit(claimant, sp);
    }

    function _pickParties(uint256 claimantSeed, uint256 guarantorSeed, bool asTreasurer)
        internal
        view
        returns (address claimant, address guarantor)
    {
        uint256 guarantorIndex = guarantorSeed % officers.length;
        guarantor = officers[guarantorIndex];
        if (asTreasurer) {
            // any other officer, so the guarantor is never the claimant (U-34)
            uint256 offset = 1 + claimantSeed % (officers.length - 1);
            claimant = officers[(guarantorIndex + offset) % officers.length];
        } else {
            claimant = members[claimantSeed % members.length];
        }
    }

    /// @dev Returns a zero requested amount when the current terms leave no room for any request.
    function _buildClaim(uint64 orgId, address guarantor, uint256 face, uint256 requested, bool asTreasurer)
        internal
        returns (SubmitClaimParams memory sp)
    {
        Params memory p = registry.params();
        face = bound(face, 1e18, 5_000e18);
        uint256 limit = _min(face * p.advanceRateBps / 10_000, p.perClaimCap);
        sp = SubmitClaimParams({
            orgId: orgId,
            recipientType: asTreasurer ? RecipientType.OrgTreasurer : RecipientType.Member,
            guarantor: guarantor,
            faceValue: uint128(face),
            requestedAmount: limit == 0 ? 0 : uint128(bound(requested, 1, limit)),
            packetHash: keccak256(abi.encode("invariant-packet", ++_packetNonce))
        });
    }

    function _signAndSubmit(address claimant, SubmitClaimParams memory sp) internal returns (uint256 id) {
        uint256 deadline = vm.getBlockTimestamp() + 1 days;
        bytes32 digest = registry.guarantyDigest(
            sp.guarantor,
            claimant,
            sp.orgId,
            sp.faceValue,
            sp.requestedAmount,
            sp.packetHash,
            registry.nonces(sp.guarantor),
            deadline
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_officerKey[sp.guarantor], digest);
        vm.prank(claimant);
        id = registry.submitClaim(sp, deadline, abi.encodePacked(r, s, v));
        _hit("submitClaim");
    }

    function cancelClaim(uint256 seed) external tracked(false, false) {
        (uint256 id, Claim memory c) = _findClaim(seed, SUBMITTED);
        if (id == 0) return;
        vm.prank(c.recipient);
        registry.cancelClaim(id);
        _hit("cancelClaim");
    }

    function purchaseClaim(uint256 seed) external tracked(false, true) {
        if (registry.paused()) return;
        (uint256 id, Claim memory c) = _findPurchasable(seed);
        if (id != 0) _doPurchase(id, c);
    }

    function _doPurchase(uint256 id, Claim memory c) internal {
        uint256 cap = registry.orgCap(c.orgId);
        vm.prank(c.recipient);
        registry.purchaseClaim(id);
        ghostPurchasedOut += c.approvedAmount;
        // I-5: checked against the cap in force at this purchase
        if (registry.orgOutstanding(c.orgId) > cap) ghostOrgCapBreachedAtPurchase = true;
        _hit("purchaseClaim");
    }

    /// @dev Every purchaseClaim check, so the call below it cannot revert.
    function _purchasable(Claim memory c) internal view returns (bool) {
        if (registry.paused() || c.state != ClaimState.Approved || vm.getBlockTimestamp() >= c.approvalExpiresAt) {
            return false;
        }
        if (!orgs.isActiveOrg(c.orgId) || pool.idleCash() < c.approvedAmount) return false;
        return registry.orgOutstanding(c.orgId) + c.approvedAmount <= registry.orgCap(c.orgId);
    }

    /// @dev First purchasable claim from a seed-picked start.
    function _findPurchasable(uint256 seed) internal view returns (uint256, Claim memory) {
        uint256 count = registry.claimCount();
        Claim memory none;
        if (count == 0) return (0, none);
        uint256 start = seed % count;
        for (uint256 i = 0; i < count; i++) {
            uint256 id = (start + i) % count + 1;
            Claim memory c = registry.getClaim(id);
            if (_purchasable(c)) return (id, c);
        }
        return (0, none);
    }

    function settle(uint256 seed, uint256 payerSeed, uint256 amount) external tracked(false, false) {
        (uint256 id, Claim memory c) = _findClaim(seed, FUNDED | CALLED | WRITTEN_OFF);
        if (id == 0) return;
        uint256 remaining = c.amountDue - c.amountPaid;
        // overpaying is allowed and must be capped by the registry
        amount = bound(amount, 1, remaining * 2);
        address payer = payerSeed % 2 == 0 ? c.recipient : c.guarantor;
        frxUSD.mint(payer, amount);
        vm.startPrank(payer);
        frxUSD.approve(address(registry), amount);
        uint256 paid = registry.settle(id, amount);
        frxUSD.approve(address(registry), 0);
        vm.stopPrank();
        ghostSettledIn += paid;
        _hit("settle");
    }

    // ---------------------------------------------------------------- underwriter and attester

    function approveClaim(uint256 seed, uint256 amount) external tracked(false, false) {
        if (registry.paused()) return;
        // mostly first approvals; one time in four a re-approval, which resets the expiry
        (uint256 id, Claim memory c) = _findClaim(seed, seed % 4 == 0 ? APPROVED : SUBMITTED);
        if (id == 0) (id, c) = _findClaim(seed, SUBMITTED | APPROVED);
        if (id != 0) _doApprove(id, c, amount);
    }

    function _doApprove(uint256 id, Claim memory c, uint256 amount) internal {
        if (registry.paused()) return;
        uint256 max = _min(c.requestedAmount, registry.params().perClaimCap);
        amount = bound(amount, 1, max);
        vm.prank(underwriter);
        registry.approveClaim(id, uint128(amount));
        _hit("approveClaim");
    }

    function rejectClaim(uint256 seed) external tracked(false, false) {
        (uint256 id,) = _findClaim(seed, SUBMITTED | APPROVED);
        if (id == 0) return;
        vm.prank(underwriter);
        registry.rejectClaim(id, "OTHER");
        _hit("rejectClaim");
    }

    function callGuarantor(uint256 seed, uint256 reasonSeed) external tracked(false, false) {
        (uint256 id, Claim memory c) = _findClaim(seed, FUNDED);
        if (id == 0) return;
        CallReason reason = CallReason(bound(reasonSeed, 1, 3));
        if (reason == CallReason.Overdue && vm.getBlockTimestamp() < c.dueAt) reason = CallReason.AsucRejected;
        vm.prank(attester);
        registry.callGuarantor(id, reason);
        _hit("callGuarantor");
    }

    function writeOff(uint256 seed) external tracked(true, false) {
        (uint256 id, Claim memory c) = _findClaim(seed, CALLED);
        if (id == 0) return;
        if (vm.getBlockTimestamp() < c.writeOffEligibleAt) vm.warp(c.writeOffEligibleAt);
        vm.prank(attester);
        registry.writeOff(id);
        _hit("writeOff");
    }

    // ---------------------------------------------------------------- admin, pauser, time

    function setParams(
        uint16 advanceRateBps,
        uint16 feeBps,
        uint128 perClaimCap,
        uint128 perOrgCap,
        uint32 overdueWindow,
        uint32 approvalExpiry,
        uint32 writeOffGrace
    ) external tracked(false, false) {
        uint128 claimCap = uint128(bound(perClaimCap, 100e18, 5_000e18));
        Params memory p = Params({
            advanceRateBps: uint16(bound(advanceRateBps, 5_000, 10_000)),
            feeBps: uint16(bound(feeBps, 0, 1_000)),
            perClaimCap: claimCap,
            // usually at least one claim's worth of room; one time in eight the org cap can drop below it
            perOrgCap: uint128(bound(perOrgCap, perOrgCap % 8 == 0 ? 1e18 : claimCap, 20_000e18)),
            overdueWindow: uint32(bound(overdueWindow, 1 days, 200 days)),
            approvalExpiry: uint32(bound(approvalExpiry, 3 days, 30 days)),
            writeOffGrace: uint32(bound(writeOffGrace, 1 days, 90 days))
        });
        vm.prank(admin);
        registry.setParams(p);
        _hit("setParams");
    }

    function setDepositCap(uint256 cap) external tracked(false, false) {
        cap = bound(cap, 0, 200_000e18);
        vm.prank(admin);
        pool.setDepositCap(cap);
        _hit("setDepositCap");
    }

    function setAllowlistEnabled(bool enabled) external tracked(false, false) {
        vm.prank(admin);
        pool.setAllowlistEnabled(enabled);
        _hit("setAllowlistEnabled");
    }

    function setOrgCap(uint256 orgSeed, uint128 cap) external tracked(false, false) {
        // one time in four back to perOrgCap, otherwise an override from below one claim to well above perOrgCap
        cap = cap % 4 == 0 ? 0 : uint128(bound(cap, 1e18, 60_000e18));
        vm.prank(admin);
        registry.setOrgCap(orgIds[orgSeed % orgIds.length], cap);
        _hit("setOrgCap");
    }

    function setOrgActive(uint256 orgSeed, uint256 activeSeed) external tracked(false, false) {
        // deactivate one time in four so orgs are usually open
        bool active = activeSeed % 4 != 0;
        vm.prank(admin);
        orgs.setOrgActive(orgIds[orgSeed % orgIds.length], active);
        _hit("setOrgActive");
    }

    /// @dev Unpauses if paused. Otherwise pauses, checks that deposits read as closed (FR-C14), and three times in
    /// four unpauses again in the same call, so runs keep moving while a quarter of pauses last across actions.
    function togglePause(uint256 seed) external tracked(false, false) {
        if (registry.paused()) {
            vm.prank(admin);
            registry.unpause();
            _hit("togglePause");
            return;
        }
        vm.prank(pauser);
        registry.pause();
        for (uint256 i = 0; i < lenders.length; i++) {
            if (pool.maxDeposit(lenders[i]) != 0 || pool.maxMint(lenders[i]) != 0) ghostDepositOpenWhilePaused = true;
        }
        if (seed % 4 != 0) {
            vm.prank(admin);
            registry.unpause();
        }
        _hit("togglePause");
    }

    function warp(uint256 seconds_) external tracked(false, false) {
        vm.warp(vm.getBlockTimestamp() + bound(seconds_, 1, 10 days));
        _hit("warp");
    }
}
