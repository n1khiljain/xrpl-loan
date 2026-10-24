// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IReceivablesPool} from "./interfaces/IReceivablesPool.sol";
import {IClaimRegistry} from "./interfaces/IClaimRegistry.sol";
import {
    ZeroAddress,
    OnlyRegistry,
    RegistryAlreadySet,
    InvalidRegistry,
    InsufficientIdleCash,
    LenderNotAllowed,
    DepositCapExceeded,
    DepositsPaused,
    EmergencyModeActive,
    EmergencyModeInactive,
    InvalidEmergencyReceiver,
    ZeroAmount
} from "./libraries/ClaimTypes.sol";

/// @title ReceivablesPool
/// @notice ERC-4626 vault over frxUSD that buys claims (FR-C1). Total assets are idle frxUSD plus the unpaid
/// principal of purchased claims (FR-C2). Deposits follow the lender allowlist and the deposit cap (FR-C3), and
/// withdrawals are limited to idle cash (FR-C4). Only the claim registry can move pool money to claimants or book
/// settlements and losses (FR-C5).
/// @dev Not upgradeable (U-03). A 6-decimal virtual share offset guards against the first-deposit inflation attack.
contract ReceivablesPool is IReceivablesPool, ERC4626, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @inheritdoc IReceivablesPool
    address public registry;
    /// @inheritdoc IReceivablesPool
    uint256 public depositCap;
    /// @inheritdoc IReceivablesPool
    bool public allowlistEnabled;
    /// @inheritdoc IReceivablesPool
    uint256 public outstandingPrincipal;
    /// @inheritdoc IReceivablesPool
    uint256 public totalLosses;
    /// @inheritdoc IReceivablesPool
    mapping(address lender => bool) public isLenderAllowed;

    /// @inheritdoc IReceivablesPool
    bool public emergencyMode;
    /// @inheritdoc IReceivablesPool
    uint256 public totalEmergencyWithdrawn;
    /// @inheritdoc IReceivablesPool
    mapping(address owner => uint256) public emergencyWithdrawn;

    modifier onlyRegistry() {
        if (msg.sender != registry) revert OnlyRegistry();
        _;
    }

    modifier whenNotEmergency() {
        if (emergencyMode) revert EmergencyModeActive();
        _;
    }

    /// @notice Deploys the pool closed to deposits: the cap starts at 0 and the allowlist starts on.
    /// @param asset_ frxUSD, or MockFrxUSD on a testnet without it.
    /// @param admin The initial admin.
    constructor(IERC20 asset_, address admin) ERC20("B@B x Frax College Pool", "bbfCP") ERC4626(asset_) {
        if (address(asset_) == address(0) || admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        // UNCERTAIN: U-15
        allowlistEnabled = true;
        emit AllowlistEnabledSet(true);
        emit DepositCapSet(0);
    }

    // ---------------------------------------------------------------- admin

    /// @inheritdoc IReceivablesPool
    function setRegistry(address registry_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (registry != address(0)) revert RegistryAlreadySet();
        if (registry_ == address(0)) revert ZeroAddress();
        if (address(IClaimRegistry(registry_).pool()) != address(this)) revert InvalidRegistry(registry_);
        registry = registry_;
        emit RegistrySet(registry_);
    }

    /// @inheritdoc IReceivablesPool
    function setLenderAllowed(address lender, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (lender == address(0)) revert ZeroAddress();
        isLenderAllowed[lender] = allowed;
        emit LenderAllowedSet(lender, allowed);
    }

    /// @inheritdoc IReceivablesPool
    function setAllowlistEnabled(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        allowlistEnabled = enabled;
        emit AllowlistEnabledSet(enabled);
    }

    /// @inheritdoc IReceivablesPool
    function setDepositCap(uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        // UNCERTAIN: U-32
        depositCap = cap;
        emit DepositCapSet(cap);
    }

    /// @inheritdoc IReceivablesPool
    // UNCERTAIN: U-80 (a permanent closeout, separate from the registry's reversible pause)
    function activateEmergencyMode() external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) whenNotEmergency {
        emergencyMode = true;
        emit EmergencyModeActivated(msg.sender, totalSupply());
    }

    /// @inheritdoc IReceivablesPool
    function emergencyWithdraw(address receiver) external nonReentrant returns (uint256 assets) {
        if (!emergencyMode) revert EmergencyModeInactive();
        if (receiver == address(0)) revert ZeroAddress();
        // Counting a self-transfer as an outflow would inflate every shareholder's next entitlement.
        if (receiver == address(this)) revert InvalidEmergencyReceiver();
        assets = maxEmergencyWithdraw(msg.sender);
        // Reject only empty claims. Donations can increase this entitlement, never disable a positive claim.
        // slither-disable-next-line incorrect-equality
        if (assets == 0) revert ZeroAmount();

        emergencyWithdrawn[msg.sender] += assets;
        totalEmergencyWithdrawn += assets;
        // only view calls precede this event; the transfer comes after it
        // forge-lint: disable-next-line(reentrancy-events)
        emit EmergencyWithdrawal(msg.sender, receiver, assets);
        IERC20(asset()).safeTransfer(receiver, assets);
    }

    // ---------------------------------------------------------------- registry

    /// @inheritdoc IReceivablesPool
    function fundPurchase(address to, uint256 amount) external nonReentrant onlyRegistry whenNotEmergency {
        uint256 idle = idleCash();
        if (amount > idle) revert InsufficientIdleCash(amount, idle);
        outstandingPrincipal += amount;
        emit PurchaseFunded(to, amount);
        IERC20(asset()).safeTransfer(to, amount);
    }

    /// @inheritdoc IReceivablesPool
    function recordPrincipalReturned(uint256 amount) external onlyRegistry {
        outstandingPrincipal -= amount;
        emit PrincipalReturned(amount);
    }

    /// @inheritdoc IReceivablesPool
    function realizeLoss(uint256 amount) external onlyRegistry {
        outstandingPrincipal -= amount;
        totalLosses += amount;
        emit LossRealized(amount);
    }

    // ---------------------------------------------------------------- lenders

    /// @notice Deposits frxUSD for pool shares. Reverts while paused, for a caller or receiver off the allowlist
    /// when it is on, and past the deposit cap.
    /// @param assets The frxUSD to deposit.
    /// @param receiver The share recipient.
    /// @return The shares minted.
    function deposit(uint256 assets, address receiver)
        public
        override
        nonReentrant
        whenNotEmergency
        returns (uint256)
    {
        _checkDeposit(receiver, assets);
        return super.deposit(assets, receiver);
    }

    /// @notice Mints exact pool shares for frxUSD. Same restrictions as `deposit`.
    /// @param shares The shares to mint.
    /// @param receiver The share recipient.
    /// @return The frxUSD pulled from the caller.
    function mint(uint256 shares, address receiver) public override nonReentrant whenNotEmergency returns (uint256) {
        _checkDeposit(receiver, previewMint(shares));
        return super.mint(shares, receiver);
    }

    /// @notice Withdraws frxUSD by burning shares, up to idle cash. Open while paused; closed in emergency mode.
    /// @param assets The frxUSD to withdraw.
    /// @param receiver The frxUSD recipient.
    /// @param owner The share owner.
    /// @return The shares burned.
    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        nonReentrant
        whenNotEmergency
        returns (uint256)
    {
        return super.withdraw(assets, receiver, owner);
    }

    /// @notice Redeems shares for frxUSD, up to idle cash. Open while paused; closed in emergency mode.
    /// @param shares The shares to burn.
    /// @param receiver The frxUSD recipient.
    /// @param owner The share owner.
    /// @return The frxUSD sent.
    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        nonReentrant
        whenNotEmergency
        returns (uint256)
    {
        return super.redeem(shares, receiver, owner);
    }

    // ---------------------------------------------------------------- views

    /// @notice Idle frxUSD plus unpaid principal on `Funded` and `GuarantorCalled` claims (FR-C2).
    /// @return The pool's total assets.
    function totalAssets() public view override returns (uint256) {
        return idleCash() + outstandingPrincipal;
    }

    /// @inheritdoc IReceivablesPool
    function idleCash() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    /// @notice Most frxUSD `receiver` can deposit: 0 while paused or when off the allowlist, else the room left
    /// under the deposit cap.
    /// @dev `deposit` also checks the caller against the allowlist, which this view cannot see (U-42).
    /// @param receiver The share recipient.
    /// @return The max deposit.
    function maxDeposit(address receiver) public view override returns (uint256) {
        if (_depositsPaused()) return 0;
        if (allowlistEnabled && !isLenderAllowed[receiver]) return 0;
        return _depositRoom();
    }

    /// @notice Most shares `receiver` can mint, derived from `maxDeposit`; zero in emergency mode.
    /// @dev Underestimates rather than reverts when the deposit cap is near `type(uint256).max`.
    /// @param receiver The share recipient.
    /// @return The max mint.
    function maxMint(address receiver) public view override returns (uint256) {
        if (emergencyMode) return 0;
        // Clamp so a huge cap (e.g. type(uint256).max for "no cap") underestimates instead of overflowing (D-3).
        uint256 limit = type(uint256).max / (totalSupply() + 10 ** _decimalsOffset());
        uint256 assets = Math.min(maxDeposit(receiver), limit);
        return _convertToShares(assets, Math.Rounding.Floor);
    }

    /// @notice Most frxUSD `owner` can withdraw: share value capped at idle cash; zero in emergency mode.
    /// @param owner The share owner.
    /// @return The max withdrawal.
    function maxWithdraw(address owner) public view override returns (uint256) {
        if (emergencyMode) return 0;
        return Math.min(super.maxWithdraw(owner), idleCash());
    }

    /// @notice Most shares `owner` can redeem: their whole balance when idle cash covers what it's worth, else the
    /// shares idle cash can cover.
    /// Returns zero in emergency mode; use `maxEmergencyWithdraw` instead.
    /// @dev Checks the balance's value first: converting idle cash back to shares rounds down, so after any loss it
    /// lands a few share-wei under the last lender's balance and `redeem(balanceOf(owner))` would revert.
    /// @param owner The share owner.
    /// @return The max redemption.
    function maxRedeem(address owner) public view override returns (uint256) {
        if (emergencyMode) return 0;
        uint256 shares = balanceOf(owner);
        uint256 idle = idleCash();
        if (_convertToAssets(shares, Math.Rounding.Floor) <= idle) return shares;
        return _convertToShares(idle, Math.Rounding.Floor);
    }

    /// @inheritdoc IReceivablesPool
    function maxEmergencyWithdraw(address owner) public view returns (uint256 assets) {
        if (!emergencyMode) return 0;
        uint256 supply = totalSupply();
        if (supply == 0) return 0;
        // Balances and supply cannot change in emergency mode. Add past payouts back to cash so claiming order
        // cannot change anyone's entitlement. No virtual shares: actual shareholders own all emergency receipts.
        uint256 idle = idleCash();
        uint256 received = idle + totalEmergencyWithdrawn;
        // Cash can leave without a withdrawal (a frxUSD burn or freeze, D-1). Saturate and cap at idle cash so
        // every holder can still take what is there instead of hitting an underflow or a failed transfer.
        uint256 share = Math.mulDiv(received, balanceOf(owner), supply);
        uint256 withdrawn = emergencyWithdrawn[owner];
        return share > withdrawn ? Math.min(share - withdrawn, idle) : 0;
    }

    // ---------------------------------------------------------------- internal

    function _checkDeposit(address receiver, uint256 assets) private view {
        if (_depositsPaused()) revert DepositsPaused();
        // UNCERTAIN: U-42
        if (allowlistEnabled) {
            if (!isLenderAllowed[msg.sender]) revert LenderNotAllowed(msg.sender);
            if (!isLenderAllowed[receiver]) revert LenderNotAllowed(receiver);
        }
        if (assets > _depositRoom()) revert DepositCapExceeded();
    }

    /// @dev One pause on the registry covers pool deposits too (U-26).
    function _depositsPaused() private view returns (bool) {
        if (emergencyMode) return true;
        address registry_ = registry;
        return registry_ != address(0) && IClaimRegistry(registry_).paused();
    }

    /// @dev The cap applies to total assets, so settlements use room and losses free it.
    function _depositRoom() private view returns (uint256) {
        uint256 assets = totalAssets();
        return depositCap > assets ? depositCap - assets : 0;
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    /// @dev Frozen shares preserve each owner's entitlement to every later settlement and recovery (U-80).
    function _update(address from, address to, uint256 value) internal override {
        if (emergencyMode) revert EmergencyModeActive();
        super._update(from, to, value);
    }
}
