// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {BaseTest} from "../utils/BaseTest.sol";
import {
    Params,
    ClaimState,
    NotRecipient,
    InvalidState,
    ZeroAmount,
    AmountExceedsLimit,
    MissingReasonCode
} from "../../src/libraries/ClaimTypes.sol";

/// @notice Revert paths and edge cases for cancelClaim, approveClaim, and rejectClaim.
contract ClaimRegistryReviewTest is BaseTest {
    function _expectMissingRole(address caller, bytes32 role) internal {
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, caller, role));
    }

    // ---------------------------------------------------------------- cancel

    function test_cancelClaim_worksWhilePaused() public {
        uint256 id = _submitDefault();
        vm.prank(pauser);
        registry.pause();
        vm.prank(claimant);
        registry.cancelClaim(id);
        assertEq(uint8(_state(id)), uint8(ClaimState.Cancelled));
    }

    function test_cancelClaim_revertsForNonRecipient() public {
        uint256 id = _submitDefault();
        vm.prank(guarantor);
        vm.expectRevert(NotRecipient.selector);
        registry.cancelClaim(id);
    }

    function test_cancelClaim_revertsAfterApproval() public {
        uint256 id = _approved(FACE);
        vm.prank(claimant);
        vm.expectRevert(abi.encodeWithSelector(InvalidState.selector, id, ClaimState.Approved));
        registry.cancelClaim(id);
    }

    function test_cancelClaim_revertsForUnknownClaim() public {
        vm.prank(claimant);
        vm.expectRevert(abi.encodeWithSelector(InvalidState.selector, 42, ClaimState.None));
        registry.cancelClaim(42);
    }

    // ---------------------------------------------------------------- approve

    function test_approveClaim_lowerThanRequested() public {
        uint256 id = _submitDefault();
        _approve(id, 1);
        assertEq(_claim(id).approvedAmount, 1);
    }

    function test_approveClaim_revertsWhenPaused() public {
        uint256 id = _submitDefault();
        vm.prank(pauser);
        registry.pause();
        vm.prank(underwriter);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        registry.approveClaim(id, FACE);
    }

    function test_approveClaim_revertsForNonUnderwriter() public {
        uint256 id = _submitDefault();
        _expectMissingRole(attester, registry.UNDERWRITER_ROLE());
        vm.prank(attester);
        registry.approveClaim(id, FACE);
    }

    function test_approveClaim_revertsForAdminWithoutUnderwriterRole() public {
        uint256 id = _submitDefault();
        _expectMissingRole(admin, registry.UNDERWRITER_ROLE());
        vm.prank(admin);
        registry.approveClaim(id, FACE);
    }

    function test_approveClaim_revertsOnZeroAmount() public {
        uint256 id = _submitDefault();
        vm.prank(underwriter);
        vm.expectRevert(ZeroAmount.selector);
        registry.approveClaim(id, 0);
    }

    function test_approveClaim_revertsAboveRequested() public {
        uint256 id = _submit(FACE, 600e18);
        vm.prank(underwriter);
        vm.expectRevert(abi.encodeWithSelector(AmountExceedsLimit.selector, 600e18 + 1, 600e18));
        registry.approveClaim(id, 600e18 + 1);
    }

    function test_approveClaim_revertsAbovePerClaimCapLoweredAfterSubmit() public {
        uint256 id = _submit(2_000e18, 2_000e18);
        Params memory p = defaultParams();
        p.perClaimCap = 1_500e18;
        _setParams(p);
        vm.prank(underwriter);
        vm.expectRevert(abi.encodeWithSelector(AmountExceedsLimit.selector, 2_000e18, 1_500e18));
        registry.approveClaim(id, 2_000e18);
        _approve(id, 1_500e18);
    }

    function test_approveClaim_usesApprovalExpiryAtApprovalTime() public {
        uint256 id = _submitDefault();
        Params memory p = defaultParams();
        p.approvalExpiry = 3 days;
        _setParams(p);
        _approve(id, FACE);
        assertEq(_claim(id).approvalExpiresAt, vm.getBlockTimestamp() + 3 days);
    }

    function test_approveClaim_revertsForUnknownClaim() public {
        vm.prank(underwriter);
        vm.expectRevert(abi.encodeWithSelector(InvalidState.selector, 5, ClaimState.None));
        registry.approveClaim(5, FACE);
    }

    function test_approveClaim_revertsWhenFunded() public {
        uint256 id = _funded(FACE);
        vm.prank(underwriter);
        vm.expectRevert(abi.encodeWithSelector(InvalidState.selector, id, ClaimState.Funded));
        registry.approveClaim(id, FACE);
    }

    // ---------------------------------------------------------------- reject

    function test_rejectClaim_worksWhilePaused() public {
        uint256 id = _submitDefault();
        vm.prank(pauser);
        registry.pause();
        vm.prank(underwriter);
        registry.rejectClaim(id, REASON);
        assertEq(uint8(_state(id)), uint8(ClaimState.Rejected));
    }

    function test_rejectClaim_revertsWithoutReasonCode() public {
        uint256 id = _submitDefault();
        vm.prank(underwriter);
        vm.expectRevert(MissingReasonCode.selector);
        registry.rejectClaim(id, bytes32(0));
    }

    function test_rejectClaim_revertsForNonUnderwriter() public {
        uint256 id = _submitDefault();
        _expectMissingRole(admin, registry.UNDERWRITER_ROLE());
        vm.prank(admin);
        registry.rejectClaim(id, REASON);
    }

    function test_rejectClaim_revertsWhenFunded() public {
        uint256 id = _funded(FACE);
        vm.prank(underwriter);
        vm.expectRevert(abi.encodeWithSelector(InvalidState.selector, id, ClaimState.Funded));
        registry.rejectClaim(id, REASON);
    }

    function test_rejectClaim_expiredApprovalCanBeRejected() public {
        uint256 id = _approved(FACE);
        vm.warp(_claim(id).approvalExpiresAt);
        vm.prank(underwriter);
        registry.rejectClaim(id, "OTHER");
        assertEq(uint8(_state(id)), uint8(ClaimState.Rejected));
    }
}
