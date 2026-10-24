// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/console2.sol";
import {stdError} from "forge-std/StdError.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {BaseTest} from "../utils/BaseTest.sol";
import {LenderNotAllowed, DepositCapExceeded, CallReason} from "../../src/libraries/ClaimTypes.sol";

/// @notice Workstream A of the security campaign: share price and fairness between pool holders. Each test is a
/// hypothesis. Tests named `..._documents...` carry a `FINDING A-<n>` tag and assert the actual (unsafe) behaviour so
/// the suite stays green and catches any change; the rest assert the safe property.
contract PoolEconomicsTest is BaseTest {
    uint256 internal constant OFFSET = 1e6; // 10 ** _decimalsOffset()

    address internal lender2 = makeAddr("lender2");
    address internal lender3 = makeAddr("lender3");
    address internal spender = makeAddr("spender");

    function setUp() public override {
        super.setUp();
        vm.startPrank(admin);
        pool.setLenderAllowed(lender2, true);
        pool.setLenderAllowed(lender3, true);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- helpers

    function _value(address who) internal view returns (uint256) {
        return pool.previewRedeem(pool.balanceOf(who));
    }

    function _redeemAll(address who) internal returns (uint256) {
        uint256 shares = pool.balanceOf(who);
        vm.prank(who);
        return pool.redeem(shares, who, who);
    }

    /// @dev Buys `n` claims of `amount` each from org 1 and calls the guarantor on all of them at the same time.
    function _calledClaims(uint256 n, uint128 amount) internal returns (uint256[] memory ids) {
        ids = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            ids[i] = _approved(amount);
            _purchase(ids[i]);
        }
        for (uint256 i; i < n; ++i) {
            _callGuarantor(ids[i], CallReason.AsucRejected);
        }
    }

    function _writeOffAll(uint256[] memory ids) internal {
        for (uint256 i; i < ids.length; ++i) {
            _writeOff(ids[i]);
        }
    }

    /// @dev The only lender puts in `deposit`, the pool buys four 2,500 claims (the org cap) and writes all of them
    /// off. With `deposit == 10_000e18` this leaves totalAssets() == 0 while the lender's shares remain.
    function _wipeOut(uint256 deposit) internal returns (uint256[] memory ids) {
        _deposit(lender, deposit);
        ids = _calledClaims(4, PER_CLAIM_CAP);
        _writeOffAll(ids);
    }

    /// @dev True when price (totalAssets + 1) / (totalSupply + OFFSET) is at least the recorded one.
    function _priceNotBelow(uint256 assets0, uint256 supply0) internal view returns (bool) {
        return (pool.totalAssets() + 1) * (supply0 + OFFSET) >= (assets0 + 1) * (pool.totalSupply() + OFFSET);
    }

    // ================================================================ A1 zero-NAV recovery capture

    /// @notice A1: with every claim written off, a 1 frxUSD deposit by a second lender buys almost the whole pool, so
    /// it takes almost all of a later 2,500 recovery that belongs to the holder who bore the loss.
    /// @dev FINDING A-1: at totalAssets() == 0 the OZ formula mints assets * (S + 1e6) / 1 shares; the original holder
    /// keeps ~0% of the recovery.
    function test_settle_documentsZeroNavRecoveryCapturedByNewDepositor() public {
        uint256[] memory ids = _wipeOut(10_000e18);
        assertEq(pool.totalAssets(), 0, "zero NAV");
        uint256 supplyBefore = pool.totalSupply();
        assertGt(supplyBefore, 0, "shares remain");
        assertEq(pool.maxDeposit(lender2), POOL_CAP, "the cap does not bind at zero NAV");

        uint256 newShares = _deposit(lender2, 1e18);
        emit log_named_uint("shares held by the original lender", supplyBefore);
        emit log_named_uint("shares minted for 1 frxUSD", newShares);

        _pay(guarantor, ids[0], PER_CLAIM_CAP);
        uint256 recovery = PER_CLAIM_CAP;

        uint256 lenderValue = _value(lender);
        uint256 lender2Out = _redeemAll(lender2);
        uint256 keptBps = lenderValue * 10_000 / recovery;
        emit log_named_uint("recovery", recovery);
        emit log_named_uint("original lender can redeem", lenderValue);
        emit log_named_uint("new depositor redeemed (deposited 1e18)", lender2Out);
        emit log_named_uint("original lender keeps (bps of recovery)", keptBps);

        // the safe property would be lenderValue >= recovery * 99 / 100; the actual result is the opposite
        assertLt(lenderValue, 1e4, "the original holder keeps effectively nothing");
        assertGe(lender2Out, recovery + 1e18 - 1e4, "the 1 frxUSD depositor takes the whole recovery");
    }

    /// @notice A1 fuzz: for any deposit from 1 wei to 1,000 frxUSD at zero NAV, the new depositor takes at least half of
    /// the next recovery, and the original holder keeps at most half.
    /// @dev FINDING A-1: even a 1 wei deposit mints S + 1e6 shares and halves the original holder's claim on recoveries.
    function testFuzz_deposit_documentsZeroNavCaptureForAnyAmount(uint256 amount) public {
        amount = bound(amount, 1, 1000e18);
        uint256[] memory ids = _wipeOut(10_000e18);
        _deposit(lender2, amount);
        _pay(guarantor, ids[0], PER_CLAIM_CAP);
        _pay(guarantor, ids[1], PER_CLAIM_CAP);
        uint256 recovery = 2 * PER_CLAIM_CAP;

        uint256 lenderValue = _value(lender);
        uint256 lender2Value = _value(lender2);
        console2.log("deposit", amount);
        console2.log("original lender value", lenderValue);
        console2.log("new depositor value", lender2Value);

        assertLe(lenderValue, recovery / 2 + 1, "original holder keeps at most half");
        assertGe(lender2Value, amount + recovery * 49 / 100, "new depositor gains about half or more");
    }

    /// @notice A1 near-zero: with 1 frxUSD of NAV left over 10,000 frxUSD of shares, a 1 frxUSD deposit takes half of
    /// any later recovery.
    /// @dev FINDING A-1b: the capture is proportional to how far NAV has fallen, not only at exactly zero; a 1 frxUSD
    /// depositor takes ~1,250 of a 2,500 recovery.
    function test_settle_documentsNearZeroNavRecoveryCapture() public {
        uint256[] memory ids = _wipeOut(10_001e18);
        assertEq(pool.totalAssets(), 1e18, "1 frxUSD left");

        _deposit(lender2, 1e18);
        _pay(guarantor, ids[0], PER_CLAIM_CAP);

        uint256 lenderValue = _value(lender);
        uint256 lender2Value = _value(lender2);
        emit log_named_uint("original lender value (was 1e18 + all of a 2,500 recovery)", lenderValue);
        emit log_named_uint("new depositor value (deposited 1e18)", lender2Value);
        emit log_named_uint("new depositor gain", lender2Value - 1e18);

        assertApproxEqRel(lender2Value, (PER_CLAIM_CAP + 2e18) / 2, 1e12, "half the pool for 1 frxUSD");
        assertApproxEqRel(lenderValue, (PER_CLAIM_CAP + 2e18) / 2, 1e12, "the original holder loses half");
    }

    /// @notice A1 stranded: a recovery paid after every holder has left belongs to the virtual shares; no later
    /// depositor of any size can reach it, and nothing moves it (`execute` is gone, U-82).
    /// @dev FINDING A-1c: the whole recovery (2,500) is stranded; a fresh depositor gets back exactly what they put in.
    function test_settle_documentsRecoveryStrandedAfterEveryHolderLeft() public {
        uint256[] memory ids = _wipeOut(10_000e18);
        assertEq(_redeemAll(lender), 0, "redeeming at zero NAV pays nothing");
        assertEq(pool.totalSupply(), 0);

        _pay(guarantor, ids[0], PER_CLAIM_CAP);
        emit log_named_uint("stranded idle cash", pool.idleCash());

        uint256 big = POOL_CAP - PER_CLAIM_CAP;
        _deposit(lender2, big);
        uint256 back = _redeemAll(lender2);
        emit log_named_uint("depositor put in", big);
        emit log_named_uint("depositor got back", back);
        assertLe(back, big, "the depositor gets none of the recovery");
        assertEq(pool.idleCash(), PER_CLAIM_CAP + big - back, "the recovery stays in the pool");

    }

    // ================================================================ A2 sandwich at normal NAV

    /// @notice A2: a lender who deposits just before a recovery on a written-off claim and redeems right after takes a
    /// pro-rata slice of a loss they never bore.
    /// @dev FINDING A-2: depositing 20,000 the block before a 2,500 recovery returns ~1,333 profit (U-79).
    function test_settle_documentsRecoverySandwich() public {
        _seedPool(SEED);
        uint256 id = _writtenOff(PER_CLAIM_CAP);
        uint256 lenderBefore = _value(lender);

        _deposit(lender2, SEED);
        _pay(guarantor, id, PER_CLAIM_CAP);
        uint256 out = _redeemAll(lender2);

        uint256 gain = out - SEED;
        emit log_named_uint("sandwich gain", gain);
        emit log_named_uint("original lender gain", _value(lender) - lenderBefore);
        assertApproxEqRel(gain, uint256(PER_CLAIM_CAP) * SEED / (SEED + SEED - PER_CLAIM_CAP), 1e12);
        assertGt(gain, 1, "safe property (gain <= 1 wei) does not hold");
    }

    /// @notice A2 fee: the yearly fee is not in totalAssets until paid, so a payment that includes accrued fee is a step
    /// up in NAV that a just-in-time depositor can share.
    /// @dev FINDING A-2b: with a 10% fee and a claim open 180 days, a 20,000 depositor captures ~half the fee.
    function test_settle_documentsFeePaymentSandwich() public {
        _setFee(1000);
        _seedPool(SEED);
        uint256 id = _funded(PER_CLAIM_CAP);
        vm.warp(block.timestamp + 180 days);
        uint256 due = registry.amountRemaining(id);
        uint256 fee = due - PER_CLAIM_CAP;

        _deposit(lender2, SEED);
        _pay(claimant, id, due);
        uint256 gain = _redeemAll(lender2) - SEED;
        emit log_named_uint("fee paid", fee);
        emit log_named_uint("sandwich gain", gain);
        assertApproxEqRel(gain, fee / 2, 1e12, "half the fee to the just-in-time depositor");
    }

    // ================================================================ A3 grace-window exit

    /// @notice A3 worst case: a large lender who exits during the grace window leaves a small lender to bear the whole
    /// write-off, wiping the small lender out.
    /// @dev FINDING A-3: stayer with 10,000 of 40,000 loses 10,000 (100%) instead of a fair 2,500; 7,500 transferred.
    function test_redeem_documentsGraceExitWipesOutTheStayer() public {
        _deposit(lender, 10_000e18);
        _deposit(lender2, 30_000e18);
        uint256[] memory ids = _calledClaims(4, PER_CLAIM_CAP);

        uint256 exited = _redeemAll(lender2);
        _writeOffAll(ids);

        uint256 stayer = _value(lender);
        uint256 fairLoss = 10_000e18 * 10_000e18 / uint256(40_000e18);
        emit log_named_uint("exiter got back", exited);
        emit log_named_uint("stayer value after write-off", stayer);
        emit log_named_uint("loss shifted to the stayer", 10_000e18 - stayer - fairLoss);
        assertApproxEqAbs(exited, 30_000e18, 1, "exiter leaves at par");
        assertEq(stayer, 0, "stayer is wiped out");
    }

    /// @notice A3 fuzz: whatever the claim size, share split and partial guarantor payment, a lender who exits in the
    /// grace window moves its whole pro-rata share of the unpaid principal onto the lender who stays.
    /// @dev FINDING A-3: shifted loss = unpaid * exiterShare / total (bounded by the outstanding called principal).
    function testFuzz_redeem_documentsGraceExitLossTransfer(uint256 stay, uint256 exit, uint256 size, uint256 paid)
        public
    {
        stay = bound(stay, PER_CLAIM_CAP, 25_000e18);
        exit = bound(exit, 1e18, POOL_CAP - stay);
        size = bound(size, 1, PER_CLAIM_CAP);
        _deposit(lender, stay);
        _deposit(lender2, exit);
        uint256 id = _approved(uint128(size));
        _purchase(id);
        _callGuarantor(id, CallReason.AsucRejected);
        paid = bound(paid, 0, size - 1);
        if (paid > 0) _pay(guarantor, id, paid);
        uint256 unpaid = size - paid;

        uint256 exited = _redeemAll(lender2);
        _writeOff(id);

        uint256 stayerValue = _value(lender);
        uint256 shifted = unpaid * exit / (stay + exit);
        console2.log("unpaid principal", unpaid);
        console2.log("loss shifted to stayer", shifted);
        assertApproxEqAbs(exited, exit, 1, "exiter out at par");
        assertApproxEqAbs(stayerValue, stay - unpaid, 2, "stayer bears the whole unpaid principal");
    }

    // ================================================================ A4 rounding cycles after a loss

    /// @notice A4: after a partial write-off, any number of tiny deposit/redeem and mint/withdraw cycles by one lender
    /// never raise that lender's wealth, never lower the share price and never lower another lender's value.
    function testFuzz_deposit_roundingCyclesAfterALossDontProfit(
        uint256 n,
        uint256 amount,
        uint256 paid,
        uint256 deposit2
    ) public {
        n = bound(n, 1, 25);
        amount = bound(amount, 1, 1e6);
        deposit2 = bound(deposit2, 1, 20_000e18);
        _seedPool(SEED);
        _deposit(lender2, deposit2);
        uint256 id = _guarantorCalled(PER_CLAIM_CAP);
        paid = bound(paid, 0, PER_CLAIM_CAP - 1);
        if (paid > 0) _pay(guarantor, id, paid);
        _writeOff(id);

        frxUSD.mint(lender2, 10e18);
        vm.prank(lender2);
        frxUSD.approve(address(pool), type(uint256).max);
        uint256 wealth0 = frxUSD.balanceOf(lender2) + _value(lender2);
        uint256 lenderValue0 = _value(lender);

        for (uint256 i; i < n; ++i) {
            uint256 assets0 = pool.totalAssets();
            uint256 supply0 = pool.totalSupply();
            uint256 x = amount * (i + 1);
            vm.startPrank(lender2);
            uint256 s = pool.deposit(x, lender2);
            pool.redeem(s, lender2, lender2);
            pool.mint(x, lender2);
            uint256 w = x % 7 + 1;
            uint256 maxW = pool.maxWithdraw(lender2);
            pool.withdraw(w < maxW ? w : maxW, lender2, lender2);
            vm.stopPrank();
            assertTrue(_priceNotBelow(assets0, supply0), "price never drops");
        }
        assertLe(frxUSD.balanceOf(lender2) + _value(lender2), wealth0, "cycling never pays");
        assertGe(_value(lender), lenderValue0, "the other lender never loses");
    }

    // ================================================================ A5 shares held off the allowlist

    /// @notice A5: an outsider who receives shares by transfer can redeem and withdraw no more than those shares are
    /// worth, cannot deposit, and a non-allowlisted spender can redeem only within its allowance.
    /// @dev BY-DESIGN (U-42): transfers are unrestricted, so off-allowlist addresses can hold and exit shares.
    function test_redeem_outsiderExtractsOnlyTheValueOfTransferredShares() public {
        _seedPool(SEED);
        _writtenOff(PER_CLAIM_CAP);
        uint256 half = pool.balanceOf(lender) / 2;
        vm.prank(lender);
        pool.transfer(outsider, half);

        assertEq(pool.maxDeposit(outsider), 0);
        frxUSD.mint(outsider, 1e18);
        vm.startPrank(outsider);
        frxUSD.approve(address(pool), 1e18);
        vm.expectRevert(abi.encodeWithSelector(LenderNotAllowed.selector, outsider));
        pool.deposit(1e18, outsider);
        vm.stopPrank();

        uint256 worth = pool.convertToAssets(half);
        vm.prank(outsider);
        uint256 got = pool.redeem(half / 2, outsider, outsider);
        uint256 maxW = pool.maxWithdraw(outsider);
        vm.prank(outsider);
        pool.withdraw(maxW, outsider, outsider);
        uint256 total = got + maxW;
        assertLe(total, worth, "never more than the shares are worth");
        assertApproxEqAbs(total, worth, 2);

        // a third party with an allowance can move only that allowance
        vm.prank(lender);
        pool.approve(spender, 1e24);
        uint256 lenderShares = pool.balanceOf(lender);
        vm.prank(spender);
        uint256 viaSpender = pool.redeem(1e24, spender, lender);
        assertEq(pool.balanceOf(lender), lenderShares - 1e24);
        assertLe(viaSpender, 1e18, "spender gets at most the value of 1e24 shares");
        vm.prank(spender);
        vm.expectRevert();
        pool.redeem(1, spender, lender);
    }

    /// @notice A5 fuzz: an outsider's withdrawal from transferred shares is capped by idle cash and by share value.
    function testFuzz_withdraw_outsiderCappedByIdleCashAndValue(uint256 sharesFrac, uint256 claims) public {
        claims = bound(claims, 0, 4);
        _deposit(lender, 10_000e18);
        for (uint256 i; i < claims; ++i) {
            _purchase(_approved(PER_CLAIM_CAP - 1e18));
        }
        uint256 bal = pool.balanceOf(lender);
        uint256 give = bound(sharesFrac, 1, bal);
        vm.prank(lender);
        pool.transfer(outsider, give);

        uint256 maxW = pool.maxWithdraw(outsider);
        assertLe(maxW, pool.idleCash());
        assertLe(maxW, pool.convertToAssets(give));
        vm.prank(outsider);
        pool.withdraw(maxW, outsider, outsider);
        assertEq(frxUSD.balanceOf(outsider), maxW);
    }

    // ================================================================ A6 max exits always executable

    /// @notice A6: after a loss, with three lenders of very unequal size and idle cash possibly short, each lender can
    /// always `withdraw(maxWithdraw)` and then `redeem(maxRedeem)` without a revert.
    function testFuzz_maxWithdraw_executableAfterALoss(
        uint256 d1,
        uint256 d2,
        uint256 d3,
        uint256 size,
        uint256 paid,
        uint256 size2,
        uint256 order
    ) public {
        d1 = bound(d1, 1, 25_000e18);
        d2 = bound(d2, 1, 20_000e18);
        d3 = bound(d3, 1, POOL_CAP - d1 - d2);
        _deposit(lender, d1);
        _deposit(lender2, d2);
        _deposit(lender3, d3);
        uint256 total = d1 + d2 + d3;

        size = bound(size, 1, total < PER_CLAIM_CAP ? total : PER_CLAIM_CAP);
        uint256 id = _approved(uint128(size));
        _purchase(id);
        _callGuarantor(id, CallReason.AsucRejected);
        paid = bound(paid, 0, size - 1);
        if (paid > 0) _pay(guarantor, id, paid);
        _writeOff(id);

        uint256 idle = pool.idleCash();
        size2 = bound(size2, 0, idle < PER_CLAIM_CAP ? idle : PER_CLAIM_CAP);
        if (size2 > 0) _purchase(_approved(uint128(size2)));

        address[3] memory who = [lender, lender2, lender3];
        order %= 3;
        for (uint256 k; k < 3; ++k) {
            address w = who[(order + k) % 3];
            uint256 maxW = pool.maxWithdraw(w);
            vm.prank(w);
            pool.withdraw(maxW, w, w);
            uint256 maxR = pool.maxRedeem(w);
            vm.prank(w);
            pool.redeem(maxR, w, w);
        }
    }

    // ================================================================ A7 donation fills the cap

    /// @notice A7: an outsider can donate frxUSD until the cap counts as full and block every deposit; the donation is a
    /// gift to holders, so it is a paid griefing of new deposits only.
    /// @dev FINDING A-7: donating cap - totalAssets (30,000 here) sets maxDeposit to 0 for every lender.
    function test_deposit_documentsDonationFillsTheCap() public {
        _seedPool(SEED);
        uint256 donation = POOL_CAP - pool.totalAssets();
        frxUSD.mint(outsider, donation);
        vm.prank(outsider);
        frxUSD.transfer(address(pool), donation);

        assertEq(pool.maxDeposit(lender2), 0, "no room left");
        frxUSD.mint(lender2, 1);
        vm.startPrank(lender2);
        frxUSD.approve(address(pool), 1);
        vm.expectRevert(DepositCapExceeded.selector);
        pool.deposit(1, lender2);
        vm.stopPrank();
        emit log_named_uint("donation needed to block deposits", donation);
        assertApproxEqAbs(_value(lender), SEED + donation, 2, "the donor pays the existing holders");
    }

    // ================================================================ A8 idle-cash race

    /// @notice A8: a purchase that lands between reading `maxWithdraw` and calling `withdraw` makes the stale amount
    /// revert; nothing is lost and a retry with a fresh `maxWithdraw` succeeds.
    /// @dev BY-DESIGN (FR-C4): the web app must re-read maxWithdraw and retry.
    function test_withdraw_staleMaxRevertsWithoutLossAfterAPurchase() public {
        _seedPool(SEED);
        uint256 stale = pool.maxWithdraw(lender);
        uint256 before = _value(lender);
        _purchase(_approved(PER_CLAIM_CAP));
        uint256 fresh = pool.maxWithdraw(lender);

        vm.prank(lender);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxWithdraw.selector, lender, stale, fresh));
        pool.withdraw(stale, lender, lender);
        assertEq(_value(lender), before, "nothing lost");

        vm.prank(lender);
        pool.withdraw(fresh, lender, lender);
        assertEq(frxUSD.balanceOf(lender), fresh);
    }

    // ================================================================ A9 zero-value exits on behalf of a stranger

    /// @notice A9: anyone can call `redeem(0, x, victim)` / `withdraw(0, x, victim)` without an allowance; it moves
    /// nothing but emits a `Withdraw` event naming the victim as owner.
    /// @dev FINDING A-9: zero-value calls on behalf of any owner succeed and emit Withdraw(owner = victim); harmless
    /// on-chain, but an indexer that trusts Withdraw events records phantom exits.
    function test_redeem_documentsZeroValueCallOnBehalfOfAStranger() public {
        _seedPool(SEED);
        uint256 shares = pool.balanceOf(lender);
        assertEq(pool.allowance(lender, outsider), 0);

        vm.expectEmit(true, true, true, true, address(pool));
        emit IERC4626.Withdraw(outsider, outsider, lender, 0, 0);
        vm.prank(outsider);
        pool.redeem(0, outsider, lender);

        vm.expectEmit(true, true, true, true, address(pool));
        emit IERC4626.Withdraw(outsider, outsider, lender, 0, 0);
        vm.prank(outsider);
        pool.withdraw(0, outsider, lender);

        assertEq(pool.balanceOf(lender), shares, "victim untouched");
        assertEq(frxUSD.balanceOf(outsider), 0);
    }

    // ================================================================ extras

    /// @notice Extra: a lender who deposits during the grace window enters at par and bears a pro-rata share of a loss
    /// that was already public (the mirror of A3).
    /// @dev FINDING A-10: deposits stay open while GuarantorCalled principal is valued at par, so an uninformed
    /// depositor buys into a known loss (20,000 entering loses ~1,333 of a 2,500 write-off).
    function test_deposit_documentsEntryDuringTheGraceBuysIntoAKnownLoss() public {
        _seedPool(SEED);
        uint256 id = _guarantorCalled(PER_CLAIM_CAP);
        _deposit(lender2, SEED);
        _writeOff(id);
        uint256 loss = SEED - _value(lender2);
        emit log_named_uint("late depositor loss", loss);
        assertApproxEqRel(loss, uint256(PER_CLAIM_CAP) / 2, 1e12);
    }

    /// @notice Extra: in emergency mode, holders claiming in any order, with a recovery landing between claims, each
    /// receive their pro-rata share and the total never exceeds what the pool received.
    function testFuzz_emergencyWithdraw_orderAndLateRecoveryStayProRata(
        uint256 d1,
        uint256 d2,
        uint256 d3,
        uint256 order,
        uint256 recoveryAt
    ) public {
        d1 = bound(d1, 1, 20_000e18);
        d2 = bound(d2, 1, 20_000e18);
        d3 = bound(d3, 1, POOL_CAP - d1 - d2 - PER_CLAIM_CAP);
        _deposit(lender, d1);
        _deposit(lender2, d2);
        _deposit(lender3, d3);
        if (pool.idleCash() < PER_CLAIM_CAP) _deposit(lender, PER_CLAIM_CAP);
        uint256 id = _guarantorCalled(PER_CLAIM_CAP);
        vm.prank(admin);
        pool.activateEmergencyMode();

        address[3] memory who = [lender, lender2, lender3];
        uint256 supply = pool.totalSupply();
        recoveryAt = recoveryAt % 4;
        order %= 3;
        uint256 paidOut;
        for (uint256 k; k < 4; ++k) {
            if (k == recoveryAt) _pay(guarantor, id, PER_CLAIM_CAP);
            if (k == 3) break;
            address w = who[(order + k) % 3];
            if (pool.maxEmergencyWithdraw(w) == 0) continue;
            uint256 before = frxUSD.balanceOf(w);
            vm.prank(w);
            pool.emergencyWithdraw(w);
            paidOut += frxUSD.balanceOf(w) - before;
        }
        // whoever claimed before the recovery claims again for their share of it
        for (uint256 k; k < 3; ++k) {
            address w = who[k];
            uint256 more = pool.maxEmergencyWithdraw(w);
            if (more > 0) {
                vm.prank(w);
                pool.emergencyWithdraw(w);
                paidOut += more;
            }
        }
        uint256 received = pool.idleCash() + paidOut;
        for (uint256 k; k < 3; ++k) {
            address w = who[k];
            assertEq(pool.emergencyWithdrawn(w), received * pool.balanceOf(w) / supply, "pro-rata");
        }
        assertLe(paidOut, received);
        assertLt(pool.idleCash(), 3, "only rounding dust stays");
    }

    /// @notice Extra: each full wipe-out multiplies the share supply by the next deposit (in wei), so repeated
    /// zero-NAV events eventually overflow the share math and freeze deposits (`maxMint` no longer reverts, D-3).
    /// @dev FINDING A-11: after three 100% wipe-outs, refilled with 10,000 frxUSD each time, a 10,000 deposit reverts
    /// with an overflow panic (Info: needs three total losses; same fix as A-1).
    function test_deposit_documentsRepeatedWipeOutsOverflowShareMath() public {
        _wipeOut(10_000e18);
        for (uint256 round; round < 2; ++round) {
            _deposit(lender2, 10_000e18);
            _writeOffAll(_calledClaims(4, PER_CLAIM_CAP));
            assertEq(pool.totalAssets(), 0);
            emit log_named_uint("supply after wipe-out", pool.totalSupply());
        }
        frxUSD.mint(lender2, 10_000e18);
        vm.startPrank(lender2);
        frxUSD.approve(address(pool), 10_000e18);
        vm.expectRevert(stdError.arithmeticError);
        pool.deposit(10_000e18, lender2);
        vm.stopPrank();
        // maxMint underestimates instead of reverting since the D-3 fix
        pool.maxMint(lender2);
    }
}
