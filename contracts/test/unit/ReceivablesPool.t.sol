// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {BaseTest} from "../utils/BaseTest.sol";
import {ReceivablesPool} from "../../src/ReceivablesPool.sol";
import {ClaimRegistry} from "../../src/ClaimRegistry.sol";
import {ClaimNFT} from "../../src/ClaimNFT.sol";
import {IReceivablesPool} from "../../src/interfaces/IReceivablesPool.sol";
import {
    ZeroAddress,
    OnlyRegistry,
    RegistryAlreadySet,
    InvalidRegistry,
    InsufficientIdleCash,
    LenderNotAllowed,
    DepositCapExceeded,
    DepositsPaused,
    CallReason,
    ClaimState
} from "../../src/libraries/ClaimTypes.sol";

contract ReceivablesPoolTest is BaseTest {
    address internal lender2 = makeAddr("lender2");

    function _unwired() internal returns (ReceivablesPool fresh, ClaimRegistry freshRegistry) {
        fresh = new ReceivablesPool(IERC20(address(frxUSD)), admin);
        freshRegistry = new ClaimRegistry(admin, fresh, new ClaimNFT(admin), orgs, defaultParams());
    }

    function _expectNotAdmin(address caller) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, caller, pool.DEFAULT_ADMIN_ROLE()
            )
        );
    }

    function _pause() internal {
        vm.prank(pauser);
        registry.pause();
    }

    // ---------------------------------------------------------------- constructor

    function test_constructor_setsMetadataAndClosedDefaults() public {
        vm.expectEmit();
        emit IReceivablesPool.AllowlistEnabledSet(true);
        vm.expectEmit();
        emit IReceivablesPool.DepositCapSet(0);
        ReceivablesPool fresh = new ReceivablesPool(IERC20(address(frxUSD)), admin);

        assertEq(fresh.name(), "B@B x Frax College Pool");
        assertEq(fresh.symbol(), "bbfCP");
        assertEq(fresh.decimals(), 24, "18 asset decimals plus the 6-decimal virtual offset");
        assertEq(fresh.asset(), address(frxUSD));
        assertEq(fresh.depositCap(), 0);
        assertTrue(fresh.allowlistEnabled());
        assertEq(fresh.registry(), address(0));
        assertTrue(fresh.hasRole(fresh.DEFAULT_ADMIN_ROLE(), admin));
    }

    function test_constructor_revertsOnZeroAsset() public {
        vm.expectRevert(ZeroAddress.selector);
        new ReceivablesPool(IERC20(address(0)), admin);
    }

    function test_constructor_revertsOnZeroAdmin() public {
        vm.expectRevert(ZeroAddress.selector);
        new ReceivablesPool(IERC20(address(frxUSD)), address(0));
    }

    // ---------------------------------------------------------------- admin setters

    function test_setRegistry_setsOnceAndEmits() public {
        (ReceivablesPool fresh, ClaimRegistry freshRegistry) = _unwired();
        vm.expectEmit(address(fresh));
        emit IReceivablesPool.RegistrySet(address(freshRegistry));
        vm.prank(admin);
        fresh.setRegistry(address(freshRegistry));
        assertEq(fresh.registry(), address(freshRegistry));
    }

    function test_setRegistry_revertsWhenAlreadySet() public {
        vm.prank(admin);
        vm.expectRevert(RegistryAlreadySet.selector);
        pool.setRegistry(address(registry));
    }

    function test_setRegistry_revertsOnZeroAddress() public {
        (ReceivablesPool fresh,) = _unwired();
        vm.prank(admin);
        vm.expectRevert(ZeroAddress.selector);
        fresh.setRegistry(address(0));
    }

    function test_setRegistry_revertsWhenRegistryPointsElsewhere() public {
        (ReceivablesPool fresh,) = _unwired();
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(InvalidRegistry.selector, address(registry)));
        fresh.setRegistry(address(registry));
    }

    function test_setRegistry_revertsForNonAdmin() public {
        (ReceivablesPool fresh, ClaimRegistry freshRegistry) = _unwired();
        _expectNotAdmin(outsider);
        vm.prank(outsider);
        fresh.setRegistry(address(freshRegistry));
    }

    function test_setLenderAllowed_updatesAndEmits() public {
        vm.expectEmit(address(pool));
        emit IReceivablesPool.LenderAllowedSet(lender2, true);
        vm.prank(admin);
        pool.setLenderAllowed(lender2, true);
        assertTrue(pool.isLenderAllowed(lender2));

        vm.prank(admin);
        pool.setLenderAllowed(lender2, false);
        assertFalse(pool.isLenderAllowed(lender2));
    }

    function test_setLenderAllowed_revertsOnZeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(ZeroAddress.selector);
        pool.setLenderAllowed(address(0), true);
    }

    function test_setLenderAllowed_revertsForNonAdmin() public {
        _expectNotAdmin(lender);
        vm.prank(lender);
        pool.setLenderAllowed(lender2, true);
    }

    function test_setAllowlistEnabled_updatesAndEmits() public {
        vm.expectEmit(address(pool));
        emit IReceivablesPool.AllowlistEnabledSet(false);
        vm.prank(admin);
        pool.setAllowlistEnabled(false);
        assertFalse(pool.allowlistEnabled());
    }

    function test_setAllowlistEnabled_revertsForNonAdmin() public {
        _expectNotAdmin(outsider);
        vm.prank(outsider);
        pool.setAllowlistEnabled(false);
    }

    function test_setDepositCap_updatesAndEmits() public {
        vm.expectEmit(address(pool));
        emit IReceivablesPool.DepositCapSet(1e18);
        vm.prank(admin);
        pool.setDepositCap(1e18);
        assertEq(pool.depositCap(), 1e18);
    }

    function test_setDepositCap_revertsForNonAdmin() public {
        _expectNotAdmin(outsider);
        vm.prank(outsider);
        pool.setDepositCap(1);
    }

    // ---------------------------------------------------------------- deposit and mint

    function test_deposit_mintsSharesWithVirtualOffset() public {
        uint256 shares = _deposit(lender, 1_000e18);
        assertEq(shares, 1_000e18 * 1e6, "first deposit mints 1e6 shares per asset wei");
        assertEq(pool.balanceOf(lender), shares);
        assertEq(pool.totalAssets(), 1_000e18);
        assertEq(pool.idleCash(), 1_000e18);
    }

    function test_deposit_revertsWhenPaused() public {
        _pause();
        frxUSD.mint(lender, 1e18);
        vm.startPrank(lender);
        frxUSD.approve(address(pool), 1e18);
        vm.expectRevert(DepositsPaused.selector);
        pool.deposit(1e18, lender);
        vm.stopPrank();
    }

    function test_deposit_revertsForCallerNotAllowed() public {
        frxUSD.mint(outsider, 1e18);
        vm.startPrank(outsider);
        frxUSD.approve(address(pool), 1e18);
        vm.expectRevert(abi.encodeWithSelector(LenderNotAllowed.selector, outsider));
        pool.deposit(1e18, lender);
        vm.stopPrank();
    }

    function test_deposit_revertsForReceiverNotAllowed() public {
        frxUSD.mint(lender, 1e18);
        vm.startPrank(lender);
        frxUSD.approve(address(pool), 1e18);
        vm.expectRevert(abi.encodeWithSelector(LenderNotAllowed.selector, outsider));
        pool.deposit(1e18, outsider);
        vm.stopPrank();
    }

    function test_deposit_openToAnyoneWhenAllowlistDisabled() public {
        vm.prank(admin);
        pool.setAllowlistEnabled(false);
        uint256 shares = _deposit(outsider, 1e18);
        assertEq(pool.balanceOf(outsider), shares);
    }

    function test_deposit_revertsPastCap() public {
        _deposit(lender, POOL_CAP - 1e18);
        frxUSD.mint(lender, 1e18 + 1);
        vm.startPrank(lender);
        frxUSD.approve(address(pool), 1e18 + 1);
        vm.expectRevert(DepositCapExceeded.selector);
        pool.deposit(1e18 + 1, lender);
        pool.deposit(1e18, lender);
        vm.stopPrank();
        assertEq(pool.totalAssets(), POOL_CAP);
    }

    function test_deposit_capCountsTotalAssetsNotIdleCash() public {
        _seedPool(POOL_CAP);
        _funded(FACE);
        // purchase moves cash to principal, so total assets and cap room are unchanged
        assertEq(pool.totalAssets(), POOL_CAP);
        assertEq(pool.maxDeposit(lender), 0);
    }

    function test_deposit_lossesFreeCapRoom() public {
        _seedPool(POOL_CAP);
        _writtenOff(FACE);
        assertEq(pool.maxDeposit(lender), FACE);
        _deposit(lender, FACE);
    }

    function test_deposit_allowedBeforeRegistryIsSet() public {
        (ReceivablesPool fresh,) = _unwired();
        vm.startPrank(admin);
        fresh.setDepositCap(1e18);
        fresh.setAllowlistEnabled(false);
        vm.stopPrank();
        frxUSD.mint(lender, 1e18);
        vm.startPrank(lender);
        frxUSD.approve(address(fresh), 1e18);
        fresh.deposit(1e18, lender);
        vm.stopPrank();
        assertEq(fresh.totalAssets(), 1e18);
    }

    function test_mint_mintsExactShares() public {
        uint256 shares = 5e18 * 1e6;
        uint256 assets = pool.previewMint(shares);
        frxUSD.mint(lender, assets);
        vm.startPrank(lender);
        frxUSD.approve(address(pool), assets);
        assertEq(pool.mint(shares, lender), assets);
        vm.stopPrank();
        assertEq(pool.balanceOf(lender), shares);
    }

    function test_mint_revertsWhenPaused() public {
        _pause();
        vm.prank(lender);
        vm.expectRevert(DepositsPaused.selector);
        pool.mint(1e24, lender);
    }

    function test_mint_revertsForCallerNotAllowed() public {
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(LenderNotAllowed.selector, outsider));
        pool.mint(1e24, lender);
    }

    function test_mint_revertsPastCap() public {
        uint256 shares = pool.previewDeposit(POOL_CAP) + 1e6;
        vm.prank(lender);
        vm.expectRevert(DepositCapExceeded.selector);
        pool.mint(shares, lender);
    }

    // ---------------------------------------------------------------- max views

    function test_maxDeposit_zeroWhenPaused() public {
        _pause();
        assertEq(pool.maxDeposit(lender), 0);
        assertEq(pool.maxMint(lender), 0);
    }

    function test_maxDeposit_zeroForReceiverNotAllowed() public view {
        assertEq(pool.maxDeposit(outsider), 0);
        assertEq(pool.maxMint(outsider), 0);
    }

    function test_maxDeposit_isCapRoom() public {
        assertEq(pool.maxDeposit(lender), POOL_CAP);
        _deposit(lender, 10_000e18);
        assertEq(pool.maxDeposit(lender), POOL_CAP - 10_000e18);
        vm.prank(admin);
        pool.setAllowlistEnabled(false);
        assertEq(pool.maxDeposit(outsider), POOL_CAP - 10_000e18);
    }

    function test_maxDeposit_zeroWhenCapBelowAssets() public {
        _deposit(lender, 10_000e18);
        vm.prank(admin);
        pool.setDepositCap(5_000e18);
        assertEq(pool.maxDeposit(lender), 0);
        assertEq(pool.maxMint(lender), 0);
    }

    function test_maxMint_mintableWithoutRevert() public {
        _deposit(lender, 12_345e18);
        uint256 shares = pool.maxMint(lender);
        uint256 assets = pool.previewMint(shares);
        assertLe(assets, pool.maxDeposit(lender));
        frxUSD.mint(lender, assets);
        vm.startPrank(lender);
        frxUSD.approve(address(pool), assets);
        pool.mint(shares, lender);
        vm.stopPrank();
    }

    /// @dev D-3: a cap of type(uint256).max ("no cap") must not make maxMint overflow; it underestimates instead.
    function test_maxMint_doesNotRevertForUnboundedCap() public {
        _deposit(lender, 12_345e18);
        vm.prank(admin);
        pool.setDepositCap(type(uint256).max);
        uint256 shares = pool.maxMint(lender);
        assertGt(shares, 0);
        assertLe(pool.convertToAssets(shares), pool.maxDeposit(lender));
        vm.prank(admin);
        pool.setDepositCap(type(uint256).max / 1e6 + 1);
        assertGt(pool.maxMint(lender), 0);
    }

    function test_maxWithdraw_cappedAtIdleCash() public {
        _seedPool(SEED);
        _funded(PER_CLAIM_CAP);
        assertEq(pool.maxWithdraw(lender), SEED - PER_CLAIM_CAP);
        assertEq(pool.maxWithdraw(outsider), 0);
    }

    function test_maxRedeem_cappedAtIdleCash() public {
        _seedPool(SEED);
        _funded(PER_CLAIM_CAP);
        uint256 shares = pool.maxRedeem(lender);
        assertLt(shares, pool.balanceOf(lender));
        assertLe(pool.previewRedeem(shares), pool.idleCash());
    }

    function test_maxRedeem_fullBalanceWhenIdle() public {
        _seedPool(SEED);
        assertEq(pool.maxRedeem(lender), pool.balanceOf(lender));
    }

    // ---------------------------------------------------------------- single-lender assumptions (U-79)

    /// @dev Once every share is redeemed, the 6-decimal virtual shares own the pool, so a payment on a written-off
    /// claim that lands afterwards can't be reached, not even by depositing again. Hence the RUNBOOK rule: the lender
    /// keeps some shares while any written-off claim could still be paid.
    function test_settle_paymentAfterTheLastLenderLeavesIsStranded() public {
        _seedPool(SEED);
        uint256 id = _writtenOff(PER_CLAIM_CAP);
        uint256 shares = pool.balanceOf(lender);
        vm.prank(lender);
        pool.redeem(shares, lender, lender);
        assertEq(pool.totalSupply(), 0);

        _pay(guarantor, id, PER_CLAIM_CAP);
        assertEq(pool.idleCash(), PER_CLAIM_CAP);
        // depositing again doesn't reach it: the new shares are worth what went in (less rounding), not 2,500 more
        uint256 value = pool.previewRedeem(_deposit(lender, SEED));
        assertLe(value, SEED, "the late payment isn't the lender's");
        assertGt(value, SEED - 1e15);
    }

    function test_settle_paymentAfterExitReachesALenderWhoKeptShares() public {
        _seedPool(SEED);
        uint256 id = _writtenOff(PER_CLAIM_CAP);
        uint256 keep = pool.convertToShares(1e18);
        uint256 shares = pool.balanceOf(lender) - keep;
        vm.prank(lender);
        pool.redeem(shares, lender, lender);

        _pay(guarantor, id, PER_CLAIM_CAP);
        assertApproxEqAbs(pool.previewRedeem(pool.balanceOf(lender)), 1e18 + PER_CLAIM_CAP, 1e6);
    }

    /// @dev Unpaid principal on a `GuarantorCalled` claim counts in full until `writeOff`, so with two lenders the
    /// first out during the grace gets par and the other takes the whole loss. Safe only while Frax is the one lender;
    /// a second lender needs an exit haircut first (U-79).
    function test_redeem_exitDuringTheGraceShiftsTheLossToTheOtherLender() public {
        address other = makeAddr("otherLender");
        vm.prank(admin);
        pool.setLenderAllowed(other, true);
        _seedPool(SEED);
        uint256 otherShares = _deposit(other, SEED);
        uint256 id = _guarantorCalled(PER_CLAIM_CAP);

        vm.prank(other);
        assertApproxEqAbs(pool.redeem(otherShares, other, other), SEED, 1, "out at par before the write-off");
        _writeOff(id);
        assertApproxEqAbs(pool.previewRedeem(pool.balanceOf(lender)), SEED - PER_CLAIM_CAP, 1, "the stayer eats it all");
    }

    /// @dev Found by the mainnet fork rehearsal: after a write-off, idle cash converted back to shares rounds a few
    /// share-wei under the last lender's balance, which used to make `redeem(balanceOf)` revert.
    function test_maxRedeem_lastLenderRedeemsEverythingAfterAWriteOff() public {
        _seedPool(SEED);
        uint256 id = _writtenOff(PER_CLAIM_CAP);
        assertEq(uint8(_state(id)), uint8(ClaimState.WrittenOff));
        assertEq(pool.totalAssets(), pool.idleCash(), "everything is cash again");

        uint256 shares = pool.balanceOf(lender);
        assertEq(pool.maxRedeem(lender), shares);
        vm.prank(lender);
        uint256 out = pool.redeem(shares, lender, lender);
        assertApproxEqAbs(out, SEED - PER_CLAIM_CAP, 1);
        assertEq(pool.totalSupply(), 0);
        assertLe(frxUSD.balanceOf(address(pool)), 1);
    }

    // ---------------------------------------------------------------- withdraw and redeem

    function test_withdraw_returnsAssets() public {
        _seedPool(SEED);
        vm.prank(lender);
        pool.withdraw(1_000e18, lender, lender);
        assertEq(frxUSD.balanceOf(lender), 1_000e18);
        assertEq(pool.totalAssets(), SEED - 1_000e18);
    }

    function test_withdraw_revertsAboveIdleCash() public {
        _seedPool(SEED);
        _funded(PER_CLAIM_CAP);
        uint256 idle = pool.idleCash();
        vm.prank(lender);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxWithdraw.selector, lender, idle + 1, idle));
        pool.withdraw(idle + 1, lender, lender);
    }

    function test_withdraw_worksWhilePaused() public {
        _seedPool(SEED);
        _pause();
        vm.prank(lender);
        pool.withdraw(SEED, lender, lender);
        assertEq(frxUSD.balanceOf(lender), SEED);
    }

    function test_redeem_returnsAssets() public {
        uint256 shares = _deposit(lender, SEED);
        vm.prank(lender);
        assertEq(pool.redeem(shares, lender, lender), SEED);
        assertEq(pool.totalSupply(), 0);
    }

    function test_redeem_revertsAboveIdleCash() public {
        _seedPool(SEED);
        _funded(PER_CLAIM_CAP);
        uint256 max = pool.maxRedeem(lender);
        uint256 balance = pool.balanceOf(lender);
        vm.prank(lender);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxRedeem.selector, lender, balance, max));
        pool.redeem(balance, lender, lender);
    }

    function test_redeem_worksWhilePaused() public {
        uint256 shares = _deposit(lender, SEED);
        _pause();
        vm.prank(lender);
        pool.redeem(shares, lender, lender);
        assertEq(frxUSD.balanceOf(lender), SEED);
    }

    // ---------------------------------------------------------------- registry-only hooks

    function test_fundPurchase_revertsForNonRegistry() public {
        _seedPool(SEED);
        vm.prank(admin);
        vm.expectRevert(OnlyRegistry.selector);
        pool.fundPurchase(admin, 1e18);
    }

    function test_fundPurchase_revertsWhenIdleCashShort() public {
        _seedPool(1e18);
        vm.prank(address(registry));
        vm.expectRevert(abi.encodeWithSelector(InsufficientIdleCash.selector, 2e18, 1e18));
        pool.fundPurchase(claimant, 2e18);
    }

    function test_fundPurchase_booksPrincipalAndPays() public {
        _seedPool(SEED);
        vm.expectEmit(address(pool));
        emit IReceivablesPool.PurchaseFunded(claimant, 1e18);
        vm.prank(address(registry));
        pool.fundPurchase(claimant, 1e18);
        assertEq(pool.outstandingPrincipal(), 1e18);
        assertEq(pool.idleCash(), SEED - 1e18);
        assertEq(pool.totalAssets(), SEED);
        assertEq(frxUSD.balanceOf(claimant), 1e18);
    }

    function test_recordPrincipalReturned_revertsForNonRegistry() public {
        vm.prank(admin);
        vm.expectRevert(OnlyRegistry.selector);
        pool.recordPrincipalReturned(0);
    }

    function test_recordPrincipalReturned_lowersOutstanding() public {
        uint256 id = _funded(FACE);
        frxUSD.mint(payer, 400e18);
        vm.startPrank(payer);
        frxUSD.approve(address(registry), 400e18);
        vm.expectEmit(address(pool));
        emit IReceivablesPool.PrincipalReturned(400e18);
        registry.settle(id, 400e18);
        vm.stopPrank();
        assertEq(pool.outstandingPrincipal(), FACE - 400e18);
    }

    function test_realizeLoss_revertsForNonRegistry() public {
        vm.prank(admin);
        vm.expectRevert(OnlyRegistry.selector);
        pool.realizeLoss(0);
    }

    function test_realizeLoss_lowersSharePriceAndBooksLoss() public {
        _seedPool(SEED);
        uint256 id = _guarantorCalled(FACE);
        uint256 priceBefore = _sharePrice();
        vm.warp(_claim(id).writeOffEligibleAt);
        vm.expectEmit(address(pool));
        emit IReceivablesPool.LossRealized(FACE);
        vm.prank(attester);
        registry.writeOff(id);
        assertEq(pool.totalLosses(), FACE);
        assertEq(pool.outstandingPrincipal(), 0);
        assertEq(pool.totalAssets(), SEED - FACE);
        assertLt(_sharePrice(), priceBefore);
    }

    // ---------------------------------------------------------------- accounting

    function test_totalAssets_isIdleCashPlusOutstandingPrincipal() public {
        _seedPool(SEED);
        _funded(PER_CLAIM_CAP);
        assertEq(pool.idleCash(), SEED - PER_CLAIM_CAP);
        assertEq(pool.outstandingPrincipal(), PER_CLAIM_CAP);
        assertEq(pool.totalAssets(), SEED);
    }

    function test_totalAssets_feeRaisesSharePrice() public {
        _seedPool(SEED);
        _setFee(1000);
        uint256 id = _funded(FACE);
        uint256 priceBefore = _sharePrice();
        vm.warp(vm.getBlockTimestamp() + 73 days);
        _pay(payer, id, registry.amountRemaining(id));
        assertEq(pool.totalAssets(), SEED + 20e18, "10% a year for a fifth of a year on 1,000");
        assertGt(_sharePrice(), priceBefore);
    }

    function test_totalAssets_donationRaisesSharePrice() public {
        _seedPool(SEED);
        uint256 priceBefore = _sharePrice();
        frxUSD.mint(address(pool), 1e18);
        assertGt(_sharePrice(), priceBefore);
    }

    function test_deposit_inflationAttackIsUnprofitable() public {
        address attacker = makeAddr("attacker");
        address victim = makeAddr("victim");
        vm.startPrank(admin);
        pool.setAllowlistEnabled(false);
        pool.setDepositCap(type(uint256).max);
        vm.stopPrank();

        _deposit(attacker, 1);
        uint256 donation = 10_000e18;
        frxUSD.mint(address(pool), donation);
        uint256 victimShares = _deposit(victim, 10_000e18);

        uint256 victimValue = pool.previewRedeem(victimShares);
        uint256 attackerValue = pool.previewRedeem(pool.balanceOf(attacker));
        assertGt(victimShares, 0);
        assertGe(victimValue, 10_000e18 * 9_999 / 10_000, "victim keeps at least 99.99%");
        // the 1e6 virtual shares soak up a large slice of the donation, so the attacker ends up far behind
        assertLt(attackerValue, donation * 3 / 4, "attacker loses at least a quarter of the donation");
    }

    function test_withdraw_afterCallAndRecovery() public {
        _seedPool(SEED);
        uint256 id = _funded(FACE);
        _callGuarantor(id, CallReason.PartialShortfall);
        _pay(guarantor, id, FACE);
        assertEq(pool.maxWithdraw(lender), SEED);
        vm.prank(lender);
        pool.withdraw(SEED, lender, lender);
    }

}
