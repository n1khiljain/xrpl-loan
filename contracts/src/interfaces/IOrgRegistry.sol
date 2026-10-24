// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IOrgRegistry
/// @notice Admin-managed list of student orgs and their officers (FR-C15).
interface IOrgRegistry {
    /// @notice Emitted when the admin adds an org. `OrgActiveSet(orgId, true)` follows in the same call.
    /// @param orgId The new org ID. IDs start at 1.
    /// @param name The org's public name.
    event OrgAdded(uint64 indexed orgId, string name);

    /// @notice Emitted when an org is activated or deactivated.
    /// @param orgId The org.
    /// @param active The new status.
    event OrgActiveSet(uint64 indexed orgId, bool active);

    /// @notice Emitted when an officer is set active or inactive for an org.
    /// @param orgId The org.
    /// @param officer The officer's wallet.
    /// @param active The new status.
    event OfficerSet(uint64 indexed orgId, address indexed officer, bool active);

    /// @notice Adds an org. New orgs start active.
    /// @dev Admin only.
    /// @param name The org's public name. Must not be empty.
    /// @return orgId The new org ID.
    function addOrg(string calldata name) external returns (uint64 orgId);

    /// @notice Activates or deactivates an org. A deactivated org blocks new submissions and purchases, not settlement.
    /// @dev Admin only.
    /// @param orgId The org.
    /// @param active The new status.
    function setOrgActive(uint64 orgId, bool active) external;

    /// @notice Sets an officer active or inactive for an org.
    /// @dev Admin only.
    /// @param orgId The org.
    /// @param officer The officer's wallet.
    /// @param active The new status.
    function setOfficer(uint64 orgId, address officer, bool active) external;

    /// @notice Whether the org exists and is active.
    /// @param orgId The org.
    /// @return True if active.
    function isActiveOrg(uint64 orgId) external view returns (bool);

    /// @notice Whether the account is an active officer of the org.
    /// @dev Does not check whether the org itself is active.
    /// @param orgId The org.
    /// @param account The wallet to check.
    /// @return True if the account is an active officer.
    function isActiveOfficer(uint64 orgId, address account) external view returns (bool);

    /// @notice The org's public name.
    /// @dev Reverts with `OrgNotFound` for an unknown ID.
    /// @param orgId The org.
    /// @return The name.
    function orgName(uint64 orgId) external view returns (string memory);

    /// @notice Number of orgs added so far. Org IDs run from 1 to this value.
    /// @return The count.
    function orgCount() external view returns (uint64);
}
