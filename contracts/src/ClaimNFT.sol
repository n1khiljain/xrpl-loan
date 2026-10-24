// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IClaimNFT} from "./interfaces/IClaimNFT.sol";
import {IClaimRegistry} from "./interfaces/IClaimRegistry.sol";
import {
    ZeroAddress, OnlyRegistry, RegistryAlreadySet, InvalidRegistry, TransfersDisabled
} from "./libraries/ClaimTypes.sol";

// UNCERTAIN: U-19
/// @title ClaimNFT
/// @notice One ERC-721 per purchased claim, token ID equal to the claim ID, owned by the pool (FR-C10).
/// Transfers are disabled in the MVP.
contract ClaimNFT is IClaimNFT, ERC721, AccessControl {
    /// @inheritdoc IClaimNFT
    address public registry;

    string private _baseTokenURI;

    /// @notice Deploys the NFT with `admin` holding `DEFAULT_ADMIN_ROLE`.
    /// @param admin The initial admin.
    constructor(address admin) ERC721("B@B x Frax College Claim", "bbfCLAIM") {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @inheritdoc IClaimNFT
    function setRegistry(address registry_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (registry != address(0)) revert RegistryAlreadySet();
        if (registry_ == address(0)) revert ZeroAddress();
        if (address(IClaimRegistry(registry_).nft()) != address(this)) revert InvalidRegistry(registry_);
        registry = registry_;
        emit RegistrySet(registry_);
    }

    /// @inheritdoc IClaimNFT
    function mint(address to, uint256 claimId) external {
        if (msg.sender != registry) revert OnlyRegistry();
        // the only recipient is the pool, which never needs onERC721Received since transfers are disabled
        // forge-lint: disable-next-line(unsafe-oz-erc721-mint)
        _mint(to, claimId);
    }

    /// @inheritdoc IClaimNFT
    function setBaseURI(string calldata uri) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _baseTokenURI = uri;
        emit BaseURISet(uri);
    }

    /// @inheritdoc IClaimNFT
    function baseURI() external view returns (string memory) {
        return _baseTokenURI;
    }

    /// @notice ERC-165 support for ERC-721 and AccessControl.
    /// @param interfaceId The interface ID.
    /// @return True if supported.
    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    /// @dev Only mints get through. Any move of an existing token reverts, including burns.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (_ownerOf(tokenId) != address(0)) revert TransfersDisabled();
        return super._update(to, tokenId, auth);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
}
