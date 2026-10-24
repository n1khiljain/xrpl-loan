// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "../utils/BaseTest.sol";
import {
    Params,
    Claim,
    ClaimState,
    RecipientType,
    CallReason,
    SubmitClaimParams,
    ZeroAmount,
    AmountExceedsLimit,
    InvalidGuaranty,
    InvalidParams,
    ApprovalExpired,
    NotOverdue,
    WriteOffTooEarly,
    OrgCapExceeded
} from "../../src/libraries/ClaimTypes.sol";

/// @notice Fuzz tests over amounts, timestamps, and parameter changes for the claim registry.
contract ClaimRegistryFuzzTest is BaseTest {
    uint256 internal constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    function setUp() public override {
        super.setUp();
        _seedPool(POOL_CAP);
    }

    function testFuzz_submitClaim_amountLimits(uint128 face, uint128 requested, uint16 advanceRate) public {
        advanceRate = uint16(bound(advanceRate, 0, 10_000));
        face = uint128(bound(face, 0, 1e30));
        requested = uint128(bound(requested, 0, 1e30));
        Params memory p = defaultParams();
        p.advanceRateBps = advanceRate;
        _setParams(p);

        SubmitClaimParams memory sp = _params(orgId, RecipientType.Member, guarantor, face, requested);
        uint256 deadline = _deadline();
        bytes memory sig = _sign(guarantorKey, claimant, sp, 0, deadline);
        uint256 advanceLimit = uint256(face) * advanceRate / 10_000;

        if (requested == 0) {
            vm.expectRevert(ZeroAmount.selector);
        } else if (requested > advanceLimit) {
            vm.expectRevert(abi.encodeWithSelector(AmountExceedsLimit.selector, requested, advanceLimit));
        } else if (requested > PER_CLAIM_CAP) {
            vm.expectRevert(abi.encodeWithSelector(AmountExceedsLimit.selector, requested, PER_CLAIM_CAP));
        }
        vm.prank(claimant);
        registry.submitClaim(sp, deadline, sig);
    }

    function testFuzz_approveClaim_amountLimits(uint128 requested, uint128 amount, uint128 cap) public {
        requested = uint128(bound(requested, 1, PER_CLAIM_CAP));
        uint256 id = _submit(PER_CLAIM_CAP, requested);
        cap = uint128(bound(cap, 1, PER_CLAIM_CAP));
        amount = uint128(bound(amount, 0, 2 * PER_CLAIM_CAP));
        Params memory p = defaultParams();
        p.perClaimCap = cap;
        _setParams(p);

        if (amount == 0) {
            vm.expectRevert(ZeroAmount.selector);
        } else if (amount > requested) {
            vm.expectRevert(abi.encodeWithSelector(AmountExceedsLimit.selector, amount, requested));
        } else if (amount > cap) {
            vm.expectRevert(abi.encodeWithSelector(AmountExceedsLimit.selector, amount, cap));
        }
        vm.prank(underwriter);
        registry.approveClaim(id, amount);
    }

    function testFuzz_amountRemaining_feeAccruesOnUnpaidPrincipal(uint128 price, uint16 feeBps, uint256 elapsed)
        public
    {
        price = uint128(bound(price, 1, PER_CLAIM_CAP));
        feeBps = uint16(bound(feeBps, 0, 10_000));
        elapsed = bound(elapsed, 0, 3 * 365 days);
        _setFee(feeBps);
        uint256 id = _funded(price);
        vm.warp(vm.getBlockTimestamp() + elapsed);

        uint256 denominator = uint256(10_000) * 365 days;
        uint256 fee = (uint256(price) * feeBps * elapsed + denominator - 1) / denominator;
        assertEq(registry.amountRemaining(id), uint256(price) + fee, "rounded up in the pool's favor");
        assertEq(_claim(id).feeBps, feeBps);
    }

    function testFuzz_settle_principalFirstThenFee(
        uint128 price,
        uint16 feeBps,
        uint256[5] memory payments,
        uint256[5] memory gaps
    ) public {
        price = uint128(bound(price, 1e6, PER_CLAIM_CAP));
        feeBps = uint16(bound(feeBps, 0, 2_000));
        _setFee(feeBps);
        uint256 id = _funded(price);

        uint256 total;
        for (uint256 i = 0; i < payments.length; i++) {
            if (_state(id) == ClaimState.Settled) break;
            vm.warp(vm.getBlockTimestamp() + bound(gaps[i], 0, 120 days));
            uint256 remaining = registry.amountRemaining(id);
            uint256 amount = bound(payments[i], 1, remaining);
            uint256 paid = _pay(payer, id, amount);
            assertEq(paid, amount, "paid is min(amount, remaining)");
            total += paid;

            uint256 principalPaid = total < price ? total : price;
            Claim memory c = _claim(id);
            assertEq(c.amountPaid, total);
            assertLe(c.amountPaid, c.amountDue);
            assertEq(registry.amountRemaining(id), remaining - paid, "settle accrued exactly what the view showed");
            assertEq(registry.orgOutstanding(orgId), price - principalPaid, "principal is paid before the fee");
            assertEq(pool.outstandingPrincipal(), price - principalPaid);
            assertEq(pool.totalAssets(), POOL_CAP + (total - principalPaid), "only the fee part adds assets");
        }
        if (registry.amountRemaining(id) == 0) assertEq(uint8(_state(id)), uint8(ClaimState.Settled));
        else assertEq(uint8(_state(id)), uint8(ClaimState.Funded));
    }

    function testFuzz_settle_neverTakesMoreThanRemaining(uint256 first, uint256 second) public {
        uint256 id = _funded(FACE);
        first = bound(first, 1, FACE - 1);
        second = bound(second, 1, type(uint128).max);
        _pay(payer, id, first);
        uint256 paid = _pay(payer, id, second);
        assertEq(paid, second < FACE - first ? second : FACE - first);
        assertLe(_claim(id).amountPaid, _claim(id).amountDue);
    }

    function testFuzz_purchaseClaim_onlyBeforeExpiry(uint256 elapsed) public {
        elapsed = bound(elapsed, 0, 60 days);
        uint256 id = _approved(FACE);
        uint256 expiresAt = _claim(id).approvalExpiresAt;
        vm.warp(vm.getBlockTimestamp() + elapsed);
        if (vm.getBlockTimestamp() >= expiresAt) vm.expectRevert(ApprovalExpired.selector);
        vm.prank(claimant);
        registry.purchaseClaim(id);
        assertEq(registry.isApprovalExpired(id), vm.getBlockTimestamp() >= expiresAt);
    }

    function testFuzz_callGuarantor_overdueOnlyAfterDueDate(uint256 elapsed) public {
        elapsed = bound(elapsed, 0, 2 * uint256(OVERDUE_WINDOW));
        uint256 id = _funded(FACE);
        uint256 dueAt = _claim(id).dueAt;
        vm.warp(vm.getBlockTimestamp() + elapsed);
        assertEq(registry.isOverdue(id), vm.getBlockTimestamp() >= dueAt);
        if (vm.getBlockTimestamp() < dueAt) vm.expectRevert(NotOverdue.selector);
        _callGuarantor(id, CallReason.Overdue);
    }

    function testFuzz_callGuarantor_shortfallAnyTime(uint256 elapsed, bool rejected) public {
        elapsed = bound(elapsed, 0, 2 * uint256(OVERDUE_WINDOW));
        uint256 id = _funded(FACE);
        vm.warp(vm.getBlockTimestamp() + elapsed);
        _callGuarantor(id, rejected ? CallReason.AsucRejected : CallReason.PartialShortfall);
        assertEq(uint8(_state(id)), uint8(ClaimState.GuarantorCalled));
    }

    function testFuzz_writeOff_onlyAfterGrace(uint256 elapsed) public {
        elapsed = bound(elapsed, 0, 2 * uint256(WRITE_OFF_GRACE));
        uint256 id = _guarantorCalled(FACE);
        uint256 eligibleAt = _claim(id).writeOffEligibleAt;
        vm.warp(vm.getBlockTimestamp() + elapsed);
        if (vm.getBlockTimestamp() < eligibleAt) vm.expectRevert(WriteOffTooEarly.selector);
        vm.prank(attester);
        registry.writeOff(id);
    }

    function testFuzz_writeOff_lossEqualsUnpaidPrincipal(uint128 price, uint256 paidBefore) public {
        price = uint128(bound(price, 1, PER_CLAIM_CAP));
        uint256 id = _guarantorCalled(price);
        paidBefore = bound(paidBefore, 0, price - 1);
        if (paidBefore > 0) _pay(guarantor, id, paidBefore);
        uint256 assetsBefore = pool.totalAssets();
        _writeOff(id);
        assertEq(_claim(id).writtenOffPrincipal, price - paidBefore);
        assertEq(pool.totalLosses(), price - paidBefore);
        assertEq(pool.totalAssets(), assetsBefore - (price - paidBefore));
        assertEq(registry.orgOutstanding(orgId), 0);
    }

    function testFuzz_purchaseClaim_orgCapNeverExceeded(uint128[6] memory amounts, uint128 cap) public {
        cap = uint128(bound(cap, 1, PER_ORG_CAP));
        Params memory p = defaultParams();
        p.perOrgCap = cap;
        _setParams(p);
        for (uint256 i = 0; i < amounts.length; i++) {
            uint128 amount = uint128(bound(amounts[i], 1, PER_CLAIM_CAP));
            uint256 id = _approved(amount);
            uint256 outstandingAfter = registry.orgOutstanding(orgId) + amount;
            if (outstandingAfter > cap) {
                vm.expectRevert(abi.encodeWithSelector(OrgCapExceeded.selector, orgId, outstandingAfter, cap));
            }
            vm.prank(claimant);
            registry.purchaseClaim(id);
            assertLe(registry.orgOutstanding(orgId), cap);
        }
    }

    function testFuzz_purchaseClaim_orgCapOverrideNeverExceeded(
        uint128[8] memory amounts,
        uint128 perOrgCap,
        uint128 overrideCap
    ) public {
        Params memory p = defaultParams();
        p.perOrgCap = uint128(bound(perOrgCap, 1, PER_ORG_CAP));
        _setParams(p);
        overrideCap = uint128(bound(overrideCap, 0, 40_000e18));
        vm.prank(admin);
        registry.setOrgCap(orgId, overrideCap);
        uint256 cap = overrideCap == 0 ? p.perOrgCap : overrideCap;
        assertEq(registry.orgCap(orgId), cap);
        for (uint256 i = 0; i < amounts.length; i++) {
            uint128 amount = uint128(bound(amounts[i], 1, PER_CLAIM_CAP));
            uint256 id = _approved(amount);
            uint256 outstandingAfter = registry.orgOutstanding(orgId) + amount;
            if (outstandingAfter > cap) {
                vm.expectRevert(abi.encodeWithSelector(OrgCapExceeded.selector, orgId, outstandingAfter, cap));
            }
            vm.prank(claimant);
            registry.purchaseClaim(id);
            assertLe(registry.orgOutstanding(orgId), cap);
        }
    }

    function testFuzz_setParams_validation(Params memory p) public {
        bool valid = p.advanceRateBps <= 10_000 && p.feeBps <= 10_000 && p.perClaimCap > 0 && p.perOrgCap > 0
            && p.overdueWindow > 0 && p.approvalExpiry > 0 && p.writeOffGrace > 0;
        if (!valid) vm.expectRevert(InvalidParams.selector);
        vm.prank(admin);
        registry.setParams(p);
        if (valid) assertEq(abi.encode(registry.params()), abi.encode(p));
    }

    function testFuzz_submitClaim_rejectsForeignSigner(uint256 key) public {
        key = bound(key, 1, SECP256K1_N - 1);
        vm.assume(key != guarantorKey);
        SubmitClaimParams memory sp = _params(orgId, RecipientType.Member, guarantor, FACE, FACE);
        uint256 deadline = _deadline();
        bytes memory sig = _sign(key, claimant, sp, 0, deadline);
        vm.prank(claimant);
        vm.expectRevert(InvalidGuaranty.selector);
        registry.submitClaim(sp, deadline, sig);
    }

    function testFuzz_submitClaim_rejectsAnyTamperedField(uint8 field, uint128 delta) public {
        delta = uint128(bound(delta, 1, 1e18));
        SubmitClaimParams memory sp = _params(orgId, RecipientType.Member, guarantor, FACE, 500e18);
        uint256 deadline = _deadline();
        bytes memory sig = _sign(guarantorKey, claimant, sp, 0, deadline);
        field = uint8(bound(field, 0, 3));
        if (field == 0) sp.faceValue += delta;
        else if (field == 1) sp.requestedAmount -= delta;
        else if (field == 2) sp.packetHash = keccak256(abi.encode(sp.packetHash, delta));
        else deadline += delta;
        vm.prank(claimant);
        vm.expectRevert(InvalidGuaranty.selector);
        registry.submitClaim(sp, deadline, sig);
    }
}
