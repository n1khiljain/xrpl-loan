// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "../utils/BaseTest.sol";
import {IClaimRegistry} from "../../src/interfaces/IClaimRegistry.sol";
import {IReceivablesPool} from "../../src/interfaces/IReceivablesPool.sol";
import {
    Claim, ClaimState, RecipientType, CallReason, SubmitClaimParams, InvalidState
} from "../../src/libraries/ClaimTypes.sol";

/// @notice One test per row of the PRD section 7 transition table, plus a matrix that proves every other
/// (state, function) pair reverts with `InvalidState` (FR-C6).
contract ClaimLifecycleTest is BaseTest {
    enum Action {
        Cancel,
        Approve,
        Reject,
        Purchase,
        Settle,
        CallGuarantor,
        WriteOff
    }

    uint256 internal constant ACTION_COUNT = 7;
    uint256 internal constant STATE_COUNT = 10;
    // 13 table rows, but settle from Funded covers two of them (partial and full)
    uint256 internal constant ALLOWED_CELLS = 11;

    function setUp() public override {
        super.setUp();
        _seedPool(POOL_CAP);
    }

    // ---------------------------------------------------------------- table rows

    function test_submitClaim_noneToSubmitted() public {
        SubmitClaimParams memory p = _params(orgId, RecipientType.Member, guarantor, FACE, 800e18);
        uint256 deadline = _deadline();
        bytes memory sig = _sign(guarantorKey, claimant, p, 0, deadline);

        vm.expectEmit(address(registry));
        emit IClaimRegistry.ClaimSubmitted(
            1, orgId, claimant, guarantor, RecipientType.Member, FACE, 800e18, p.packetHash
        );
        vm.prank(claimant);
        uint256 id = registry.submitClaim(p, deadline, sig);

        Claim memory c = _claim(id);
        assertEq(id, 1);
        assertEq(c.id, 1);
        assertEq(uint8(c.state), uint8(ClaimState.Submitted));
        assertEq(c.orgId, orgId);
        assertEq(c.recipient, claimant);
        assertEq(uint8(c.recipientType), uint8(RecipientType.Member));
        assertEq(c.guarantor, guarantor);
        assertEq(c.faceValue, FACE);
        assertEq(c.requestedAmount, 800e18);
        assertEq(c.packetHash, p.packetHash);
        assertEq(c.submittedAt, vm.getBlockTimestamp());
        assertEq(c.approvedAmount, 0);
        assertEq(registry.claimCount(), 1);
        assertEq(registry.nonces(guarantor), 1);
        assertTrue(registry.isPacketUsed(p.packetHash));
    }

    function test_cancelClaim_submittedToCancelled() public {
        uint256 id = _submitDefault();
        vm.expectEmit(address(registry));
        emit IClaimRegistry.ClaimCancelled(id);
        vm.prank(claimant);
        registry.cancelClaim(id);
        assertEq(uint8(_state(id)), uint8(ClaimState.Cancelled));
    }

    function test_approveClaim_submittedToApproved() public {
        uint256 id = _submitDefault();
        uint40 expiresAt = uint40(vm.getBlockTimestamp() + APPROVAL_EXPIRY);
        vm.expectEmit(address(registry));
        emit IClaimRegistry.ClaimApproved(id, 900e18, expiresAt);
        _approve(id, 900e18);

        Claim memory c = _claim(id);
        assertEq(uint8(c.state), uint8(ClaimState.Approved));
        assertEq(c.approvedAmount, 900e18);
        assertEq(c.approvalExpiresAt, expiresAt);
    }

    function test_approveClaim_approvedToApproved() public {
        uint256 id = _submitDefault();
        _approve(id, 900e18);
        vm.warp(vm.getBlockTimestamp() + APPROVAL_EXPIRY + 1);
        assertTrue(registry.isApprovalExpired(id));

        uint40 expiresAt = uint40(vm.getBlockTimestamp() + APPROVAL_EXPIRY);
        vm.expectEmit(address(registry));
        emit IClaimRegistry.ClaimApproved(id, 700e18, expiresAt);
        _approve(id, 700e18);

        Claim memory c = _claim(id);
        assertEq(uint8(c.state), uint8(ClaimState.Approved));
        assertEq(c.approvedAmount, 700e18);
        assertEq(c.approvalExpiresAt, expiresAt, "re-approval resets the expiry");
        assertFalse(registry.isApprovalExpired(id));
    }

    function test_rejectClaim_submittedToRejected() public {
        uint256 id = _submitDefault();
        vm.expectEmit(address(registry));
        emit IClaimRegistry.ClaimRejected(id, REASON);
        vm.prank(underwriter);
        registry.rejectClaim(id, REASON);
        assertEq(uint8(_state(id)), uint8(ClaimState.Rejected));
    }

    function test_rejectClaim_approvedToRejected() public {
        uint256 id = _approved(FACE);
        vm.prank(underwriter);
        registry.rejectClaim(id, "DUPLICATE");
        assertEq(uint8(_state(id)), uint8(ClaimState.Rejected));
    }

    function test_purchaseClaim_approvedToFunded() public {
        uint256 id = _approved(FACE);
        uint40 dueAt = uint40(vm.getBlockTimestamp() + OVERDUE_WINDOW);
        uint256 idleBefore = pool.idleCash();

        vm.expectEmit(address(registry));
        emit IClaimRegistry.ClaimPurchased(id, claimant, FACE, FACE, 0, dueAt);
        vm.expectEmit(address(pool));
        emit IReceivablesPool.PurchaseFunded(claimant, FACE);
        _purchase(id);

        Claim memory c = _claim(id);
        assertEq(uint8(c.state), uint8(ClaimState.Funded));
        assertEq(c.purchasePrice, FACE);
        assertEq(c.amountDue, FACE, "fee is 0, so the claimant settles exactly what they received");
        assertEq(c.feeBps, 0);
        assertEq(c.purchasedAt, vm.getBlockTimestamp());
        assertEq(c.dueAt, dueAt);
        assertEq(nft.ownerOf(id), address(pool), "claim NFT goes to the pool");
        assertEq(frxUSD.balanceOf(claimant), FACE);
        assertEq(pool.idleCash(), idleBefore - FACE);
        assertEq(pool.outstandingPrincipal(), FACE);
        assertEq(registry.orgOutstanding(orgId), FACE);
    }

    function test_settle_fundedToFunded() public {
        uint256 id = _funded(FACE);
        frxUSD.mint(payer, 300e18);
        vm.startPrank(payer);
        frxUSD.approve(address(registry), 300e18);
        vm.expectEmit(address(registry));
        emit IClaimRegistry.ClaimSettlementPaid(id, payer, 300e18, 300e18, FACE - 300e18);
        registry.settle(id, 300e18);
        vm.stopPrank();

        assertEq(uint8(_state(id)), uint8(ClaimState.Funded));
        assertEq(_claim(id).amountPaid, 300e18);
        assertEq(registry.amountRemaining(id), FACE - 300e18);
        assertEq(registry.orgOutstanding(orgId), FACE - 300e18);
        assertEq(pool.outstandingPrincipal(), FACE - 300e18);
    }

    function test_settle_fundedToSettled() public {
        uint256 id = _funded(FACE);
        _pay(claimant, id, 300e18);
        frxUSD.mint(claimant, FACE);
        vm.startPrank(claimant);
        frxUSD.approve(address(registry), FACE);
        vm.expectEmit(address(registry));
        emit IClaimRegistry.ClaimSettlementPaid(id, claimant, FACE - 300e18, FACE - 300e18, 0);
        vm.expectEmit(address(registry));
        emit IClaimRegistry.ClaimSettled(id);
        registry.settle(id, FACE);
        vm.stopPrank();

        assertEq(uint8(_state(id)), uint8(ClaimState.Settled));
        assertEq(_claim(id).amountPaid, FACE);
        assertEq(registry.amountRemaining(id), 0);
        assertEq(registry.orgOutstanding(orgId), 0);
        assertEq(pool.outstandingPrincipal(), 0);
        assertEq(pool.totalAssets(), POOL_CAP);
    }

    function test_callGuarantor_fundedToGuarantorCalled() public {
        uint256 id = _funded(FACE);
        _pay(claimant, id, 250e18);
        uint40 eligibleAt = uint40(vm.getBlockTimestamp() + WRITE_OFF_GRACE);
        vm.expectEmit(address(registry));
        emit IClaimRegistry.GuarantorCalled(id, guarantor, CallReason.PartialShortfall, FACE - 250e18, eligibleAt);
        _callGuarantor(id, CallReason.PartialShortfall);

        Claim memory c = _claim(id);
        assertEq(uint8(c.state), uint8(ClaimState.GuarantorCalled));
        assertEq(uint8(c.callReason), uint8(CallReason.PartialShortfall));
        assertEq(c.guarantorCalledAt, vm.getBlockTimestamp());
        assertEq(c.writeOffEligibleAt, eligibleAt);
        assertEq(registry.orgOutstanding(orgId), FACE - 250e18, "principal is still outstanding");
    }

    function test_settle_guarantorCalledToRecovered() public {
        uint256 id = _guarantorCalled(FACE);
        frxUSD.mint(guarantor, FACE);
        vm.startPrank(guarantor);
        frxUSD.approve(address(registry), FACE);
        vm.expectEmit(address(registry));
        emit IClaimRegistry.ClaimRecovered(id);
        registry.settle(id, FACE);
        vm.stopPrank();

        assertEq(uint8(_state(id)), uint8(ClaimState.Recovered));
        assertEq(registry.orgOutstanding(orgId), 0);
        assertEq(pool.outstandingPrincipal(), 0);
        assertEq(pool.totalAssets(), POOL_CAP);
    }

    function test_writeOff_guarantorCalledToWrittenOff() public {
        uint256 id = _guarantorCalled(FACE);
        _pay(guarantor, id, 100e18);
        vm.warp(_claim(id).writeOffEligibleAt);
        vm.expectEmit(address(registry));
        emit IClaimRegistry.ClaimWrittenOff(id, FACE - 100e18);
        vm.prank(attester);
        registry.writeOff(id);

        Claim memory c = _claim(id);
        assertEq(uint8(c.state), uint8(ClaimState.WrittenOff));
        assertTrue(c.principalWrittenOff);
        assertEq(c.writtenOffPrincipal, FACE - 100e18);
        assertEq(registry.orgOutstanding(orgId), 0);
        assertEq(pool.outstandingPrincipal(), 0);
        assertEq(pool.totalLosses(), FACE - 100e18);
        assertEq(pool.totalAssets(), POOL_CAP - (FACE - 100e18));
    }

    function test_settle_writtenOffToRecovered() public {
        uint256 id = _writtenOff(FACE);
        uint256 assetsBefore = pool.totalAssets();
        _pay(guarantor, id, 400e18);
        assertEq(uint8(_state(id)), uint8(ClaimState.WrittenOff), "partial payment keeps it written off");
        assertEq(pool.totalAssets(), assetsBefore + 400e18, "recovered principal goes back into pool assets");
        assertEq(pool.outstandingPrincipal(), 0);
        assertEq(registry.orgOutstanding(orgId), 0);

        frxUSD.mint(guarantor, FACE);
        vm.startPrank(guarantor);
        frxUSD.approve(address(registry), FACE);
        vm.expectEmit(address(registry));
        emit IClaimRegistry.ClaimRecovered(id);
        uint256 paid = registry.settle(id, FACE);
        vm.stopPrank();

        assertEq(paid, FACE - 400e18);
        assertEq(uint8(_state(id)), uint8(ClaimState.Recovered));
        assertEq(pool.totalAssets(), POOL_CAP, "full recovery restores the pool");
        assertEq(pool.totalLosses(), FACE, "totalLosses stays gross (U-46)");
    }

    // ---------------------------------------------------------------- full matrix

    function test_stateMachine_rejectsEveryTransitionNotInTable() public {
        uint256 checked;
        for (uint256 s = 0; s < STATE_COUNT; s++) {
            ClaimState state = ClaimState(s);
            for (uint256 a = 0; a < ACTION_COUNT; a++) {
                Action action = Action(a);
                if (_allowed(state, action)) continue;
                uint256 snap = vm.snapshotState();
                uint256 id = _claimIn(state);
                _prepare(id, action);
                vm.expectRevert(abi.encodeWithSelector(InvalidState.selector, id, state));
                _act(id, action);
                vm.revertToState(snap);
                checked++;
            }
        }
        assertEq(checked, STATE_COUNT * ACTION_COUNT - ALLOWED_CELLS, "every cell outside the table was checked");
    }

    function test_stateMachine_allowsEveryTransitionInTable() public {
        uint256 checked;
        for (uint256 s = 0; s < STATE_COUNT; s++) {
            ClaimState state = ClaimState(s);
            for (uint256 a = 0; a < ACTION_COUNT; a++) {
                Action action = Action(a);
                if (!_allowed(state, action)) continue;
                uint256 snap = vm.snapshotState();
                uint256 id = _claimIn(state);
                _prepare(id, action);
                _act(id, action);
                assertEq(uint8(_state(id)), uint8(_expected(state, action)), "transition lands on the table's state");
                vm.revertToState(snap);
                checked++;
            }
        }
        assertEq(checked, ALLOWED_CELLS, "every cell in the table was checked");
    }

    /// @dev The PRD section 7 table, as (from state, function) pairs.
    function _allowed(ClaimState s, Action a) internal pure returns (bool) {
        if (a == Action.Cancel) return s == ClaimState.Submitted;
        if (a == Action.Approve || a == Action.Reject) return s == ClaimState.Submitted || s == ClaimState.Approved;
        if (a == Action.Purchase) return s == ClaimState.Approved;
        if (a == Action.Settle) {
            return s == ClaimState.Funded || s == ClaimState.GuarantorCalled || s == ClaimState.WrittenOff;
        }
        if (a == Action.CallGuarantor) return s == ClaimState.Funded;
        return s == ClaimState.GuarantorCalled;
    }

    /// @dev Target state for an allowed cell. `_act` settles in full, so settle lands on a terminal state.
    function _expected(ClaimState s, Action a) internal pure returns (ClaimState) {
        if (a == Action.Cancel) return ClaimState.Cancelled;
        if (a == Action.Approve) return ClaimState.Approved;
        if (a == Action.Reject) return ClaimState.Rejected;
        if (a == Action.Purchase) return ClaimState.Funded;
        if (a == Action.Settle) return s == ClaimState.Funded ? ClaimState.Settled : ClaimState.Recovered;
        if (a == Action.CallGuarantor) return ClaimState.GuarantorCalled;
        return ClaimState.WrittenOff;
    }

    function _claimIn(ClaimState s) internal returns (uint256 id) {
        if (s == ClaimState.None) return registry.claimCount() + 1;
        if (s == ClaimState.Submitted) return _submitDefault();
        if (s == ClaimState.Approved) return _approved(FACE);
        if (s == ClaimState.Funded) return _funded(FACE);
        if (s == ClaimState.GuarantorCalled) return _guarantorCalled(FACE);
        if (s == ClaimState.WrittenOff) return _writtenOff(FACE);
        if (s == ClaimState.Settled) {
            id = _funded(FACE);
            _pay(claimant, id, FACE);
        } else if (s == ClaimState.Recovered) {
            id = _guarantorCalled(FACE);
            _pay(guarantor, id, FACE);
        } else if (s == ClaimState.Rejected) {
            id = _submitDefault();
            vm.prank(underwriter);
            registry.rejectClaim(id, REASON);
        } else {
            id = _submitDefault();
            vm.prank(claimant);
            registry.cancelClaim(id);
        }
        assertEq(uint8(_state(id)), uint8(s));
    }

    /// @dev Funds the payer and moves time past every window, so only the state check can fail.
    function _prepare(uint256 id, Action a) internal {
        if (a == Action.Settle) {
            frxUSD.mint(payer, FACE);
            vm.prank(payer);
            frxUSD.approve(address(registry), FACE);
        }
        if (a == Action.WriteOff) {
            uint256 eligibleAt = _claim(id).writeOffEligibleAt;
            if (eligibleAt > vm.getBlockTimestamp()) vm.warp(eligibleAt);
        }
    }

    function _act(uint256 id, Action a) internal {
        if (a == Action.Cancel) {
            vm.prank(claimant);
            registry.cancelClaim(id);
        } else if (a == Action.Approve) {
            vm.prank(underwriter);
            registry.approveClaim(id, FACE);
        } else if (a == Action.Reject) {
            vm.prank(underwriter);
            registry.rejectClaim(id, REASON);
        } else if (a == Action.Purchase) {
            vm.prank(claimant);
            registry.purchaseClaim(id);
        } else if (a == Action.Settle) {
            vm.prank(payer);
            registry.settle(id, FACE);
        } else if (a == Action.CallGuarantor) {
            vm.prank(attester);
            registry.callGuarantor(id, CallReason.AsucRejected);
        } else {
            vm.prank(attester);
            registry.writeOff(id);
        }
    }
}
