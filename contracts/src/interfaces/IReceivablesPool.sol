// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IReceivablesPool
/// @notice Pool-specific surface of the ERC-4626 frxUSD vault that buys claims (FR-C1 to FR-C5).
interface IReceivablesPool {
    /// @notice Emitted once, when the admin wires the claim registry.
    /// @param registry The claim registry.
    event RegistrySet(address indexed registry);

    /// @notice Emitted when a lender is added to or removed from the allowlist.
    /// @param lender The lender.
    /// @param allowed The new status.
    event LenderAllowedSet(address indexed lender, bool allowed);

    /// @notice Emitted when the allowlist is turned on or off, including at construction.
    /// @param enabled The new status.
    event AllowlistEnabledSet(bool enabled);

    /// @notice Emitted when the deposit cap changes, including at construction.
    /// @param cap The new cap on `totalAssets()` for deposits.
    event DepositCapSet(uint256 cap);

    /// @notice Emitted when the pool pays a claimant for a purchased claim.
    /// @param to The claimant.
    /// @param amount The purchase price.
    event PurchaseFunded(address indexed to, uint256 amount);

    /// @notice Emitted when settled principal comes back and leaves outstanding principal.
    /// @param amount The principal returned.
    event PrincipalReturned(uint256 amount);

    /// @notice Emitted when a write-off removes unpaid principal from pool assets.
    /// @param amount The principal lost.
    event LossRealized(uint256 amount);

    /// @notice Emitted when the admin permanently closes the pool to distribute cash to its current shareholders.
    /// @param caller The admin that activated emergency mode.
    /// @param shares The total shares whose ownership is now frozen.
    event EmergencyModeActivated(address indexed caller, uint256 shares);

    /// @notice Emitted when a shareholder claims emergency cash without surrendering future recovery rights.
    /// @param owner The shareholder claiming their entitlement.
    /// @param receiver The wallet receiving frxUSD.
    /// @param assets The frxUSD distributed.
    event EmergencyWithdrawal(address indexed owner, address indexed receiver, uint256 assets);

    /// @notice Permanently closes deposits, purchases, regular withdrawals, and share transfers.
    /// @dev Admin only. Cannot be reversed. Shareholders retain their fixed share of future cash receipts (U-80).
    function activateEmergencyMode() external;

    /// @notice Claims the caller's available emergency cash and preserves their rights to future receipts.
    /// @dev Emergency mode only. Uses actual cash and frozen share balances, independent of registry or NAV views.
    /// @param receiver The frxUSD recipient, which must not be zero or the pool itself.
    /// @return assets The frxUSD distributed to the receiver.
    function emergencyWithdraw(address receiver) external returns (uint256 assets);

    /// @notice Cash an owner can claim now in emergency mode, or zero outside emergency mode.
    /// @param owner The shareholder.
    /// @return assets Their unpaid share of all cash received during emergency mode, capped at idle cash. Zero
    /// (never a revert) if cash left the pool some other way and they already took their share of what is left.
    function maxEmergencyWithdraw(address owner) external view returns (uint256 assets);

    /// @notice Whether the pool is permanently in emergency distribution mode.
    /// @return True after activation.
    function emergencyMode() external view returns (bool);

    /// @notice Total frxUSD already distributed through emergency withdrawals.
    /// @return The cumulative emergency distributions.
    function totalEmergencyWithdrawn() external view returns (uint256);

    /// @notice frxUSD an owner has already received through emergency withdrawals.
    /// @param owner The shareholder.
    /// @return Their cumulative emergency distributions.
    function emergencyWithdrawn(address owner) external view returns (uint256);

    /// @notice Sets the claim registry. Can be called once, and the address can never change (FR-C5).
    /// @dev Admin only. The registry's `pool()` must return this contract.
    /// @param registry_ The claim registry.
    function setRegistry(address registry_) external;

    /// @notice Adds or removes a lender from the deposit allowlist.
    /// @dev Admin only.
    /// @param lender The lender.
    /// @param allowed The new status.
    function setLenderAllowed(address lender, bool allowed) external;

    /// @notice Turns the lender allowlist on or off.
    /// @dev Admin only.
    /// @param enabled The new status.
    function setAllowlistEnabled(bool enabled) external;

    /// @notice Sets the cap on `totalAssets()` that deposits cannot push past.
    /// @dev Admin only. May be set below current assets, which blocks deposits.
    /// @param cap The new cap.
    function setDepositCap(uint256 cap) external;

    /// @notice Sends frxUSD to a claimant for a purchase and books it as outstanding principal.
    /// @dev Registry only.
    /// @param to The claimant.
    /// @param amount The purchase price.
    function fundPurchase(address to, uint256 amount) external;

    /// @notice Books principal paid back on a claim. The frxUSD arrives in the same registry call.
    /// @dev Registry only.
    /// @param amount The principal returned.
    function recordPrincipalReturned(uint256 amount) external;

    /// @notice Books unpaid principal as a loss, which lowers the share price (FR-C12).
    /// @dev Registry only.
    /// @param amount The principal lost.
    function realizeLoss(uint256 amount) external;

    /// @notice frxUSD held by the pool and not paid out on a claim.
    /// @return The pool's frxUSD balance.
    function idleCash() external view returns (uint256);

    /// @notice Purchase price not yet paid back on `Funded` and `GuarantorCalled` claims.
    /// @return The outstanding principal.
    function outstandingPrincipal() external view returns (uint256);

    /// @notice Total principal ever written off. Payments received after a write-off do not reduce it.
    /// @return The gross realized losses.
    function totalLosses() external view returns (uint256);

    /// @notice The claim registry, or zero before it is wired.
    /// @return The registry address.
    function registry() external view returns (address);

    /// @notice The current deposit cap on `totalAssets()`.
    /// @return The cap.
    function depositCap() external view returns (uint256);

    /// @notice Whether deposits are restricted to allowlisted lenders.
    /// @return True if the allowlist is on.
    function allowlistEnabled() external view returns (bool);

    /// @notice Whether a lender is on the allowlist.
    /// @param lender The lender.
    /// @return True if allowed.
    function isLenderAllowed(address lender) external view returns (bool);
}
