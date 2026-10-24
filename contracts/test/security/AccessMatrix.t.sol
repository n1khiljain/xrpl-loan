// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20Errors, IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {BaseTest} from "../utils/BaseTest.sol";
import {IClaimRegistry} from "../../src/interfaces/IClaimRegistry.sol";
import {IReceivablesPool} from "../../src/interfaces/IReceivablesPool.sol";
import {IClaimNFT} from "../../src/interfaces/IClaimNFT.sol";
import {IOrgRegistry} from "../../src/interfaces/IOrgRegistry.sol";
import {
    CallReason,
    RecipientType,
    SubmitClaimParams,
    OnlyRegistry,
    NotRecipient,
    LenderNotAllowed,
    RegistryAlreadySet,
    EmergencyModeInactive,
    GuarantorIsRecipient,
    TransfersDisabled,
    ZeroAmount
} from "../../src/libraries/ClaimTypes.sol";

/// @notice Workstream B3/B4: who can call every state-changing entry point.
contract AccessMatrixTest is BaseTest {
    uint256 internal constant ROLES = 10;
    uint16 internal constant ALL = uint16((1 << ROLES) - 1);
    uint16 internal constant ADMIN = 1 << 0;
    uint16 internal constant UNDERWRITER = 1 << 1;
    uint16 internal constant ATTESTER = 1 << 2;
    uint16 internal constant PAUSER = 1 << 3;
    uint16 internal constant REGISTRY = 1 << 4;
    uint16 internal constant CLAIMANT = 1 << 5;
    uint16 internal constant GUARANTOR = 1 << 6;
    uint16 internal constant LENDER = 1 << 7;
    uint16 internal constant OUTSIDER = 1 << 8;
    uint16 internal constant NONE = 0;
    /// @dev A 32-byte word equal to this address in an entry's calldata is replaced by the caller.
    address internal constant SELF = address(uint160(uint256(keccak256("SELF"))));
    uint128 internal constant PRICE = 2500e18;

    struct Entry {
        string name;
        address target;
        bytes data;
        uint16 allowed;
        // what an allowed caller gets: 0 means success, else the (non-auth) error it reverts with
        bytes4 allowedOutcome;
        // what every other caller reverts with
        bytes4 denial;
        // calldata is a submitClaim with a guaranty signed for the caller
        bool submit;
    }

    Entry[] internal entries;
    address[ROLES] internal roles;
    string[ROLES] internal roleNames;

    uint256 internal idSubmitted;
    uint256 internal idApproved;
    uint256 internal idFunded;
    uint256 internal idCalled;

    function setUp() public override {
        super.setUp();
        roles = [
            admin,
            underwriter,
            attester,
            pauser,
            address(registry),
            claimant,
            guarantor,
            lender,
            outsider,
            address(this)
        ];
        roleNames = [
            "admin",
            "underwriter",
            "attester",
            "pauser",
            "registry",
            "claimant",
            "guarantor",
            "lender",
            "outsider",
            "deployer"
        ];

        _seedPool(SEED);
        idCalled = _guarantorCalled(PRICE);
        idFunded = _funded(FACE);
        vm.warp(_claim(idCalled).writeOffEligibleAt);
        idSubmitted = _submitDefault();
        idApproved = _approved(FACE);

        for (uint256 i; i < ROLES; ++i) {
            frxUSD.mint(roles[i], 10_000e18);
            vm.startPrank(roles[i]);
            frxUSD.approve(address(registry), type(uint256).max);
            frxUSD.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
        _buildTable();
    }

    function _add(string memory name, address target, bytes memory data, uint16 allowed, bytes4 outcome, bytes4 denial)
        internal
    {
        entries.push(Entry(name, target, data, allowed, outcome, denial, false));
    }

    function _buildTable() internal {
        bytes4 unauthorized = IAccessControl.AccessControlUnauthorizedAccount.selector;
        bytes4 badConfirm = IAccessControl.AccessControlBadConfirmation.selector;
        bytes32 anyRole = keccak256("ANY_ROLE");
        address p = address(pool);
        address r = address(registry);
        address n = address(nft);
        address o = address(orgs);

        // ---- ReceivablesPool
        _add(
            "pool.setRegistry",
            p,
            abi.encodeCall(pool.setRegistry, (outsider)),
            ADMIN,
            RegistryAlreadySet.selector,
            unauthorized
        );
        _add(
            "pool.setLenderAllowed", p, abi.encodeCall(pool.setLenderAllowed, (outsider, true)), ADMIN, 0, unauthorized
        );
        _add("pool.setAllowlistEnabled", p, abi.encodeCall(pool.setAllowlistEnabled, (false)), ADMIN, 0, unauthorized);
        _add("pool.setDepositCap", p, abi.encodeCall(pool.setDepositCap, (1)), ADMIN, 0, unauthorized);
        _add("pool.activateEmergencyMode", p, abi.encodeCall(pool.activateEmergencyMode, ()), ADMIN, 0, unauthorized);
        _add(
            "pool.emergencyWithdraw",
            p,
            abi.encodeCall(pool.emergencyWithdraw, (SELF)),
            ALL,
            EmergencyModeInactive.selector,
            0
        );
        _add(
            "pool.fundPurchase", p, abi.encodeCall(pool.fundPurchase, (outsider, 1)), REGISTRY, 0, OnlyRegistry.selector
        );
        _add(
            "pool.recordPrincipalReturned",
            p,
            abi.encodeCall(pool.recordPrincipalReturned, (1)),
            REGISTRY,
            0,
            OnlyRegistry.selector
        );
        _add("pool.realizeLoss", p, abi.encodeCall(pool.realizeLoss, (1)), REGISTRY, 0, OnlyRegistry.selector);
        _add("pool.deposit", p, abi.encodeCall(pool.deposit, (1e18, SELF)), LENDER, 0, LenderNotAllowed.selector);
        _add("pool.mint", p, abi.encodeCall(pool.mint, (1e18, SELF)), LENDER, 0, LenderNotAllowed.selector);
        _add(
            "pool.withdraw",
            p,
            abi.encodeCall(pool.withdraw, (1e18, SELF, lender)),
            LENDER,
            0,
            IERC20Errors.ERC20InsufficientAllowance.selector
        );
        _add(
            "pool.redeem",
            p,
            abi.encodeCall(pool.redeem, (1e18, SELF, lender)),
            LENDER,
            0,
            IERC20Errors.ERC20InsufficientAllowance.selector
        );
        _add(
            "pool.transfer",
            p,
            abi.encodeCall(IERC20.transfer, (outsider, 1)),
            LENDER,
            0,
            IERC20Errors.ERC20InsufficientBalance.selector
        );
        _add(
            "pool.transferFrom",
            p,
            abi.encodeCall(IERC20.transferFrom, (lender, outsider, 1)),
            NONE,
            0,
            IERC20Errors.ERC20InsufficientAllowance.selector
        );
        _add("pool.approve", p, abi.encodeCall(IERC20.approve, (outsider, 1)), ALL, 0, 0);
        _add("pool.grantRole", p, abi.encodeCall(IAccessControl.grantRole, (anyRole, outsider)), ADMIN, 0, unauthorized);
        _add(
            "pool.revokeRole", p, abi.encodeCall(IAccessControl.revokeRole, (anyRole, outsider)), ADMIN, 0, unauthorized
        );
        _add("pool.renounceRole(self)", p, abi.encodeCall(IAccessControl.renounceRole, (bytes32(0), SELF)), ALL, 0, 0);
        _add(
            "pool.renounceRole(admin)",
            p,
            abi.encodeCall(IAccessControl.renounceRole, (bytes32(0), admin)),
            ADMIN,
            0,
            badConfirm
        );

        // ---- ClaimRegistry
        entries.push(Entry("registry.submitClaim", r, "", ALL & ~GUARANTOR, 0, GuarantorIsRecipient.selector, true));
        _add(
            "registry.cancelClaim",
            r,
            abi.encodeCall(registry.cancelClaim, (idSubmitted)),
            CLAIMANT,
            0,
            NotRecipient.selector
        );
        _add(
            "registry.purchaseClaim",
            r,
            abi.encodeCall(registry.purchaseClaim, (idApproved)),
            CLAIMANT,
            0,
            NotRecipient.selector
        );
        _add("registry.settle", r, abi.encodeCall(registry.settle, (idFunded, 1)), ALL, 0, 0);
        _add(
            "registry.approveClaim",
            r,
            abi.encodeCall(registry.approveClaim, (idSubmitted, FACE)),
            UNDERWRITER,
            0,
            unauthorized
        );
        _add(
            "registry.rejectClaim",
            r,
            abi.encodeCall(registry.rejectClaim, (idSubmitted, REASON)),
            UNDERWRITER,
            0,
            unauthorized
        );
        _add(
            "registry.callGuarantor",
            r,
            abi.encodeCall(registry.callGuarantor, (idFunded, CallReason.AsucRejected)),
            ATTESTER,
            0,
            unauthorized
        );
        _add("registry.writeOff", r, abi.encodeCall(registry.writeOff, (idCalled)), ATTESTER, 0, unauthorized);
        _add("registry.setParams", r, abi.encodeCall(registry.setParams, (defaultParams())), ADMIN, 0, unauthorized);
        _add("registry.setOrgCap", r, abi.encodeCall(registry.setOrgCap, (orgId, 1)), ADMIN, 0, unauthorized);
        _add("registry.pause", r, abi.encodeCall(registry.pause, ()), PAUSER, 0, unauthorized);
        _add(
            "registry.unpause",
            r,
            abi.encodeCall(registry.unpause, ()),
            ADMIN,
            Pausable.ExpectedPause.selector,
            unauthorized
        );
        _add(
            "registry.grantRole",
            r,
            abi.encodeCall(IAccessControl.grantRole, (registry.UNDERWRITER_ROLE(), outsider)),
            ADMIN,
            0,
            unauthorized
        );
        _add(
            "registry.revokeRole",
            r,
            abi.encodeCall(IAccessControl.revokeRole, (registry.UNDERWRITER_ROLE(), underwriter)),
            ADMIN,
            0,
            unauthorized
        );
        _add(
            "registry.renounceRole(self)",
            r,
            abi.encodeCall(IAccessControl.renounceRole, (registry.UNDERWRITER_ROLE(), SELF)),
            ALL,
            0,
            0
        );
        _add(
            "registry.renounceRole(underwriter)",
            r,
            abi.encodeCall(IAccessControl.renounceRole, (registry.UNDERWRITER_ROLE(), underwriter)),
            UNDERWRITER,
            0,
            badConfirm
        );

        // ---- ClaimNFT
        _add(
            "nft.setRegistry",
            n,
            abi.encodeCall(nft.setRegistry, (outsider)),
            ADMIN,
            RegistryAlreadySet.selector,
            unauthorized
        );
        _add("nft.mint", n, abi.encodeCall(nft.mint, (outsider, 999)), REGISTRY, 0, OnlyRegistry.selector);
        _add("nft.setBaseURI", n, abi.encodeCall(nft.setBaseURI, ("ipfs://x/")), ADMIN, 0, unauthorized);
        _add(
            "nft.approve",
            n,
            abi.encodeCall(IERC721.approve, (outsider, idFunded)),
            NONE,
            0,
            IERC721Errors.ERC721InvalidApprover.selector
        );
        _add("nft.setApprovalForAll", n, abi.encodeCall(IERC721.setApprovalForAll, (address(0xBEEF), true)), ALL, 0, 0);
        _add(
            "nft.transferFrom",
            n,
            abi.encodeCall(IERC721.transferFrom, (address(pool), outsider, idFunded)),
            NONE,
            0,
            TransfersDisabled.selector
        );
        _add(
            "nft.safeTransferFrom",
            n,
            abi.encodeWithSignature("safeTransferFrom(address,address,uint256)", address(pool), outsider, idFunded),
            NONE,
            0,
            TransfersDisabled.selector
        );
        _add(
            "nft.safeTransferFrom(data)",
            n,
            abi.encodeWithSignature(
                "safeTransferFrom(address,address,uint256,bytes)", address(pool), outsider, idFunded, ""
            ),
            NONE,
            0,
            TransfersDisabled.selector
        );
        _add("nft.grantRole", n, abi.encodeCall(IAccessControl.grantRole, (anyRole, outsider)), ADMIN, 0, unauthorized);
        _add(
            "nft.revokeRole", n, abi.encodeCall(IAccessControl.revokeRole, (anyRole, outsider)), ADMIN, 0, unauthorized
        );
        _add("nft.renounceRole(self)", n, abi.encodeCall(IAccessControl.renounceRole, (bytes32(0), SELF)), ALL, 0, 0);

        // ---- OrgRegistry
        _add("orgs.addOrg", o, abi.encodeCall(orgs.addOrg, ("Fake Org")), ADMIN, 0, unauthorized);
        _add("orgs.setOrgActive", o, abi.encodeCall(orgs.setOrgActive, (orgId, false)), ADMIN, 0, unauthorized);
        _add("orgs.setOfficer", o, abi.encodeCall(orgs.setOfficer, (orgId, outsider, true)), ADMIN, 0, unauthorized);
        _add("orgs.grantRole", o, abi.encodeCall(IAccessControl.grantRole, (anyRole, outsider)), ADMIN, 0, unauthorized);
        _add(
            "orgs.revokeRole", o, abi.encodeCall(IAccessControl.revokeRole, (anyRole, outsider)), ADMIN, 0, unauthorized
        );
        _add("orgs.renounceRole(self)", o, abi.encodeCall(IAccessControl.renounceRole, (bytes32(0), SELF)), ALL, 0, 0);
    }

    /// @dev Replaces every 32-byte word equal to `SELF` with `who`.
    function _bind(bytes memory data, address who) internal pure returns (bytes memory out) {
        out = bytes.concat(data);
        bytes32 needle = bytes32(uint256(uint160(SELF)));
        bytes32 value = bytes32(uint256(uint160(who)));
        for (uint256 off = 4; off + 32 <= out.length; off += 32) {
            bytes32 word;
            assembly ("memory-safe") {
                word := mload(add(add(out, 32), off))
            }
            if (word == needle) {
                assembly ("memory-safe") {
                    mstore(add(add(out, 32), off), value)
                }
            }
        }
    }

    function _submitData(address who) internal returns (bytes memory) {
        SubmitClaimParams memory p = _params(orgId, RecipientType.Member, guarantor, FACE, FACE);
        uint256 deadline = _deadline();
        bytes memory sig = _sign(guarantorKey, who, p, registry.nonces(guarantor), deadline);
        return abi.encodeCall(registry.submitClaim, (p, deadline, sig));
    }

    /// @notice Hypothesis: every state-changing entry point of the four contracts accepts exactly the roles
    /// SECURITY.md lists, and rejects every other role with the expected authorization error.
    function test_accessMatrix_everySelectorTimesEveryRole() public {
        uint256 checked;
        for (uint256 e; e < entries.length; ++e) {
            Entry memory entry = entries[e];
            for (uint256 i; i < ROLES; ++i) {
                address who = roles[i];
                bytes memory data = entry.submit ? _submitData(who) : _bind(entry.data, who);
                uint256 snap = vm.snapshotState();
                vm.prank(who);
                (bool ok, bytes memory ret) = entry.target.call(data);
                bool allowed = entry.allowed & uint16(1 << i) != 0;
                bytes4 expected = allowed ? entry.allowedOutcome : entry.denial;
                string memory label = string.concat(entry.name, " by ", roleNames[i]);
                if (expected == bytes4(0)) {
                    assertTrue(ok, string.concat(label, ": should succeed"));
                } else {
                    assertFalse(ok, string.concat(label, ": should revert"));
                    assertEq(bytes4(ret), expected, string.concat(label, ": wrong error"));
                }
                vm.revertToState(snap);
                ++checked;
            }
        }
        emit log_named_uint("entry x role cells checked", checked);
    }

    // ---------------------------------------------------------------- selector coverage

    /// @dev Function selectors the dispatcher of `target` compares against (`DUP1 PUSH4 sel EQ`).
    function _dispatched(address target) internal view returns (bytes4[] memory found) {
        bytes memory code = target.code;
        found = new bytes4[](code.length / 7);
        uint256 count;
        uint256 i;
        while (i < code.length) {
            uint8 op = uint8(code[i]);
            if (op == 0x80 && i + 6 < code.length && uint8(code[i + 1]) == 0x63 && uint8(code[i + 6]) == 0x14) {
                found[count++] = bytes4(
                    uint32(uint8(code[i + 2])) << 24 | uint32(uint8(code[i + 3])) << 16 | uint32(uint8(code[i + 4]))
                        << 8 | uint32(uint8(code[i + 5]))
                );
            }
            i += (op >= 0x60 && op <= 0x7f) ? uint256(op) - 0x5e : 1;
        }
        assembly ("memory-safe") {
            mstore(found, count)
        }
    }

    function _contains(bytes4[] memory list, bytes4 sel) internal pure returns (bool) {
        for (uint256 i; i < list.length; ++i) {
            if (list[i] == sel) return true;
        }
        return false;
    }

    function _assertCovered(address target, bytes4[] memory views) internal view {
        bytes4[] memory tested = new bytes4[](entries.length);
        uint256 n;
        for (uint256 e; e < entries.length; ++e) {
            if (entries[e].target == target) {
                tested[n++] = entries[e].submit ? IClaimRegistry.submitClaim.selector : bytes4(entries[e].data);
            }
        }
        assembly ("memory-safe") {
            mstore(tested, n)
        }
        bytes4[] memory found = _dispatched(target);
        assertGt(found.length, 10, "dispatcher scan found the selectors");
        for (uint256 i; i < found.length; ++i) {
            bool known = _contains(tested, found[i]) || _contains(views, found[i]);
            assertTrue(known, string.concat("unclassified selector ", vm.toString(abi.encodePacked(found[i]))));
        }
        for (uint256 i; i < n; ++i) {
            assertTrue(_contains(found, tested[i]), "a tested selector is not in the dispatcher");
        }
    }

    function _hex(bytes memory packed) internal pure returns (bytes4[] memory out) {
        out = new bytes4[](packed.length / 4);
        for (uint256 i; i < out.length; ++i) {
            out[i] = bytes4(
                uint32(uint8(packed[4 * i])) << 24 | uint32(uint8(packed[4 * i + 1])) << 16
                    | uint32(uint8(packed[4 * i + 2])) << 8 | uint32(uint8(packed[4 * i + 3]))
            );
        }
    }

    /// @notice Hypothesis: the matrix covers every non-view function each contract dispatches, so a new external
    /// function fails this test until someone classifies it.
    function test_accessMatrix_coversEveryDispatchedSelector() public view {
        _assertCovered(
            address(pool),
            _hex(
                hex"a217fddfdd62ed3e94c8e4ff38d52e0f70a0823107a2d13ac6e6f592313ce567dbd5edc70905f5600581a299248a9ca391d14854aeb08cd24793da1e402d267d86053889c63d75b6d905777ece96cb7706fdde0329b1829eef8b30f7b3d7f6b94cdad5060a28a4777b10399901ffc9a795d89b4101e1d114e9848687bf04820b18160ddd"
            )
        );
        _assertCovered(
            address(registry),
            _hex(
                hex"2f81bb58a217fddfd5e3db82e63ab1e9f01b571aac78655e8da4d3c9f698da2584b0196e3b1c4f4a5aef2447248a9ca363c18a0d91d14854a05187ffd22a0d0fe96b422e47ccca027ecebe00b777f5aae48bd1627b77385ecab19cdccff0ab965c975abb16f0115b01ffc9a7"
            )
        );
        _assertCovered(
            address(nft),
            _hex(
                hex"a217fddf70a082316c0360eb081812fc248a9ca391d14854e985e9c506fdde036352211e7b10399901ffc9a795d89b41c87b56dd"
            )
        );
        _assertCovered(address(orgs), _hex(hex"a217fddf248a9ca391d14854967fe269303df05fd81066901cab1fc301ffc9a7"));
    }

    /// @notice Hypothesis: in emergency mode only a share holder can draw cash, and only its own entitlement.
    function test_emergencyWithdraw_onlyHoldersAcrossEveryRole() public {
        vm.prank(admin);
        pool.activateEmergencyMode();
        for (uint256 i; i < ROLES; ++i) {
            address who = roles[i];
            uint256 snap = vm.snapshotState();
            vm.prank(who);
            (bool ok, bytes memory ret) = address(pool).call(abi.encodeCall(pool.emergencyWithdraw, (who)));
            if (who == lender) {
                assertTrue(ok, "the only holder draws");
            } else {
                assertFalse(ok, roleNames[i]);
                assertEq(bytes4(ret), ZeroAmount.selector, roleNames[i]);
            }
            vm.revertToState(snap);
        }
    }

    // ---------------------------------------------------------------- emergency outflow (B-4c)

    /// @notice Hypothesis: after emergency activation, every holder can always draw what idle cash covers, even
    /// after frxUSD leaves the pool without a withdrawal (a frxUSD owner burn, D-1). Was FINDING B-4c.
    function test_emergencyWithdraw_outflowLeavesEveryHolderAbleToDrawWhatIsThere() public {
        address lender2 = makeAddr("lender2");
        vm.prank(admin);
        pool.setLenderAllowed(lender2, true);
        _deposit(lender2, SEED);
        vm.prank(admin);
        pool.activateEmergencyMode();
        vm.prank(lender);
        uint256 first = pool.emergencyWithdraw(lender);
        assertGt(first, 0);

        // a 1-wei burn: the holder who drew first saturates to zero instead of underflowing
        deal(address(frxUSD), address(pool), pool.idleCash() - 1);
        assertEq(pool.maxEmergencyWithdraw(lender), 0, "no underflow");
        vm.prank(lender);
        vm.expectRevert(ZeroAmount.selector);
        pool.emergencyWithdraw(lender);

        // burn half of what is left: the second holder's share now exceeds the cash, and it takes all there is
        deal(address(frxUSD), address(pool), pool.idleCash() / 2);
        uint256 idle = pool.idleCash();
        assertEq(pool.maxEmergencyWithdraw(lender2), idle, "capped at idle cash");
        vm.prank(lender2);
        assertEq(pool.emergencyWithdraw(lender2), idle);
        assertEq(pool.idleCash(), 0);
        assertEq(pool.maxEmergencyWithdraw(lender), 0);
        assertEq(pool.maxEmergencyWithdraw(lender2), 0);

        // cash that arrives later is shared again, and nobody's view or draw reverts
        deal(address(frxUSD), address(pool), 1000e18);
        uint256 a = pool.maxEmergencyWithdraw(lender);
        uint256 b = pool.maxEmergencyWithdraw(lender2);
        assertLe(a, 1000e18);
        assertLe(b, 1000e18);
        if (a > 0) {
            vm.prank(lender);
            pool.emergencyWithdraw(lender);
        }
        uint256 left = pool.maxEmergencyWithdraw(lender2);
        assertLe(left, pool.idleCash());
        if (left > 0) {
            vm.prank(lender2);
            pool.emergencyWithdraw(lender2);
        }
    }
}
