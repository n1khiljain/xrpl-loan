// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {BaseTest} from "../utils/BaseTest.sol";
import {DepositCapExceeded, CallReason} from "../../src/libraries/ClaimTypes.sol";

/// @notice Fuzz tests for pool limits and share price behavior (FR-C1 to FR-C4, FR-C12).
contract ReceivablesPoolFuzzTest is BaseTest {
    address internal lender2 = makeAddr("lender2");

    function setUp() public override {
        super.setUp();
        vm.prank(admin);
        pool.setLenderAllowed(lender2, true);
    }

    function testFuzz_deposit_respectsCap(uint256 cap, uint256 first, uint256 second) public {
        cap = bound(cap, 0, 1e30);
        vm.prank(admin);
        pool.setDepositCap(cap);
        first = bound(first, 0, cap);
        if (first > 0) _deposit(lender, first);

        second = bound(second, 1, 1e30);
        frxUSD.mint(lender2, second);
        vm.startPrank(lender2);
        frxUSD.approve(address(pool), second);
        if (first + second > cap) vm.expectRevert(DepositCapExceeded.selector);
        pool.deposit(second, lender2);
        vm.stopPrank();
        assertLe(pool.totalAssets(), cap);
    }

    function testFuzz_maxDeposit_isDepositable(uint256 cap, uint256 existing) public {
        cap = bound(cap, 1, 1e30);
        existing = bound(existing, 0, cap - 1);
        vm.prank(admin);
        pool.setDepositCap(cap);
        if (existing > 0) _deposit(lender, existing);
        uint256 max = pool.maxDeposit(lender2);
        assertEq(max, cap - existing);
        _deposit(lender2, max);
        assertEq(pool.maxDeposit(lender2), 0);
    }

    function testFuzz_maxMint_isMintable(uint256 existing, uint256 donation) public {
        existing = bound(existing, 1, POOL_CAP / 2);
        donation = bound(donation, 0, POOL_CAP / 4);
        _deposit(lender, existing);
        frxUSD.mint(address(pool), donation);
        uint256 shares = pool.maxMint(lender2);
        uint256 assets = pool.previewMint(shares);
        assertLe(assets, pool.maxDeposit(lender2));
        frxUSD.mint(lender2, assets);
        vm.startPrank(lender2);
        frxUSD.approve(address(pool), assets);
        pool.mint(shares, lender2);
        vm.stopPrank();
        assertLe(pool.totalAssets(), POOL_CAP);
    }

    function testFuzz_maxWithdraw_isWithdrawableAndTight(uint256 seed, uint128 price) public {
        seed = bound(seed, 1e18, POOL_CAP);
        price = uint128(bound(price, 1, PER_CLAIM_CAP < seed ? PER_CLAIM_CAP : seed));
        _deposit(lender, seed);
        _funded(price);
        uint256 max = pool.maxWithdraw(lender);
        assertLe(max, pool.idleCash());
        if (max < pool.previewRedeem(pool.balanceOf(lender))) {
            vm.prank(lender);
            vm.expectRevert(
                abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxWithdraw.selector, lender, max + 1, max)
            );
            pool.withdraw(max + 1, lender, lender);
        }
        vm.prank(lender);
        pool.withdraw(max, lender, lender);
    }

    function testFuzz_maxRedeem_isRedeemable(uint256 seed, uint128 price, uint16 feeBps, uint256 elapsed) public {
        seed = bound(seed, 1e18, POOL_CAP);
        price = uint128(bound(price, 1, PER_CLAIM_CAP < seed ? PER_CLAIM_CAP : seed));
        feeBps = uint16(bound(feeBps, 0, 10_000));
        _setFee(feeBps);
        _deposit(lender, seed);
        uint256 id = _funded(price);
        vm.warp(vm.getBlockTimestamp() + bound(elapsed, 0, 365 days));
        _pay(payer, id, price / 2 + 1);
        uint256 shares = pool.maxRedeem(lender);
        vm.prank(lender);
        uint256 assets = pool.redeem(shares, lender, lender);
        assertLe(assets, seed + _claim(id).amountDue);
    }

    function testFuzz_sharePrice_neverDropsOnDepositOrWithdraw(uint256 a, uint256 b, uint256 w, uint256 donation)
        public
    {
        a = bound(a, 1, POOL_CAP / 3);
        b = bound(b, 1, POOL_CAP / 3);
        donation = bound(donation, 0, POOL_CAP / 3);
        _deposit(lender, a);
        frxUSD.mint(address(pool), donation);
        uint256 price0 = _sharePrice();
        _deposit(lender2, b);
        uint256 price1 = _sharePrice();
        assertGe(price1, price0);
        w = bound(w, 0, pool.maxWithdraw(lender));
        vm.prank(lender);
        pool.withdraw(w, lender, lender);
        assertGe(_sharePrice(), price1);
    }

    /// @dev Whatever the loss and however much was paid before the write-off, the only lender can redeem every share
    /// once the pool is all cash, and gets every frxUSD in it but at most a wei.
    function testFuzz_maxRedeem_soleLenderRedeemsEverythingAfterLoss(uint256 seed, uint128 price, uint128 paid)
        public
    {
        seed = bound(seed, 1e18, POOL_CAP);
        price = uint128(bound(price, 1, PER_CLAIM_CAP < seed ? PER_CLAIM_CAP : seed));
        paid = uint128(bound(paid, 0, price - 1));
        uint256 shares = _deposit(lender, seed);
        uint256 id = _funded(price);
        _callGuarantor(id, CallReason.AsucRejected);
        if (paid > 0) _pay(payer, id, paid);
        _writeOff(id);

        assertEq(pool.maxRedeem(lender), shares);
        vm.prank(lender);
        uint256 out = pool.redeem(shares, lender, lender);
        assertApproxEqAbs(out, seed - price + paid, 1);
        assertLe(frxUSD.balanceOf(address(pool)), 1);
    }

    function testFuzz_writeOff_lowersSharePriceByLoss(uint256 seed, uint128 price) public {
        seed = bound(seed, 10e18, POOL_CAP);
        price = uint128(bound(price, 1e18, PER_CLAIM_CAP < seed ? PER_CLAIM_CAP : seed));
        uint256 shares = _deposit(lender, seed);
        uint256 id = _funded(price);
        _callGuarantor(id, CallReason.AsucRejected);
        uint256 valueBefore = pool.previewRedeem(shares);
        _writeOff(id);
        uint256 valueAfter = pool.previewRedeem(shares);
        assertLt(valueAfter, valueBefore);
        assertApproxEqAbs(valueBefore - valueAfter, price, 1, "the lender absorbs the unpaid principal");
    }

    function testFuzz_deposit_lendersGetProportionalShares(uint256 a, uint256 b) public {
        a = bound(a, 1e6, POOL_CAP / 2);
        b = bound(b, 1e6, POOL_CAP / 2);
        uint256 sharesA = _deposit(lender, a);
        uint256 sharesB = _deposit(lender2, b);
        assertApproxEqAbs(pool.previewRedeem(sharesA), a, 1);
        assertApproxEqAbs(pool.previewRedeem(sharesB), b, 1);
    }
}
