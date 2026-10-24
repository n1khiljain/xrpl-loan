// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BaseTest} from "../utils/BaseTest.sol";
import {StdStorage, stdStorage} from "forge-std/StdStorage.sol";
import {ReceivablesPool} from "../../src/ReceivablesPool.sol";
import {IReceivablesPool} from "../../src/interfaces/IReceivablesPool.sol";
import {
    CallReason,
    ClaimState,
    EmergencyModeActive,
    EmergencyModeInactive,
    InvalidEmergencyReceiver,
    InvalidParams,
    ZeroAddress,
    ZeroAmount
} from "../../src/libraries/ClaimTypes.sol";

/// @dev A transfer callback probes the emergency entry point while the pool is paying a shareholder.
contract EmergencyCallbackToken is ERC20("Callback", "CALL") {
    IReceivablesPool private _pool;
    bytes4 public callbackError;

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setPool(IReceivablesPool pool_) external {
        _pool = pool_;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (msg.sender == address(_pool)) {
            (bool success, bytes memory result) =
                address(_pool).call(abi.encodeCall(IReceivablesPool.emergencyWithdraw, (to)));
            if (success) revert InvalidParams();
            callbackError = bytes4(result);
        }
        return super.transfer(to, value);
    }
}

/// @notice Emergency closeout permissions, fair cash distribution, and rights to later recoveries (U-80).
contract EmergencyWithdrawTest is BaseTest {
    using stdStorage for StdStorage;

    function _activate() private {
        vm.prank(admin);
        pool.activateEmergencyMode();
    }

    function _claimCash(address owner) private returns (uint256) {
        vm.prank(owner);
        return pool.emergencyWithdraw(owner);
    }

    function _addLender(address owner, uint256 assets) private returns (uint256) {
        vm.prank(admin);
        pool.setLenderAllowed(owner, true);
        return _deposit(owner, assets);
    }

    function test_activateEmergencyMode_adminOnlyEvenWhenRegistryPaused() public {
        vm.prank(pauser);
        registry.pause();
        vm.prank(pauser);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, pauser, bytes32(0))
        );
        pool.activateEmergencyMode();
        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, outsider, bytes32(0))
        );
        pool.activateEmergencyMode();
        _activate();
        assertTrue(pool.emergencyMode());
    }

    function test_activateEmergencyMode_emitsAndCannotBeRepeated() public {
        _seedPool(SEED);
        uint256 shares = pool.totalSupply();
        vm.expectEmit(true, false, false, true, address(pool));
        emit IReceivablesPool.EmergencyModeActivated(admin, shares);
        _activate();
        vm.prank(admin);
        vm.expectRevert(EmergencyModeActive.selector);
        pool.activateEmergencyMode();
    }

    function test_emergencyWithdraw_requiresActivationAndShares() public {
        _seedPool(SEED);
        assertEq(pool.maxEmergencyWithdraw(lender), 0);
        vm.prank(lender);
        vm.expectRevert(EmergencyModeInactive.selector);
        pool.emergencyWithdraw(lender);
        _activate();
        vm.prank(outsider);
        vm.expectRevert(ZeroAmount.selector);
        pool.emergencyWithdraw(outsider);
        assertEq(pool.totalEmergencyWithdrawn(), 0);
        assertEq(pool.idleCash(), SEED);
    }

    function test_emergencyWithdraw_singleLenderGetsAllCashAndRetainsShares() public {
        _seedPool(SEED);
        uint256 shares = pool.balanceOf(lender);
        _activate();
        vm.expectEmit(true, true, false, true, address(pool));
        emit IReceivablesPool.EmergencyWithdrawal(lender, lender, SEED);
        assertEq(_claimCash(lender), SEED);
        assertEq(pool.balanceOf(lender), shares);
        assertEq(pool.totalSupply(), shares);
        assertEq(pool.idleCash(), 0);
        assertEq(pool.totalEmergencyWithdrawn(), SEED);
        assertEq(pool.emergencyWithdrawn(lender), SEED);
        assertEq(pool.maxEmergencyWithdraw(lender), 0);
        vm.prank(lender);
        vm.expectRevert(ZeroAmount.selector);
        pool.emergencyWithdraw(lender);
    }

    function test_emergencyWithdraw_ownerCanChooseReceiverButCannotSelfTransferToPool() public {
        _seedPool(SEED);
        _activate();
        vm.startPrank(lender);
        vm.expectRevert(ZeroAddress.selector);
        pool.emergencyWithdraw(address(0));
        vm.expectRevert(InvalidEmergencyReceiver.selector);
        pool.emergencyWithdraw(address(pool));
        assertEq(pool.totalEmergencyWithdrawn(), 0);
        assertEq(pool.emergencyWithdrawn(lender), 0);
        pool.emergencyWithdraw(outsider);
        vm.stopPrank();
        assertEq(frxUSD.balanceOf(outsider), SEED);
        assertEq(pool.emergencyWithdrawn(lender), SEED);
    }

    function test_emergencyWithdraw_regularPathsAndTransfersStayClosedAfterUnpause() public {
        _seedPool(SEED);
        uint256 id = _approved(FACE);
        uint256 shares = pool.balanceOf(lender);
        vm.prank(lender);
        pool.approve(outsider, shares);
        vm.prank(pauser);
        registry.pause();
        _activate();
        vm.prank(admin);
        registry.unpause();
        vm.startPrank(admin);
        pool.setDepositCap(type(uint256).max);
        pool.setAllowlistEnabled(false);
        vm.stopPrank();
        assertEq(pool.maxDeposit(lender), 0);
        assertEq(pool.maxMint(lender), 0);
        assertEq(pool.maxWithdraw(lender), 0);
        assertEq(pool.maxRedeem(lender), 0);
        vm.startPrank(lender);
        vm.expectRevert(EmergencyModeActive.selector);
        pool.deposit(1, lender);
        vm.expectRevert(EmergencyModeActive.selector);
        pool.mint(1, lender);
        vm.expectRevert(EmergencyModeActive.selector);
        pool.withdraw(1, lender, lender);
        vm.expectRevert(EmergencyModeActive.selector);
        pool.redeem(shares, lender, lender);
        vm.expectRevert(EmergencyModeActive.selector);
        pool.transfer(outsider, shares);
        vm.stopPrank();
        vm.prank(outsider);
        vm.expectRevert(EmergencyModeActive.selector);
        pool.transferFrom(lender, outsider, shares);
        vm.prank(claimant);
        vm.expectRevert(EmergencyModeActive.selector);
        registry.purchaseClaim(id);
        assertEq(uint8(_state(id)), uint8(ClaimState.Approved), "purchase effects roll back");
        assertEq(pool.outstandingPrincipal(), 0);
        assertEq(registry.orgOutstanding(orgId), 0);
        assertEq(pool.idleCash(), SEED);
        assertEq(_claimCash(lender), SEED);
    }

    function test_emergencyWithdraw_preservesOrdinarySettlementAndPostWriteOffRecoveryRights() public {
        _seedPool(SEED);
        uint256 live = _funded(FACE);
        uint256 bad = _guarantorCalled(PER_CLAIM_CAP);
        _activate();
        vm.prank(pauser);
        registry.pause();
        assertEq(_claimCash(lender), SEED - FACE - PER_CLAIM_CAP);
        _pay(payer, live, FACE);
        assertEq(_claimCash(lender), FACE);
        _writeOff(bad);
        assertEq(pool.maxEmergencyWithdraw(lender), 0);
        _pay(guarantor, bad, PER_CLAIM_CAP);
        assertEq(_claimCash(lender), PER_CLAIM_CAP);
        assertEq(pool.totalEmergencyWithdrawn(), SEED);
        assertEq(pool.outstandingPrincipal(), 0);
        assertEq(uint8(_state(bad)), uint8(ClaimState.Recovered));
    }

    function test_emergencyWithdraw_keepsRightsAfterCompleteLossAndZeroCash() public {
        _seedPool(PER_CLAIM_CAP);
        uint256 bad = _writtenOff(PER_CLAIM_CAP);
        _activate();
        assertEq(pool.totalAssets(), 0);
        assertEq(pool.maxEmergencyWithdraw(lender), 0);
        _pay(guarantor, bad, PER_CLAIM_CAP);
        assertEq(_claimCash(lender), PER_CLAIM_CAP);
        assertEq(pool.idleCash(), 0);
    }

    function test_emergencyWithdraw_multipleLendersShareIdleCashAndLaterRecoveries() public {
        _seedPool(SEED);
        _addLender(outsider, SEED);
        uint256 bad = _guarantorCalled(PER_CLAIM_CAP);
        _activate();
        vm.startPrank(admin);
        pool.setLenderAllowed(lender, false);
        pool.setLenderAllowed(outsider, false);
        vm.stopPrank();
        assertEq(_claimCash(outsider), SEED - PER_CLAIM_CAP / 2);
        assertEq(_claimCash(lender), SEED - PER_CLAIM_CAP / 2);
        assertEq(pool.idleCash(), 0);
        _writeOff(bad);
        _pay(guarantor, bad, PER_CLAIM_CAP);
        assertEq(_claimCash(lender), PER_CLAIM_CAP / 2);
        assertEq(_claimCash(outsider), PER_CLAIM_CAP / 2);
        assertEq(pool.emergencyWithdrawn(lender), SEED);
        assertEq(pool.emergencyWithdrawn(outsider), SEED);
    }

    function test_emergencyWithdraw_distributesFeesAlongsidePrincipal() public {
        _seedPool(SEED);
        _setFee(100);
        uint256 id = _funded(FACE);
        _activate();
        assertEq(_claimCash(lender), SEED - FACE);
        uint256 due = _claim(id).amountDue;
        _pay(payer, id, due);
        assertEq(_claimCash(lender), due);
        assertEq(pool.totalEmergencyWithdrawn(), SEED + due - FACE);
    }

    function test_emergencyWithdraw_failedTokenTransferRollsBackEntitlements() public {
        _seedPool(SEED);
        _activate();
        vm.mockCall(address(frxUSD), abi.encodeCall(IERC20.transfer, (lender, SEED)), abi.encode(false));
        vm.prank(lender);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(frxUSD)));
        pool.emergencyWithdraw(lender);
        assertEq(pool.totalEmergencyWithdrawn(), 0);
        assertEq(pool.emergencyWithdrawn(lender), 0);
        vm.clearMockedCalls();
        assertEq(_claimCash(lender), SEED);
    }

    function test_emergencyWithdraw_worksWhenNavOverflows() public {
        _seedPool(SEED);
        stdstore.target(address(pool)).sig("outstandingPrincipal()").checked_write(type(uint256).max);
        vm.expectRevert();
        pool.maxWithdraw(lender);
        _activate();
        assertEq(pool.maxMint(lender), 0);
        assertEq(pool.maxWithdraw(lender), 0);
        assertEq(pool.maxRedeem(lender), 0);
        assertEq(pool.maxEmergencyWithdraw(lender), SEED);
        assertEq(_claimCash(lender), SEED);
    }

    function test_emergencyWithdraw_worksWithBrokenRegistry() public {
        _seedPool(SEED);
        vm.etch(address(registry), hex"00");
        vm.expectRevert();
        pool.maxDeposit(lender);
        _activate();
        assertEq(pool.maxDeposit(lender), 0);
        assertEq(_claimCash(lender), SEED);
    }

    function test_emergencyWithdraw_blocksReentrancy() public {
        EmergencyCallbackToken token = new EmergencyCallbackToken();
        ReceivablesPool target = new ReceivablesPool(token, admin);
        token.setPool(target);
        vm.startPrank(admin);
        target.setDepositCap(SEED);
        target.setLenderAllowed(lender, true);
        vm.stopPrank();
        token.mint(lender, SEED);
        vm.startPrank(lender);
        token.approve(address(target), SEED);
        target.deposit(SEED, lender);
        vm.stopPrank();
        vm.prank(admin);
        target.activateEmergencyMode();
        vm.prank(lender);
        target.emergencyWithdraw(lender);
        assertEq(token.callbackError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(token.balanceOf(lender), SEED);
        assertEq(target.totalEmergencyWithdrawn(), SEED);
    }

    function test_emergencyWithdraw_emptyPoolHasNoRecipientOrAdminSweep() public {
        _activate();
        frxUSD.mint(address(pool), FACE);
        assertEq(pool.maxEmergencyWithdraw(admin), 0);
        assertEq(pool.maxEmergencyWithdraw(lender), 0);
        vm.prank(admin);
        vm.expectRevert(ZeroAmount.selector);
        pool.emergencyWithdraw(admin);
        assertEq(pool.idleCash(), FACE, "no ownership can be manufactured after activation");
    }

    function testFuzz_emergencyWithdraw_cashAndRecoveriesAreProRataRegardlessOfOrder(
        uint128 first,
        uint128 second,
        uint128 recovery,
        bool reverse
    ) public {
        first = uint128(bound(first, 1, 20_000e18));
        second = uint128(bound(second, 1, 20_000e18));
        recovery = uint128(bound(recovery, 1, 50_000e18));
        _seedPool(first);
        _addLender(outsider, second);
        uint256 supply = pool.totalSupply();
        uint256 lenderShares = pool.balanceOf(lender);
        uint256 otherShares = pool.balanceOf(outsider);
        _activate();
        if (reverse) {
            if (pool.maxEmergencyWithdraw(outsider) > 0) _claimCash(outsider);
            if (pool.maxEmergencyWithdraw(lender) > 0) _claimCash(lender);
        } else {
            if (pool.maxEmergencyWithdraw(lender) > 0) _claimCash(lender);
            if (pool.maxEmergencyWithdraw(outsider) > 0) _claimCash(outsider);
        }
        assertEq(pool.emergencyWithdrawn(lender), first);
        assertEq(pool.emergencyWithdrawn(outsider), second);
        assertEq(pool.idleCash(), 0);
        frxUSD.mint(address(pool), recovery); // settlements and direct transfers arrive as cash
        uint256 received = uint256(first) + second + recovery;
        uint256 entitledFirst = received * lenderShares / supply;
        uint256 entitledSecond = received * otherShares / supply;
        if (pool.maxEmergencyWithdraw(lender) > 0) _claimCash(lender);
        if (pool.maxEmergencyWithdraw(outsider) > 0) _claimCash(outsider);
        assertEq(pool.emergencyWithdrawn(lender), entitledFirst);
        assertEq(pool.emergencyWithdrawn(outsider), entitledSecond);
        assertEq(pool.totalEmergencyWithdrawn() + pool.idleCash(), received);
        assertLe(pool.idleCash(), 1, "only per-owner rounding dust can remain");
        assertEq(pool.balanceOf(lender), lenderShares);
        assertEq(pool.balanceOf(outsider), otherShares);
    }

    function testFuzz_emergencyWithdraw_repeatedReceiptsNeverOverpay(
        uint128 first,
        uint128 second,
        uint64[8] memory receipts
    ) public {
        first = uint128(bound(first, 1, 1e12));
        second = uint128(bound(second, 1, 1e12));
        _seedPool(first);
        _addLender(outsider, second);
        _activate();
        uint256 received = uint256(first) + second;
        for (uint256 i; i < receipts.length; ++i) {
            frxUSD.mint(address(pool), receipts[i]);
            received += receipts[i];
            address owner = i % 2 == 0 ? lender : outsider;
            uint256 available = pool.maxEmergencyWithdraw(owner);
            assertLe(available, pool.idleCash());
            if (available > 0) assertEq(_claimCash(owner), available);
            assertEq(pool.totalEmergencyWithdrawn() + pool.idleCash(), received);
            assertLe(pool.emergencyWithdrawn(lender), received * first / (uint256(first) + second));
            assertLe(pool.emergencyWithdrawn(outsider), received * second / (uint256(first) + second));
        }
        if (pool.maxEmergencyWithdraw(lender) > 0) _claimCash(lender);
        if (pool.maxEmergencyWithdraw(outsider) > 0) _claimCash(outsider);
        assertLe(pool.idleCash(), 1);
    }
}
