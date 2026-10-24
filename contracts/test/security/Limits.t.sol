// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {BaseTest} from "../utils/BaseTest.sol";
import {CallReason, ClaimState, Params} from "../../src/libraries/ClaimTypes.sol";

/// @notice Workstream B5: SafeCast limits on fee accrual (`toUint128`) and timestamps (`toUint40`).
contract LimitsTest is BaseTest {
    uint128 internal constant HUGE = uint128(1) << 126;

    function _hugeTerms(uint32 grace) internal {
        Params memory p = defaultParams();
        p.feeBps = 10_000;
        p.perClaimCap = type(uint128).max;
        p.perOrgCap = type(uint128).max;
        p.writeOffGrace = grace;
        _setParams(p);
        vm.prank(admin);
        pool.setDepositCap(type(uint256).max);
        _deposit(lender, 2 * uint256(HUGE));
    }

    /// @dev FINDING B-5: once `amountDue + fee` passes `uint128`, `_accrueFee` reverts and `settle`, `callGuarantor`
    /// and `writeOff` all freeze, leaving the principal at par in `totalAssets`. Needs an admin-set `perClaimCap`
    /// around 1e36+ wei; at the 2,500 frxUSD cap the fee needs ~1e17 years at 100%.
    /// @notice Hypothesis: no claim can reach a state where nobody can settle, call or write it off.
    function test_accrueFee_documentsUint128OverflowFreezesTheClaim() public {
        _hugeTerms(4 * 365 days);
        uint256 funded = _approved(HUGE);
        _purchase(funded);
        uint256 called = _approved(HUGE);
        _purchase(called);
        _callGuarantor(called, CallReason.AsucRejected);
        uint256 assetsBefore = pool.totalAssets();

        vm.warp(vm.getBlockTimestamp() + 4 * 365 days);
        uint256 dueFunded = _claim(funded).amountDue + 4 * uint256(HUGE);
        bytes memory overflow =
            abi.encodeWithSelector(SafeCast.SafeCastOverflowedUintDowncast.selector, uint8(128), dueFunded);

        frxUSD.mint(payer, 1);
        vm.prank(payer);
        frxUSD.approve(address(registry), 1);
        vm.prank(payer);
        vm.expectRevert(overflow);
        registry.settle(funded, 1);
        vm.prank(attester);
        vm.expectRevert(overflow);
        registry.callGuarantor(funded, CallReason.Overdue);
        vm.prank(payer);
        vm.expectRevert(overflow);
        registry.settle(called, 1);
        vm.prank(attester);
        vm.expectRevert(overflow);
        registry.writeOff(called);

        assertEq(uint8(_state(funded)), uint8(ClaimState.Funded));
        assertEq(uint8(_state(called)), uint8(ClaimState.GuarantorCalled));
        assertEq(pool.totalAssets(), assetsBefore, "both principals still count at par");
        assertEq(pool.outstandingPrincipal(), 2 * uint256(HUGE));
        // the view has no cast, so the app still shows an amount nobody can pay
        assertEq(registry.amountRemaining(funded), dueFunded);

        emit log_named_uint("purchase price per claim (wei)", HUGE);
        emit log_named_uint("min price frozen within 50y at 100% fee (wei)", uint256(type(uint128).max) / 51 + 1);
        emit log_named_uint(
            "years for a 2,500 frxUSD claim at 100% fee", uint256(type(uint128).max) / uint256(PER_CLAIM_CAP)
        );
    }

    /// @notice Hypothesis: at the deployed caps no realistic fee accrual reaches the `uint128` limit.
    function testFuzz_accrueFee_neverOverflowsAtTheDeployedCap(uint256 years_) public {
        years_ = bound(years_, 1, 1000);
        _setFee(10_000);
        uint256 id = _funded(PER_CLAIM_CAP);
        vm.warp(vm.getBlockTimestamp() + years_ * 365 days);
        _callGuarantor(id, CallReason.Overdue);
        assertEq(_claim(id).amountDue, uint256(PER_CLAIM_CAP) * (years_ + 1));
        _pay(payer, id, 1);
    }

    /// @notice Hypothesis: every `toUint40` timestamp stays in range with all windows at `uint32` max in 2106.
    function test_toUint40_maxWindowsNearYear2106DoNotOverflow() public {
        vm.warp(type(uint32).max - 1);
        Params memory p = defaultParams();
        p.overdueWindow = type(uint32).max;
        p.approvalExpiry = type(uint32).max;
        p.writeOffGrace = type(uint32).max;
        p.feeBps = 10_000;
        _setParams(p);

        uint256 id = _funded(FACE);
        uint256 dueAt = _claim(id).dueAt;
        assertEq(dueAt, uint256(type(uint32).max) - 1 + type(uint32).max);
        vm.warp(dueAt);
        _callGuarantor(id, CallReason.Overdue);
        _writeOff(id);
        assertEq(uint8(_state(id)), uint8(ClaimState.WrittenOff));
        assertLt(_claim(id).writeOffEligibleAt, uint256(type(uint40).max));
        _pay(payer, id, registry.amountRemaining(id));
        assertEq(uint8(_state(id)), uint8(ClaimState.Recovered));
        emit log_named_uint("latest timestamp stored", _claim(id).writeOffEligibleAt);
        emit log_named_uint("uint40 max", type(uint40).max);
    }
}
