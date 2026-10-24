// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {BaseTest} from "../utils/BaseTest.sol";
import {IClaimRegistry} from "../../src/interfaces/IClaimRegistry.sol";
import {
    Params, Claim, ClaimState, RecipientType, InvalidParams, DepositsPaused, OrgNotFound
} from "../../src/libraries/ClaimTypes.sol";

/// @notice Parameters, pause, roles, and views (FR-C13, FR-C14, FR-C16).
contract ClaimRegistryAdminTest is BaseTest {
    function _expectMissingRole(address caller, bytes32 role) internal {
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, caller, role));
    }

    function _expectInvalid(Params memory p) internal {
        vm.prank(admin);
        vm.expectRevert(InvalidParams.selector);
        registry.setParams(p);
    }

    // ---------------------------------------------------------------- setParams

    function test_setParams_updatesAndEmitsOldAndNew() public {
        Params memory oldParams = defaultParams();
        Params memory newParams = Params({
            advanceRateBps: 9_000,
            feeBps: 150,
            perClaimCap: 1_000e18,
            perOrgCap: 4_000e18,
            overdueWindow: 120 days,
            approvalExpiry: 7 days,
            writeOffGrace: 30 days
        });
        vm.expectEmit(address(registry));
        emit IClaimRegistry.ParamsUpdated(oldParams, newParams);
        _setParams(newParams);
        assertEq(abi.encode(registry.params()), abi.encode(newParams));
    }

    function test_setParams_acceptsBoundaryValues() public {
        Params memory p = Params({
            advanceRateBps: 10_000,
            feeBps: 10_000,
            perClaimCap: 1,
            perOrgCap: 1,
            overdueWindow: 1,
            approvalExpiry: 1,
            writeOffGrace: 1
        });
        _setParams(p);
        assertEq(registry.params().feeBps, 10_000);
    }

    function test_setParams_acceptsZeroAdvanceRate() public {
        Params memory p = defaultParams();
        p.advanceRateBps = 0;
        _setParams(p);
        assertEq(registry.params().advanceRateBps, 0);
    }

    function test_setParams_revertsForNonAdmin() public {
        Params memory p = defaultParams();
        _expectMissingRole(underwriter, registry.DEFAULT_ADMIN_ROLE());
        vm.prank(underwriter);
        registry.setParams(p);
    }

    function test_setParams_revertsWhenAdvanceRateAboveMax() public {
        Params memory p = defaultParams();
        p.advanceRateBps = 10_001;
        _expectInvalid(p);
    }

    function test_setParams_revertsWhenFeeAboveMax() public {
        Params memory p = defaultParams();
        p.feeBps = 10_001;
        _expectInvalid(p);
    }

    function test_setParams_revertsOnZeroPerClaimCap() public {
        Params memory p = defaultParams();
        p.perClaimCap = 0;
        _expectInvalid(p);
    }

    function test_setParams_revertsOnZeroPerOrgCap() public {
        Params memory p = defaultParams();
        p.perOrgCap = 0;
        _expectInvalid(p);
    }

    function test_setParams_revertsOnZeroOverdueWindow() public {
        Params memory p = defaultParams();
        p.overdueWindow = 0;
        _expectInvalid(p);
    }

    function test_setParams_revertsOnZeroApprovalExpiry() public {
        Params memory p = defaultParams();
        p.approvalExpiry = 0;
        _expectInvalid(p);
    }

    function test_setParams_revertsOnZeroWriteOffGrace() public {
        Params memory p = defaultParams();
        p.writeOffGrace = 0;
        _expectInvalid(p);
    }

    function test_setParams_worksWhilePaused() public {
        vm.prank(pauser);
        registry.pause();
        _setFee(10);
        assertEq(registry.params().feeBps, 10);
    }

    // ---------------------------------------------------------------- setOrgCap

    function test_setOrgCap_overridesAndEmits() public {
        vm.expectEmit(address(registry));
        emit IClaimRegistry.OrgCapSet(orgId, 0, 50_000e18);
        vm.prank(admin);
        registry.setOrgCap(orgId, 50_000e18);
        assertEq(registry.orgCap(orgId), 50_000e18);
        assertEq(registry.orgCapOverride(orgId), 50_000e18);
        assertEq(registry.orgCap(org2Id), PER_ORG_CAP, "other orgs stay on perOrgCap");
    }

    function test_setOrgCap_zeroClearsTheOverride() public {
        vm.startPrank(admin);
        registry.setOrgCap(orgId, 50_000e18);
        vm.expectEmit(address(registry));
        emit IClaimRegistry.OrgCapSet(orgId, 50_000e18, 0);
        registry.setOrgCap(orgId, 0);
        vm.stopPrank();
        assertEq(registry.orgCap(orgId), PER_ORG_CAP);
        assertEq(registry.orgCapOverride(orgId), 0);
    }

    function test_setOrgCap_overrideSurvivesSetParams() public {
        vm.prank(admin);
        registry.setOrgCap(orgId, 50_000e18);
        Params memory p = defaultParams();
        p.perOrgCap = 5_000e18;
        _setParams(p);
        assertEq(registry.orgCap(orgId), 50_000e18);
        assertEq(registry.orgCap(org2Id), 5_000e18);
    }

    function test_setOrgCap_canBeBelowPerOrgCap() public {
        vm.prank(admin);
        registry.setOrgCap(orgId, 1_000e18);
        assertEq(registry.orgCap(orgId), 1_000e18);
    }

    function test_setOrgCap_revertsForUnknownOrg() public {
        uint64 next = orgs.orgCount() + 1;
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(OrgNotFound.selector, next));
        registry.setOrgCap(next, 1);
        vm.expectRevert(abi.encodeWithSelector(OrgNotFound.selector, uint64(0)));
        registry.setOrgCap(0, 1);
        vm.stopPrank();
    }

    function test_setOrgCap_revertsForNonAdmin() public {
        _expectMissingRole(underwriter, registry.DEFAULT_ADMIN_ROLE());
        vm.prank(underwriter);
        registry.setOrgCap(orgId, 1);
    }

    // ---------------------------------------------------------------- pause

    function test_pause_blocksSubmitApprovePurchaseAndDeposit() public {
        _seedPool(SEED);
        uint256 submitted = _submitDefault();
        uint256 approved = _approved(FACE);

        vm.expectEmit(address(registry));
        emit Pausable.Paused(pauser);
        vm.prank(pauser);
        registry.pause();
        assertTrue(registry.paused());

        vm.prank(underwriter);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        registry.approveClaim(submitted, FACE);

        vm.prank(claimant);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        registry.purchaseClaim(approved);

        vm.prank(lender);
        vm.expectRevert(DepositsPaused.selector);
        pool.deposit(1, lender);

        uint256 deadline = _deadline();
        vm.prank(claimant);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        registry.submitClaim(_params(orgId, RecipientType.Member, guarantor, FACE, FACE), deadline, "");
    }

    function test_pause_revertsForNonPauser() public {
        _expectMissingRole(outsider, registry.PAUSER_ROLE());
        vm.prank(outsider);
        registry.pause();
    }

    function test_pause_revertsForAdminWithoutPauserRole() public {
        _expectMissingRole(admin, registry.PAUSER_ROLE());
        vm.prank(admin);
        registry.pause();
    }

    function test_pause_revertsWhenAlreadyPaused() public {
        vm.startPrank(pauser);
        registry.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        registry.pause();
        vm.stopPrank();
    }

    function test_unpause_onlyAdmin() public {
        vm.prank(pauser);
        registry.pause();
        _expectMissingRole(pauser, registry.DEFAULT_ADMIN_ROLE());
        vm.prank(pauser);
        registry.unpause();
    }

    function test_unpause_restoresActivity() public {
        vm.prank(pauser);
        registry.pause();
        vm.expectEmit(address(registry));
        emit Pausable.Unpaused(admin);
        vm.prank(admin);
        registry.unpause();
        assertFalse(registry.paused());
        _funded(FACE);
    }

    function test_unpause_revertsWhenNotPaused() public {
        vm.prank(admin);
        vm.expectRevert(Pausable.ExpectedPause.selector);
        registry.unpause();
    }

    // ---------------------------------------------------------------- roles

    function test_roles_areDistinctConstants() public view {
        assertEq(registry.UNDERWRITER_ROLE(), keccak256("UNDERWRITER_ROLE"));
        assertEq(registry.ATTESTER_ROLE(), keccak256("ATTESTER_ROLE"));
        assertEq(registry.PAUSER_ROLE(), keccak256("PAUSER_ROLE"));
        assertEq(registry.DEFAULT_ADMIN_ROLE(), bytes32(0));
    }

    function test_roles_adminHoldsNoOperationalRolesByDefault() public view {
        assertFalse(registry.hasRole(registry.UNDERWRITER_ROLE(), admin));
        assertFalse(registry.hasRole(registry.ATTESTER_ROLE(), admin));
        assertFalse(registry.hasRole(registry.PAUSER_ROLE(), admin));
    }

    function test_roles_adminCanGrantAndRevoke() public {
        bytes32 role = registry.UNDERWRITER_ROLE();
        vm.prank(admin);
        registry.grantRole(role, admin);
        assertTrue(registry.hasRole(role, admin));
        vm.prank(admin);
        registry.revokeRole(role, underwriter);
        assertFalse(registry.hasRole(role, underwriter));
    }

    function test_roles_nonAdminCannotGrant() public {
        bytes32 role = registry.UNDERWRITER_ROLE();
        _expectMissingRole(underwriter, registry.DEFAULT_ADMIN_ROLE());
        vm.prank(underwriter);
        registry.grantRole(role, outsider);
    }

    // ---------------------------------------------------------------- views

    function test_getClaim_emptyForUnknownId() public view {
        Claim memory c = registry.getClaim(99);
        assertEq(c.id, 0);
        assertEq(uint8(c.state), uint8(ClaimState.None));
        assertEq(c.recipient, address(0));
    }

    function test_orgOutstanding_zeroForUnknownOrg() public view {
        assertEq(registry.orgOutstanding(55), 0);
    }

    function test_isPacketUsed_falseUntilSubmitted() public {
        uint256 id = _submitDefault();
        assertTrue(registry.isPacketUsed(_claim(id).packetHash));
        assertFalse(registry.isPacketUsed(keccak256("never")));
    }

    function test_supportsInterface_accessControl() public view {
        assertTrue(registry.supportsInterface(type(IAccessControl).interfaceId));
    }
}
