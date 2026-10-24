// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {OrgRegistry} from "../../src/OrgRegistry.sol";
import {IOrgRegistry} from "../../src/interfaces/IOrgRegistry.sol";
import {ZeroAddress, OrgNotFound, EmptyOrgName} from "../../src/libraries/ClaimTypes.sol";

contract OrgRegistryTest is Test {
    OrgRegistry internal orgs;
    address internal admin = makeAddr("admin");
    address internal officer = makeAddr("officer");
    address internal outsider = makeAddr("outsider");

    function setUp() public {
        orgs = new OrgRegistry(admin);
    }

    function _add(string memory name) internal returns (uint64) {
        vm.prank(admin);
        return orgs.addOrg(name);
    }

    function _expectNotAdmin(address caller) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, caller, orgs.DEFAULT_ADMIN_ROLE()
            )
        );
    }

    function test_constructor_grantsAdmin() public view {
        assertTrue(orgs.hasRole(orgs.DEFAULT_ADMIN_ROLE(), admin));
        assertEq(orgs.orgCount(), 0);
    }

    function test_constructor_revertsOnZeroAdmin() public {
        vm.expectRevert(ZeroAddress.selector);
        new OrgRegistry(address(0));
    }

    function test_addOrg_assignsSequentialIdsFromOne() public {
        assertEq(_add("Blockchain at Berkeley"), 1);
        assertEq(_add("Cal Rocketry"), 2);
        assertEq(orgs.orgCount(), 2);
        assertEq(orgs.orgName(1), "Blockchain at Berkeley");
        assertEq(orgs.orgName(2), "Cal Rocketry");
    }

    function test_addOrg_startsActiveAndEmitsEvents() public {
        vm.expectEmit(address(orgs));
        emit IOrgRegistry.OrgAdded(1, "Blockchain at Berkeley");
        vm.expectEmit(address(orgs));
        emit IOrgRegistry.OrgActiveSet(1, true);
        uint64 id = _add("Blockchain at Berkeley");
        assertTrue(orgs.isActiveOrg(id));
    }

    function test_addOrg_revertsOnEmptyName() public {
        vm.prank(admin);
        vm.expectRevert(EmptyOrgName.selector);
        orgs.addOrg("");
    }

    function test_addOrg_revertsForNonAdmin() public {
        _expectNotAdmin(outsider);
        vm.prank(outsider);
        orgs.addOrg("Nope");
    }

    function test_setOrgActive_deactivatesAndReactivates() public {
        uint64 id = _add("Blockchain at Berkeley");
        vm.expectEmit(address(orgs));
        emit IOrgRegistry.OrgActiveSet(id, false);
        vm.prank(admin);
        orgs.setOrgActive(id, false);
        assertFalse(orgs.isActiveOrg(id));

        vm.prank(admin);
        orgs.setOrgActive(id, true);
        assertTrue(orgs.isActiveOrg(id));
    }

    function test_setOrgActive_revertsForUnknownOrg() public {
        _add("Blockchain at Berkeley");
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(OrgNotFound.selector, uint64(0)));
        orgs.setOrgActive(0, true);
        vm.expectRevert(abi.encodeWithSelector(OrgNotFound.selector, uint64(2)));
        orgs.setOrgActive(2, true);
        vm.stopPrank();
    }

    function test_setOrgActive_revertsForNonAdmin() public {
        uint64 id = _add("Blockchain at Berkeley");
        _expectNotAdmin(outsider);
        vm.prank(outsider);
        orgs.setOrgActive(id, false);
    }

    function test_setOfficer_setsAndClears() public {
        uint64 id = _add("Blockchain at Berkeley");
        vm.expectEmit(address(orgs));
        emit IOrgRegistry.OfficerSet(id, officer, true);
        vm.prank(admin);
        orgs.setOfficer(id, officer, true);
        assertTrue(orgs.isActiveOfficer(id, officer));

        vm.expectEmit(address(orgs));
        emit IOrgRegistry.OfficerSet(id, officer, false);
        vm.prank(admin);
        orgs.setOfficer(id, officer, false);
        assertFalse(orgs.isActiveOfficer(id, officer));
    }

    function test_setOfficer_revertsForUnknownOrg() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(OrgNotFound.selector, uint64(1)));
        orgs.setOfficer(1, officer, true);
    }

    function test_setOfficer_revertsOnZeroAddress() public {
        uint64 id = _add("Blockchain at Berkeley");
        vm.prank(admin);
        vm.expectRevert(ZeroAddress.selector);
        orgs.setOfficer(id, address(0), true);
    }

    function test_setOfficer_revertsForNonAdmin() public {
        uint64 id = _add("Blockchain at Berkeley");
        _expectNotAdmin(officer);
        vm.prank(officer);
        orgs.setOfficer(id, officer, true);
    }

    function test_isActiveOrg_falseForUnknownOrg() public view {
        assertFalse(orgs.isActiveOrg(0));
        assertFalse(orgs.isActiveOrg(7));
    }

    function test_isActiveOfficer_scopedToOrg() public {
        uint64 a = _add("Blockchain at Berkeley");
        uint64 b = _add("Cal Rocketry");
        vm.prank(admin);
        orgs.setOfficer(a, officer, true);
        assertTrue(orgs.isActiveOfficer(a, officer));
        assertFalse(orgs.isActiveOfficer(b, officer));
    }

    function test_isActiveOfficer_ignoresOrgStatus() public {
        uint64 id = _add("Blockchain at Berkeley");
        vm.startPrank(admin);
        orgs.setOfficer(id, officer, true);
        orgs.setOrgActive(id, false);
        vm.stopPrank();
        assertTrue(orgs.isActiveOfficer(id, officer));
    }

    function test_orgName_revertsForUnknownOrg() public {
        vm.expectRevert(abi.encodeWithSelector(OrgNotFound.selector, uint64(1)));
        orgs.orgName(1);
    }
}
