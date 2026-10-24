// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {BaseTest} from "../utils/BaseTest.sol";
import {IClaimRegistry} from "../../src/interfaces/IClaimRegistry.sol";
import {
    Params,
    Claim,
    ClaimState,
    CallReason,
    InvalidState,
    InvalidCallReason,
    NotOverdue,
    WriteOffTooEarly
} from "../../src/libraries/ClaimTypes.sol";

/// @notice Attester paths: calling the guarantor and writing off (FR-C12, PRD section 7).
contract ClaimRegistryExceptionsTest is BaseTest {
    function setUp() public override {
        super.setUp();
        _seedPool(POOL_CAP);
    }

    function _expectNotAttester(address caller) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, caller, registry.ATTESTER_ROLE()
            )
        );
    }

    // ---------------------------------------------------------------- callGuarantor

    function test_callGuarantor_asucRejectedRightAfterPurchase() public {
        uint256 id = _funded(FACE);
        _callGuarantor(id, CallReason.AsucRejected);
        assertEq(uint8(_claim(id).callReason), uint8(CallReason.AsucRejected));
    }

    function test_callGuarantor_partialShortfallRightAfterPurchase() public {
        uint256 id = _funded(FACE);
        _callGuarantor(id, CallReason.PartialShortfall);
        assertEq(uint8(_state(id)), uint8(ClaimState.GuarantorCalled));
    }

    function test_callGuarantor_overdueAtDueDate() public {
        uint256 id = _funded(FACE);
        vm.warp(_claim(id).dueAt);
        assertTrue(registry.isOverdue(id));
        _callGuarantor(id, CallReason.Overdue);
        assertEq(uint8(_claim(id).callReason), uint8(CallReason.Overdue));
        assertFalse(registry.isOverdue(id), "only Funded claims read as overdue");
    }

    function test_callGuarantor_revertsOverdueBeforeDueDate() public {
        uint256 id = _funded(FACE);
        vm.warp(_claim(id).dueAt - 1);
        assertFalse(registry.isOverdue(id));
        vm.prank(attester);
        vm.expectRevert(NotOverdue.selector);
        registry.callGuarantor(id, CallReason.Overdue);
    }

    function test_callGuarantor_revertsOnNoneReason() public {
        uint256 id = _funded(FACE);
        vm.prank(attester);
        vm.expectRevert(InvalidCallReason.selector);
        registry.callGuarantor(id, CallReason.None);
    }

    function test_callGuarantor_revertsForNonAttester() public {
        uint256 id = _funded(FACE);
        _expectNotAttester(underwriter);
        vm.prank(underwriter);
        registry.callGuarantor(id, CallReason.AsucRejected);
    }

    function test_callGuarantor_revertsForAdminWithoutAttesterRole() public {
        uint256 id = _funded(FACE);
        _expectNotAttester(admin);
        vm.prank(admin);
        registry.callGuarantor(id, CallReason.AsucRejected);
    }

    function test_callGuarantor_revertsWhenAlreadyCalled() public {
        uint256 id = _guarantorCalled(FACE);
        vm.prank(attester);
        vm.expectRevert(abi.encodeWithSelector(InvalidState.selector, id, ClaimState.GuarantorCalled));
        registry.callGuarantor(id, CallReason.PartialShortfall);
    }

    function test_callGuarantor_worksWhilePaused() public {
        uint256 id = _funded(FACE);
        vm.prank(pauser);
        registry.pause();
        _callGuarantor(id, CallReason.AsucRejected);
        assertEq(uint8(_state(id)), uint8(ClaimState.GuarantorCalled));
    }

    function test_callGuarantor_usesGraceAtCallTime() public {
        uint256 id = _funded(FACE);
        Params memory p = defaultParams();
        p.writeOffGrace = 7 days;
        _setParams(p);
        _callGuarantor(id, CallReason.AsucRejected);
        assertEq(_claim(id).writeOffEligibleAt, vm.getBlockTimestamp() + 7 days);
    }

    // ---------------------------------------------------------------- writeOff

    function test_writeOff_atEligibleTime() public {
        uint256 id = _guarantorCalled(FACE);
        _writeOff(id);
        assertEq(uint8(_state(id)), uint8(ClaimState.WrittenOff));
    }

    function test_writeOff_revertsBeforeGraceEnds() public {
        uint256 id = _guarantorCalled(FACE);
        vm.warp(_claim(id).writeOffEligibleAt - 1);
        vm.prank(attester);
        vm.expectRevert(WriteOffTooEarly.selector);
        registry.writeOff(id);
    }

    function test_writeOff_revertsForNonAttester() public {
        uint256 id = _guarantorCalled(FACE);
        vm.warp(_claim(id).writeOffEligibleAt);
        _expectNotAttester(admin);
        vm.prank(admin);
        registry.writeOff(id);
    }

    function test_writeOff_revertsWhenFunded() public {
        uint256 id = _funded(FACE);
        vm.prank(attester);
        vm.expectRevert(abi.encodeWithSelector(InvalidState.selector, id, ClaimState.Funded));
        registry.writeOff(id);
    }

    function test_writeOff_revertsWhenAlreadyWrittenOff() public {
        uint256 id = _writtenOff(FACE);
        vm.prank(attester);
        vm.expectRevert(abi.encodeWithSelector(InvalidState.selector, id, ClaimState.WrittenOff));
        registry.writeOff(id);
    }

    function test_writeOff_worksWhilePaused() public {
        uint256 id = _guarantorCalled(FACE);
        vm.prank(pauser);
        registry.pause();
        _writeOff(id);
        assertEq(uint8(_state(id)), uint8(ClaimState.WrittenOff));
    }

    function test_writeOff_onlyUnpaidPrincipalIsLost() public {
        uint256 id = _guarantorCalled(FACE);
        _pay(guarantor, id, 350e18);
        uint256 priceBefore = _sharePrice();
        _writeOff(id);
        Claim memory c = _claim(id);
        assertEq(c.writtenOffPrincipal, FACE - 350e18);
        assertEq(pool.totalLosses(), FACE - 350e18);
        assertEq(pool.totalAssets(), POOL_CAP - (FACE - 350e18));
        assertLt(_sharePrice(), priceBefore, "a write-off lowers the share price");
    }

    function test_writeOff_feeOnlyRemainingBooksNoLoss() public {
        _setFee(500);
        uint256 id = _funded(FACE);
        vm.warp(vm.getBlockTimestamp() + 365 days);
        _callGuarantor(id, CallReason.AsucRejected);
        _pay(guarantor, id, FACE);
        assertEq(registry.amountRemaining(id), 50e18);
        uint256 assetsBefore = pool.totalAssets();
        vm.recordLogs();
        _writeOff(id);
        // UNCERTAIN: U-44
        assertEq(vm.getRecordedLogs().length, 1, "only ClaimWrittenOff, no LossRealized");
        assertEq(uint8(_state(id)), uint8(ClaimState.WrittenOff));
        assertEq(_claim(id).writtenOffPrincipal, 0);
        assertEq(pool.totalLosses(), 0);
        assertEq(pool.totalAssets(), assetsBefore);
    }

    function test_writeOff_stopsTheFee() public {
        _setFee(1000);
        uint256 id = _guarantorCalled(FACE);
        _writeOff(id);
        uint256 owed = registry.amountRemaining(id);
        assertEq(owed, _claim(id).amountDue, "accrued through the write-off and stored");
        assertGt(owed, FACE, "the fee accrued through the grace period");
        vm.warp(vm.getBlockTimestamp() + 365 days);
        assertEq(registry.amountRemaining(id), owed, "a written-off claim no longer accrues");
    }

    function test_callGuarantor_reportsTheAccruedAmount() public {
        _setFee(1000);
        uint256 id = _funded(FACE);
        vm.warp(vm.getBlockTimestamp() + 365 days);
        vm.expectEmit(address(registry));
        emit IClaimRegistry.FeeAccrued(id, 100e18, FACE + 100e18);
        _callGuarantor(id, CallReason.AsucRejected);
        assertEq(_claim(id).amountDue, FACE + 100e18);
    }

    function test_writeOff_lossesAreIsolatedToTheOrg() public {
        uint256 a = _guarantorCalled(FACE);
        uint256 b = _funded(500e18);
        _writeOff(a);
        assertEq(registry.orgOutstanding(orgId), 500e18);
        assertEq(uint8(_state(b)), uint8(ClaimState.Funded));
    }

    function test_isOverdue_falseForUnknownAndUnfundedClaims() public {
        uint256 id = _approved(FACE);
        vm.warp(vm.getBlockTimestamp() + 400 days);
        assertFalse(registry.isOverdue(id));
        assertFalse(registry.isOverdue(777));
    }
}
