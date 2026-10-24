// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {BaseTest} from "../utils/BaseTest.sol";
import {
    Params,
    Claim,
    ClaimState,
    RecipientType,
    InvalidState,
    NotRecipient,
    ApprovalExpired,
    OrgInactive,
    OrgCapExceeded,
    InsufficientIdleCash
} from "../../src/libraries/ClaimTypes.sol";

/// @notice Revert paths and edge cases for purchaseClaim (FR-C9, FR-C10, FR-C14).
contract ClaimRegistryPurchaseTest is BaseTest {
    function setUp() public override {
        super.setUp();
        _seedPool(POOL_CAP);
    }

    function _buy(uint256 id, bytes memory err) internal {
        vm.prank(claimant);
        vm.expectRevert(err);
        registry.purchaseClaim(id);
    }

    function test_purchaseClaim_snapshotsTheRateAndStartsWithNoFee() public {
        _setFee(1000);
        uint256 id = _approved(FACE);
        _purchase(id);
        Claim memory c = _claim(id);
        assertEq(c.amountDue, FACE, "nothing has accrued at purchase");
        assertEq(c.feeBps, 1000);
        assertEq(c.feeAccruedAt, vm.getBlockTimestamp());
        assertEq(registry.amountRemaining(id), FACE);
    }

    function test_amountRemaining_accruesTheAnnualRateOnUnpaidPrincipal() public {
        _setFee(1000);
        uint256 id = _funded(FACE);
        vm.warp(vm.getBlockTimestamp() + 365 days);
        assertEq(registry.amountRemaining(id), FACE + 100e18, "10% a year on 1,000 for a year");
        assertEq(_claim(id).amountDue, FACE, "stored amount due only moves when the claim is touched");
        vm.warp(vm.getBlockTimestamp() + 365 days / 2);
        assertEq(registry.amountRemaining(id), FACE + 150e18);
    }

    function test_amountRemaining_feeRoundsUpInThePoolsFavor() public {
        _setFee(3);
        uint128 price = 1000e18 + 1;
        uint256 id = _funded(price);
        vm.warp(vm.getBlockTimestamp() + 1);
        // 3 bps a year for one second on 1,000 frxUSD is 9.5e10 wei and a fraction, which rounds up
        uint256 exact = uint256(price) * 3;
        uint256 denominator = uint256(10_000) * 365 days;
        assertEq(registry.amountRemaining(id), price + (exact + denominator - 1) / denominator);
    }

    function test_purchaseClaim_keepsTermsAfterParamsChange() public {
        _setFee(100);
        uint256 id = _approved(FACE);
        _purchase(id);
        Claim memory before = _claim(id);

        Params memory p = defaultParams();
        p.feeBps = 900;
        p.overdueWindow = 30 days;
        p.perOrgCap = 1;
        _setParams(p);

        Claim memory afterChange = _claim(id);
        assertEq(afterChange.feeBps, 100);
        assertEq(afterChange.dueAt, before.dueAt);
        vm.warp(vm.getBlockTimestamp() + 365 days);
        assertEq(registry.amountRemaining(id), FACE + 10e18, "the 1% rate it was bought at, not the new 9%");
        _pay(claimant, id, FACE + 10e18);
        assertEq(uint8(_state(id)), uint8(ClaimState.Settled));
    }

    function test_purchaseClaim_revertsWhenPaused() public {
        uint256 id = _approved(FACE);
        vm.prank(pauser);
        registry.pause();
        _buy(id, abi.encodeWithSelector(Pausable.EnforcedPause.selector));
    }

    function test_purchaseClaim_revertsForNonRecipient() public {
        uint256 id = _approved(FACE);
        vm.prank(guarantor);
        vm.expectRevert(NotRecipient.selector);
        registry.purchaseClaim(id);
    }

    function test_purchaseClaim_revertsWhenSubmitted() public {
        uint256 id = _submitDefault();
        _buy(id, abi.encodeWithSelector(InvalidState.selector, id, ClaimState.Submitted));
    }

    function test_purchaseClaim_revertsWhenAlreadyFunded() public {
        uint256 id = _funded(FACE);
        _buy(id, abi.encodeWithSelector(InvalidState.selector, id, ClaimState.Funded));
    }

    function test_purchaseClaim_succeedsOneSecondBeforeExpiry() public {
        uint256 id = _approved(FACE);
        vm.warp(_claim(id).approvalExpiresAt - 1);
        assertFalse(registry.isApprovalExpired(id));
        _purchase(id);
        assertEq(uint8(_state(id)), uint8(ClaimState.Funded));
    }

    function test_purchaseClaim_revertsAtApprovalExpiry() public {
        uint256 id = _approved(FACE);
        vm.warp(_claim(id).approvalExpiresAt);
        assertTrue(registry.isApprovalExpired(id));
        _buy(id, abi.encodeWithSelector(ApprovalExpired.selector));
    }

    function test_purchaseClaim_worksAfterReapproval() public {
        uint256 id = _approved(FACE);
        vm.warp(_claim(id).approvalExpiresAt + 1 days);
        _buy(id, abi.encodeWithSelector(ApprovalExpired.selector));
        _approve(id, FACE);
        _purchase(id);
        assertEq(uint8(_state(id)), uint8(ClaimState.Funded));
    }

    function test_purchaseClaim_revertsWhenOrgInactive() public {
        uint256 id = _approved(FACE);
        vm.prank(admin);
        orgs.setOrgActive(orgId, false);
        _buy(id, abi.encodeWithSelector(OrgInactive.selector, orgId));
    }

    function test_purchaseClaim_fillsOrgCapExactly() public {
        for (uint256 i = 0; i < 4; i++) {
            _purchase(_approved(PER_CLAIM_CAP));
        }
        assertEq(registry.orgOutstanding(orgId), PER_ORG_CAP);
    }

    function test_purchaseClaim_revertsWhenOrgCapExceeded() public {
        for (uint256 i = 0; i < 4; i++) {
            _purchase(_approved(PER_CLAIM_CAP));
        }
        uint256 id = _approved(1);
        _buy(id, abi.encodeWithSelector(OrgCapExceeded.selector, orgId, PER_ORG_CAP + 1, PER_ORG_CAP));
    }

    function test_purchaseClaim_orgCapIsPerOrg() public {
        for (uint256 i = 0; i < 4; i++) {
            _purchase(_approved(PER_CLAIM_CAP));
        }
        // guarantor2 is an officer of org 2, which has its own room under the cap
        uint256 id =
            _submitWith(claimant, _params(org2Id, RecipientType.Member, guarantor2, FACE, FACE), guarantor2Key);
        _approve(id, FACE);
        _purchase(id);
        assertEq(registry.orgOutstanding(org2Id), FACE);
    }

    function test_purchaseClaim_loweredOrgCapBlocksNewPurchasesOnly() public {
        uint256 first = _approved(PER_CLAIM_CAP);
        _purchase(first);
        uint256 second = _approved(FACE);

        Params memory p = defaultParams();
        p.perOrgCap = 1_000e18;
        _setParams(p);

        _buy(second, abi.encodeWithSelector(OrgCapExceeded.selector, orgId, PER_CLAIM_CAP + FACE, 1_000e18));
        assertEq(uint8(_state(first)), uint8(ClaimState.Funded), "claims already purchased are unaffected");

        _pay(claimant, first, PER_CLAIM_CAP);
        _purchase(second);
    }

    function test_purchaseClaim_usesTheOrgOverride() public {
        vm.prank(admin);
        registry.setOrgCap(orgId, 20_000e18);
        for (uint256 i = 0; i < 8; i++) {
            _purchase(_approved(PER_CLAIM_CAP));
        }
        assertEq(registry.orgOutstanding(orgId), 20_000e18);
        uint256 id = _approved(1);
        _buy(id, abi.encodeWithSelector(OrgCapExceeded.selector, orgId, 20_000e18 + 1, 20_000e18));
    }

    function test_purchaseClaim_overrideDoesNotRaiseOtherOrgs() public {
        vm.prank(admin);
        registry.setOrgCap(orgId, 20_000e18);
        for (uint256 i = 0; i < 4; i++) {
            _purchase(_approvedFor(org2Id, guarantor2, guarantor2Key, PER_CLAIM_CAP));
        }
        uint256 id = _approvedFor(org2Id, guarantor2, guarantor2Key, 1);
        _buy(id, abi.encodeWithSelector(OrgCapExceeded.selector, org2Id, PER_ORG_CAP + 1, PER_ORG_CAP));
    }

    function test_purchaseClaim_loweredOverrideBlocksNewPurchasesOnly() public {
        uint256 first = _approved(PER_CLAIM_CAP);
        _purchase(first);
        uint256 second = _approved(FACE);
        vm.prank(admin);
        registry.setOrgCap(orgId, 1_000e18);
        _buy(second, abi.encodeWithSelector(OrgCapExceeded.selector, orgId, PER_CLAIM_CAP + FACE, 1_000e18));
        assertEq(uint8(_state(first)), uint8(ClaimState.Funded), "claims already purchased are unaffected");
    }

    function _approvedFor(uint64 org, address g, uint256 gKey, uint128 amount) internal returns (uint256 id) {
        id = _submitWith(claimant, _params(org, RecipientType.Member, g, amount, amount), gKey);
        _approve(id, amount);
    }

    function test_purchaseClaim_revertsWhenIdleCashShort() public {
        uint256 id = _approved(PER_CLAIM_CAP);
        vm.prank(lender);
        pool.withdraw(POOL_CAP - 1000e18, lender, lender);
        _buy(id, abi.encodeWithSelector(InsufficientIdleCash.selector, PER_CLAIM_CAP, 1000e18));
    }

    function test_purchaseClaim_doesNotRecheckPerClaimCap() public {
        uint256 id = _approved(PER_CLAIM_CAP);
        Params memory p = defaultParams();
        p.perClaimCap = 100e18;
        _setParams(p);
        // UNCERTAIN: U-43
        _purchase(id);
        assertEq(_claim(id).purchasePrice, PER_CLAIM_CAP);
    }

    function test_purchaseClaim_usesOverdueWindowAtPurchaseTime() public {
        uint256 id = _approved(FACE);
        Params memory p = defaultParams();
        p.overdueWindow = 90 days;
        _setParams(p);
        _purchase(id);
        assertEq(_claim(id).dueAt, vm.getBlockTimestamp() + 90 days);
    }

    function test_isApprovalExpired_falseOutsideApproved() public {
        uint256 id = _funded(FACE);
        vm.warp(vm.getBlockTimestamp() + 365 days);
        assertFalse(registry.isApprovalExpired(id));
        assertFalse(registry.isApprovalExpired(999));
    }
}
