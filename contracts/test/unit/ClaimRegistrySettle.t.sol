// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {BaseTest} from "../utils/BaseTest.sol";
import {IClaimRegistry} from "../../src/interfaces/IClaimRegistry.sol";
import {ClaimState, CallReason, InvalidState, ZeroAmount} from "../../src/libraries/ClaimTypes.sol";

/// @notice Settlement rules: partial payments, the cap at amount due, principal before fee, and who can pay when
/// (FR-C11, FR-C12, FR-C14).
contract ClaimRegistrySettleTest is BaseTest {
    function setUp() public override {
        super.setUp();
        _seedPool(POOL_CAP);
    }

    function test_settle_capsAtAmountRemaining() public {
        uint256 id = _funded(FACE);
        frxUSD.mint(payer, 5 * FACE);
        vm.startPrank(payer);
        frxUSD.approve(address(registry), 5 * FACE);
        uint256 paid = registry.settle(id, 5 * FACE);
        vm.stopPrank();
        assertEq(paid, FACE, "never takes more than the amount due");
        assertEq(frxUSD.balanceOf(payer), 4 * FACE);
        assertEq(uint8(_state(id)), uint8(ClaimState.Settled));
    }

    function test_settle_principalBeforeFee() public {
        _setFee(1_000);
        uint256 id = _funded(FACE);
        vm.warp(vm.getBlockTimestamp() + 365 days);

        frxUSD.mint(payer, 1_050e18);
        vm.startPrank(payer);
        frxUSD.approve(address(registry), 1_050e18);
        vm.expectEmit(address(registry));
        emit IClaimRegistry.FeeAccrued(id, 100e18, 1100e18);
        vm.expectEmit(address(registry));
        emit IClaimRegistry.ClaimSettlementPaid(id, payer, 1050e18, FACE, 50e18);
        registry.settle(id, 1050e18);
        vm.stopPrank();

        assertEq(_claim(id).amountDue, 1100e18);
        assertEq(registry.orgOutstanding(orgId), 0, "all principal came back first");
        assertEq(pool.outstandingPrincipal(), 0);
        assertEq(pool.totalAssets(), POOL_CAP + 50e18, "the fee part raises pool assets");
    }

    function test_settle_paidPrincipalStopsTheFee() public {
        _setFee(1000);
        uint256 id = _funded(FACE);
        vm.warp(vm.getBlockTimestamp() + 365 days);
        _pay(payer, id, FACE);
        assertEq(registry.amountRemaining(id), 100e18);
        vm.warp(vm.getBlockTimestamp() + 365 days);
        assertEq(registry.amountRemaining(id), 100e18, "no unpaid principal, so nothing more accrues");
    }

    function test_settle_partialPrincipalSlowsTheFee() public {
        _setFee(1000);
        uint256 id = _funded(FACE);
        _pay(payer, id, FACE / 2);
        vm.warp(vm.getBlockTimestamp() + 365 days);
        assertEq(registry.amountRemaining(id), FACE / 2 + 50e18, "10% a year on the 500 still unpaid");
    }

    function test_settle_feeOnlyPaymentIsIncomeNotPrincipal() public {
        _setFee(1000);
        uint256 id = _funded(FACE);
        vm.warp(vm.getBlockTimestamp() + 365 days);
        _pay(payer, id, FACE);
        assertEq(pool.outstandingPrincipal(), 0);

        _pay(payer, id, 100e18);
        assertEq(uint8(_state(id)), uint8(ClaimState.Settled));
        assertEq(pool.outstandingPrincipal(), 0);
        assertEq(pool.totalAssets(), POOL_CAP + 100e18);
    }

    function test_settle_noFeeEventWhenNothingAccrued() public {
        uint256 id = _funded(FACE);
        frxUSD.mint(payer, FACE);
        vm.startPrank(payer);
        frxUSD.approve(address(registry), FACE);
        vm.recordLogs();
        registry.settle(id, FACE);
        vm.stopPrank();
        // ClaimSettlementPaid, ClaimSettled, the pool's PrincipalReturned, and the frxUSD transfer
        assertEq(vm.getRecordedLogs().length, 4);
    }

    function test_settle_anyoneCanPay() public {
        uint256 id = _funded(FACE);
        _pay(outsider, id, 100e18);
        _pay(guarantor, id, 100e18);
        _pay(treasurer, id, FACE - 200e18);
        assertEq(uint8(_state(id)), uint8(ClaimState.Settled));
    }

    function test_settle_worksWhilePaused() public {
        uint256 id = _funded(FACE);
        vm.prank(pauser);
        registry.pause();
        _pay(claimant, id, FACE);
        assertEq(uint8(_state(id)), uint8(ClaimState.Settled));
    }

    function test_settle_worksWhenOrgInactive() public {
        uint256 id = _funded(FACE);
        vm.prank(admin);
        orgs.setOrgActive(orgId, false);
        _pay(claimant, id, FACE);
        assertEq(uint8(_state(id)), uint8(ClaimState.Settled));
    }

    function test_settle_partialWhileGuarantorCalledStaysCalled() public {
        uint256 id = _guarantorCalled(FACE);
        _pay(guarantor, id, 400e18);
        assertEq(uint8(_state(id)), uint8(ClaimState.GuarantorCalled));
        assertEq(registry.amountRemaining(id), FACE - 400e18);
        assertEq(registry.orgOutstanding(orgId), FACE - 400e18);
    }

    function test_settle_afterWriteOffDoesNotTouchOutstanding() public {
        uint256 id = _writtenOff(FACE);
        uint256 lossesBefore = pool.totalLosses();
        frxUSD.mint(guarantor, 300e18);
        vm.startPrank(guarantor);
        frxUSD.approve(address(registry), 300e18);
        vm.expectEmit(address(registry));
        emit IClaimRegistry.ClaimSettlementPaid(id, guarantor, 300e18, 300e18, FACE - 300e18);
        registry.settle(id, 300e18);
        vm.stopPrank();
        assertEq(pool.outstandingPrincipal(), 0);
        assertEq(registry.orgOutstanding(orgId), 0);
        assertEq(pool.totalLosses(), lossesBefore);
    }

    function test_settle_revertsOnZeroAmount() public {
        uint256 id = _funded(FACE);
        vm.prank(payer);
        vm.expectRevert(ZeroAmount.selector);
        registry.settle(id, 0);
    }

    function test_settle_revertsWhenSubmitted() public {
        uint256 id = _submitDefault();
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(InvalidState.selector, id, ClaimState.Submitted));
        registry.settle(id, 1);
    }

    function test_settle_revertsWhenSettled() public {
        uint256 id = _funded(FACE);
        _pay(payer, id, FACE);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(InvalidState.selector, id, ClaimState.Settled));
        registry.settle(id, 1);
    }

    function test_settle_revertsWithoutAllowance() public {
        uint256 id = _funded(FACE);
        frxUSD.mint(payer, FACE);
        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(registry), 0, FACE)
        );
        registry.settle(id, FACE);
    }

    function test_settle_revertsWithoutBalance() public {
        uint256 id = _funded(FACE);
        vm.startPrank(outsider);
        frxUSD.approve(address(registry), FACE);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, outsider, 0, FACE)
        );
        registry.settle(id, FACE);
        vm.stopPrank();
    }

    function test_settle_moneyGoesToPoolNotRegistry() public {
        uint256 id = _funded(FACE);
        uint256 idleBefore = pool.idleCash();
        _pay(payer, id, FACE);
        assertEq(frxUSD.balanceOf(address(registry)), 0);
        assertEq(pool.idleCash(), idleBefore + FACE);
    }

    function test_amountRemaining_zeroBeforePurchase() public {
        uint256 id = _approved(FACE);
        assertEq(registry.amountRemaining(id), 0);
        assertEq(registry.amountRemaining(12345), 0);
    }

    function test_settle_guarantorPaysAfterPartialShortfall() public {
        uint256 id = _funded(FACE);
        _pay(claimant, id, 700e18);
        _callGuarantor(id, CallReason.PartialShortfall);
        uint256 paid = _pay(guarantor, id, FACE);
        assertEq(paid, 300e18);
        assertEq(uint8(_state(id)), uint8(ClaimState.Recovered));
    }
}
