// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IClaimNFT
/// @notice One non-transferable ERC-721 per purchased claim, owned by the pool (FR-C10).
interface IClaimNFT {
    /// @notice Emitted once, when the admin wires the claim registry.
    /// @param registry The claim registry.
    event RegistrySet(address indexed registry);

    /// @notice Emitted when the admin changes the metadata base URI.
    /// @param baseURI The new base URI. `tokenURI(id)` is this value followed by the token ID.
    event BaseURISet(string baseURI);

    /// @notice Sets the claim registry, the only address that can mint. Can be called once.
    /// @dev Admin only. The registry's `nft()` must return this contract.
    /// @param registry_ The claim registry.
    function setRegistry(address registry_) external;

    /// @notice Mints the NFT for a purchased claim.
    /// @dev Registry only.
    /// @param to The owner, always the pool.
    /// @param claimId The claim ID, used as the token ID.
    function mint(address to, uint256 claimId) external;

    /// @notice Sets the metadata base URI, which points at the `nft-metadata` edge function.
    /// @dev Admin only. The metadata endpoint carries no personal data (FR-B8).
    /// @param uri The new base URI.
    function setBaseURI(string calldata uri) external;

    /// @notice The claim registry, or zero before it is wired.
    /// @return The registry address.
    function registry() external view returns (address);

    /// @notice The current metadata base URI.
    /// @return The base URI.
    function baseURI() external view returns (string memory);
}
