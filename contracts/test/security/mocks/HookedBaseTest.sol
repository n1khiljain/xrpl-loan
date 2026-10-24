// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BaseTest} from "../../utils/BaseTest.sol";
import {ClaimRegistry} from "../../../src/ClaimRegistry.sol";
import {ReceivablesPool} from "../../../src/ReceivablesPool.sol";
import {ClaimNFT} from "../../../src/ClaimNFT.sol";
import {OrgRegistry} from "../../../src/OrgRegistry.sol";
import {HookedToken} from "./HookedToken.sol";

/// @notice `BaseTest` wiring and helpers, deployed over a `HookedToken` instead of the plain mock.
abstract contract HookedBaseTest is BaseTest {
    HookedToken internal hooked;

    function setUp() public virtual override {
        vm.warp(START_TIME);
        (guarantor, guarantorKey) = makeAddrAndKey("guarantor");
        (guarantor2, guarantor2Key) = makeAddrAndKey("guarantor2");

        hooked = new HookedToken();
        frxUSD = hooked;
        orgs = new OrgRegistry(admin);
        nft = new ClaimNFT(admin);
        pool = new ReceivablesPool(IERC20(address(frxUSD)), admin);
        registry = new ClaimRegistry(admin, pool, nft, orgs, defaultParams());

        vm.startPrank(admin);
        pool.setRegistry(address(registry));
        nft.setRegistry(address(registry));
        pool.setDepositCap(POOL_CAP);
        pool.setLenderAllowed(lender, true);
        registry.grantRole(registry.UNDERWRITER_ROLE(), underwriter);
        registry.grantRole(registry.ATTESTER_ROLE(), attester);
        registry.grantRole(registry.PAUSER_ROLE(), pauser);
        orgId = orgs.addOrg("Blockchain at Berkeley");
        orgs.setOfficer(orgId, guarantor, true);
        orgs.setOfficer(orgId, guarantor2, true);
        orgs.setOfficer(orgId, treasurer, true);
        org2Id = orgs.addOrg("Cal Rocketry");
        orgs.setOfficer(org2Id, guarantor2, true);
        vm.stopPrank();

        vm.label(address(frxUSD), "HookedToken");
        vm.label(address(pool), "ReceivablesPool");
        vm.label(address(registry), "ClaimRegistry");
    }
}
