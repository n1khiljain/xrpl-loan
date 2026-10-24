// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Metadata} from "@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BaseTest} from "../utils/BaseTest.sol";
import {ClaimNFT} from "../../src/ClaimNFT.sol";
import {ClaimRegistry} from "../../src/ClaimRegistry.sol";
import {ReceivablesPool} from "../../src/ReceivablesPool.sol";
import {IClaimNFT} from "../../src/interfaces/IClaimNFT.sol";
import {
    ZeroAddress, OnlyRegistry, RegistryAlreadySet, InvalidRegistry, TransfersDisabled
} from "../../src/libraries/ClaimTypes.sol";

contract ClaimNFTTest is BaseTest {
    /// @dev A fresh NFT plus a registry that points at it, not yet wired.
    function _unwired() internal returns (ClaimNFT fresh, ClaimRegistry freshRegistry) {
        fresh = new ClaimNFT(admin);
        ReceivablesPool freshPool = new ReceivablesPool(IERC20(address(frxUSD)), admin);
        freshRegistry = new ClaimRegistry(admin, freshPool, fresh, orgs, defaultParams());
    }

    function test_constructor_setsMetadataAndAdmin() public view {
        assertEq(nft.name(), "B@B x Frax College Claim");
        assertEq(nft.symbol(), "bbfCLAIM");
        assertTrue(nft.hasRole(nft.DEFAULT_ADMIN_ROLE(), admin));
    }

    function test_constructor_revertsOnZeroAdmin() public {
        vm.expectRevert(ZeroAddress.selector);
        new ClaimNFT(address(0));
    }

    function test_setRegistry_setsOnceAndEmits() public {
        (ClaimNFT fresh, ClaimRegistry freshRegistry) = _unwired();
        assertEq(fresh.registry(), address(0));
        vm.expectEmit(address(fresh));
        emit IClaimNFT.RegistrySet(address(freshRegistry));
        vm.prank(admin);
        fresh.setRegistry(address(freshRegistry));
        assertEq(fresh.registry(), address(freshRegistry));
    }

    function test_setRegistry_revertsWhenAlreadySet() public {
        vm.prank(admin);
        vm.expectRevert(RegistryAlreadySet.selector);
        nft.setRegistry(address(registry));
    }

    function test_setRegistry_revertsOnZeroAddress() public {
        (ClaimNFT fresh,) = _unwired();
        vm.prank(admin);
        vm.expectRevert(ZeroAddress.selector);
        fresh.setRegistry(address(0));
    }

    function test_setRegistry_revertsWhenRegistryPointsElsewhere() public {
        (ClaimNFT fresh,) = _unwired();
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(InvalidRegistry.selector, address(registry)));
        fresh.setRegistry(address(registry));
    }

    function test_setRegistry_revertsForNonAdmin() public {
        (ClaimNFT fresh, ClaimRegistry freshRegistry) = _unwired();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, outsider, fresh.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(outsider);
        fresh.setRegistry(address(freshRegistry));
    }

    function test_mint_mintsToPoolOnPurchase() public {
        uint256 id = _funded(FACE);
        assertEq(nft.ownerOf(id), address(pool));
        assertEq(nft.balanceOf(address(pool)), 1);
    }

    function test_mint_revertsForNonRegistry() public {
        vm.prank(admin);
        vm.expectRevert(OnlyRegistry.selector);
        nft.mint(address(pool), 1);
    }

    function test_transferFrom_revertsTransfersDisabled() public {
        uint256 id = _funded(FACE);
        vm.prank(address(pool));
        vm.expectRevert(TransfersDisabled.selector);
        nft.transferFrom(address(pool), outsider, id);
    }

    function test_safeTransferFrom_revertsTransfersDisabled() public {
        uint256 id = _funded(FACE);
        vm.prank(address(pool));
        vm.expectRevert(TransfersDisabled.selector);
        nft.safeTransferFrom(address(pool), outsider, id);
    }

    function test_setBaseURI_updatesTokenURIAndEmits() public {
        uint256 id = _funded(FACE);
        assertEq(nft.tokenURI(id), string.concat("https://functions.test/nft-metadata/", vm.toString(id)));

        vm.expectEmit(address(nft));
        emit IClaimNFT.BaseURISet("https://college.frax.test/meta/");
        vm.prank(admin);
        nft.setBaseURI("https://college.frax.test/meta/");
        assertEq(nft.baseURI(), "https://college.frax.test/meta/");
        assertEq(nft.tokenURI(id), string.concat("https://college.frax.test/meta/", vm.toString(id)));
    }

    function test_setBaseURI_revertsForNonAdmin() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, outsider, nft.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(outsider);
        nft.setBaseURI("https://evil.test/");
    }

    function test_tokenURI_emptyWithoutBaseURI() public {
        vm.prank(admin);
        nft.setBaseURI("");
        uint256 id = _funded(FACE);
        assertEq(nft.tokenURI(id), "");
    }

    function test_supportsInterface_erc721AndAccessControl() public view {
        assertTrue(nft.supportsInterface(type(IERC721).interfaceId));
        assertTrue(nft.supportsInterface(type(IERC721Metadata).interfaceId));
        assertTrue(nft.supportsInterface(type(IAccessControl).interfaceId));
        assertTrue(nft.supportsInterface(type(IERC165).interfaceId));
        assertFalse(nft.supportsInterface(0xdeadbeef));
    }
}
