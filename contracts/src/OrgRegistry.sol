// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IOrgRegistry} from "./interfaces/IOrgRegistry.sol";
import {ZeroAddress, OrgNotFound, EmptyOrgName} from "./libraries/ClaimTypes.sol";

// UNCERTAIN: U-23
/// @title OrgRegistry
/// @notice Student orgs and their officers, managed by the admin (FR-C15). Only wallets go onchain, never names
/// or titles of people.
contract OrgRegistry is IOrgRegistry, AccessControl {
    struct Org {
        string name;
        bool active;
    }

    uint64 private _orgCount;
    mapping(uint64 orgId => Org) private _orgs;
    mapping(uint64 orgId => mapping(address account => bool)) private _officers;

    /// @notice Deploys the registry with `admin` holding `DEFAULT_ADMIN_ROLE`.
    /// @param admin The initial admin.
    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @inheritdoc IOrgRegistry
    function addOrg(string calldata name) external onlyRole(DEFAULT_ADMIN_ROLE) returns (uint64 orgId) {
        if (bytes(name).length == 0) revert EmptyOrgName();
        orgId = ++_orgCount;
        _orgs[orgId] = Org({name: name, active: true});
        emit OrgAdded(orgId, name);
        emit OrgActiveSet(orgId, true);
    }

    /// @inheritdoc IOrgRegistry
    function setOrgActive(uint64 orgId, bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _requireOrg(orgId);
        _orgs[orgId].active = active;
        emit OrgActiveSet(orgId, active);
    }

    /// @inheritdoc IOrgRegistry
    function setOfficer(uint64 orgId, address officer, bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _requireOrg(orgId);
        if (officer == address(0)) revert ZeroAddress();
        _officers[orgId][officer] = active;
        emit OfficerSet(orgId, officer, active);
    }

    /// @inheritdoc IOrgRegistry
    function isActiveOrg(uint64 orgId) external view returns (bool) {
        return _orgs[orgId].active;
    }

    /// @inheritdoc IOrgRegistry
    function isActiveOfficer(uint64 orgId, address account) external view returns (bool) {
        return _officers[orgId][account];
    }

    /// @inheritdoc IOrgRegistry
    function orgName(uint64 orgId) external view returns (string memory) {
        _requireOrg(orgId);
        return _orgs[orgId].name;
    }

    /// @inheritdoc IOrgRegistry
    function orgCount() external view returns (uint64) {
        return _orgCount;
    }

    function _requireOrg(uint64 orgId) private view {
        if (orgId == 0 || orgId > _orgCount) revert OrgNotFound(orgId);
    }
}
