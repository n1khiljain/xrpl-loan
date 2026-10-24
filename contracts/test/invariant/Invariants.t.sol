// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {console} from "forge-std/console.sol";
import {BaseTest} from "../utils/BaseTest.sol";
import {Handler} from "./Handler.sol";
import {Claim, ClaimState} from "../../src/libraries/ClaimTypes.sol";

/// @notice PRD section 13 invariants I-1 to I-8, run through `Handler` with `fail_on_revert = true`, 256 runs,
/// and depth 50 (foundry.toml).
contract InvariantsTest is StdInvariant, BaseTest {
    Handler internal handler;
    uint256 internal constant ACTORS = 3;
    bytes4[] internal _weighted;

    function _weight(bytes4 selector, uint256 times) internal {
        for (uint256 i = 0; i < times; i++) {
            _weighted.push(selector);
        }
    }

    function setUp() public override {
        super.setUp();

        address[] memory lenders = new address[](ACTORS);
        address[] memory members = new address[](ACTORS);
        address[] memory officers = new address[](ACTORS);
        uint256[] memory keys = new uint256[](ACTORS);
        uint64[] memory orgList = new uint64[](2);
        orgList[0] = orgId;
        orgList[1] = org2Id;

        vm.startPrank(admin);
        for (uint256 i = 0; i < ACTORS; i++) {
            lenders[i] = makeAddr(string.concat("lender-", vm.toString(i)));
            members[i] = makeAddr(string.concat("member-", vm.toString(i)));
            (officers[i], keys[i]) = makeAddrAndKey(string.concat("officer-", vm.toString(i)));
            pool.setLenderAllowed(lenders[i], true);
            orgs.setOfficer(orgId, officers[i], true);
            orgs.setOfficer(org2Id, officers[i], true);
        }
        vm.stopPrank();

        handler = new Handler(
            registry,
            pool,
            orgs,
            frxUSD,
            [admin, underwriter, attester, pauser],
            lenders,
            members,
            officers,
            keys,
            orgList
        );

        // start with a funded pool so purchases can happen early in a run
        handler.deposit(0, 30_000e18);

        // duplicates weight the fuzzer's pick: lifecycle steps run about 4x as often as admin knobs, so a
        // 50-call run pushes claims all the way through purchase, calls, write-offs, and recoveries
        _weight(Handler.fastTrack.selector, 3);
        _weight(Handler.submitClaim.selector, 3);
        _weight(Handler.approveClaim.selector, 3);
        _weight(Handler.purchaseClaim.selector, 3);
        _weight(Handler.settle.selector, 4);
        _weight(Handler.callGuarantor.selector, 3);
        _weight(Handler.writeOff.selector, 3);
        _weight(Handler.cancelClaim.selector, 1);
        _weight(Handler.rejectClaim.selector, 1);
        _weight(Handler.deposit.selector, 2);
        _weight(Handler.mint.selector, 1);
        _weight(Handler.withdraw.selector, 2);
        _weight(Handler.redeem.selector, 1);
        _weight(Handler.transferShares.selector, 1);
        _weight(Handler.donate.selector, 1);
        _weight(Handler.setParams.selector, 1);
        _weight(Handler.setDepositCap.selector, 1);
        _weight(Handler.setAllowlistEnabled.selector, 1);
        _weight(Handler.setOrgActive.selector, 1);
        _weight(Handler.setOrgCap.selector, 1);
        _weight(Handler.togglePause.selector, 1);
        _weight(Handler.warp.selector, 2);
        bytes4[] memory selectors = new bytes4[](_weighted.length);
        for (uint256 i = 0; i < _weighted.length; i++) {
            selectors[i] = _weighted[i];
        }
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    // ---------------------------------------------------------------- PRD section 13

    /// @dev I-1: totalAssets() == frxUSD.balanceOf(pool) + outstandingPrincipal.
    function invariant_I1_totalAssetsIsBalancePlusOutstanding() public view {
        assertEq(pool.totalAssets(), frxUSD.balanceOf(address(pool)) + pool.outstandingPrincipal());
    }

    /// @dev I-2: outstandingPrincipal is the unpaid principal across Funded and GuarantorCalled claims. The same
    /// sum per org must match `orgOutstanding`.
    function invariant_I2_outstandingPrincipalMatchesClaims() public view {
        uint256 total;
        uint256[] memory perOrg = new uint256[](3);
        uint256 count = registry.claimCount();
        for (uint256 id = 1; id <= count; id++) {
            Claim memory c = registry.getClaim(id);
            if (c.state != ClaimState.Funded && c.state != ClaimState.GuarantorCalled) continue;
            uint256 principalPaid = c.amountPaid < c.purchasePrice ? c.amountPaid : c.purchasePrice;
            uint256 unpaid = c.purchasePrice - principalPaid;
            total += unpaid;
            perOrg[c.orgId] += unpaid;
        }
        assertEq(pool.outstandingPrincipal(), total);
        assertEq(registry.orgOutstanding(orgId), perOrg[orgId]);
        assertEq(registry.orgOutstanding(org2Id), perOrg[org2Id]);
    }

    /// @dev I-3: amountPaid <= amountDue for every claim.
    function invariant_I3_amountPaidWithinAmountDue() public view {
        uint256 count = registry.claimCount();
        for (uint256 id = 1; id <= count; id++) {
            Claim memory c = registry.getClaim(id);
            assertLe(c.amountPaid, c.amountDue);
        }
    }

    /// @dev I-4: the share price never goes down except in writeOff, allowing 1 wei of rounding.
    function invariant_I4_sharePriceOnlyDropsOnWriteOff() public view {
        assertFalse(handler.ghostSharePriceDroppedOutsideWriteOff());
    }

    /// @dev I-5: at every purchase, the org's outstanding principal after the purchase is within its cap: the org's
    /// override if the admin set one, otherwise perOrgCap (U-69).
    function invariant_I5_purchasesStayWithinOrgCap() public view {
        assertFalse(handler.ghostOrgCapBreachedAtPurchase());
    }

    /// @dev I-6: terminal states never change, and WrittenOff can only move to Recovered.
    function invariant_I6_terminalStatesNeverChange() public view {
        assertFalse(handler.ghostTerminalStateChanged());
        assertFalse(handler.ghostWrittenOffMovedElsewhere());
    }

    /// @dev I-7: frxUSD leaves the pool only through purchaseClaim and lender withdraw or redeem. The balance must
    /// equal every tracked inflow minus those two outflows, no other action may lower it, and the registry never
    /// holds funds in transit.
    function invariant_I7_frxUSDLeavesOnlyThroughPurchaseOrWithdraw() public view {
        uint256 inflow = handler.ghostDeposited() + handler.ghostSettledIn() + handler.ghostDonated();
        uint256 outflow = handler.ghostPurchasedOut() + handler.ghostWithdrawnOut();
        assertEq(frxUSD.balanceOf(address(pool)), inflow - outflow);
        assertFalse(handler.ghostOutflowOutsideAllowedPath());
        assertEq(frxUSD.balanceOf(address(registry)), 0);
    }

    /// @dev I-8: the total value lenders can redeem never exceeds totalAssets(). What they can take out right now
    /// never exceeds idle cash.
    function invariant_I8_redeemableValueWithinTotalAssets() public view {
        uint256 redeemable;
        uint256 withdrawableNow;
        uint256 lenders = handler.lenderCount();
        for (uint256 i = 0; i < lenders; i++) {
            address lender = handler.lenders(i);
            redeemable += pool.previewRedeem(pool.balanceOf(lender));
            withdrawableNow += pool.maxWithdraw(lender);
        }
        assertLe(redeemable, pool.totalAssets());
        assertLe(pool.convertToAssets(pool.totalSupply()), pool.totalAssets());
        assertLe(withdrawableNow, pool.idleCash() * lenders);
        for (uint256 i = 0; i < lenders; i++) {
            assertLe(pool.maxWithdraw(handler.lenders(i)), pool.idleCash());
        }
    }

    /// @dev FR-C14 under random interleavings: while paused, maxDeposit and maxMint are 0 for every lender.
    function invariant_pause_closesDeposits() public view {
        assertFalse(handler.ghostDepositOpenWhilePaused());
    }

    /// @dev Prints how often each action ran, so a run shows the handler reached every path.
    function afterInvariant() public view {
        string[23] memory names = [
            "fastTrack",
            "deposit",
            "mint",
            "withdraw",
            "redeem",
            "transferShares",
            "donate",
            "submitClaim",
            "cancelClaim",
            "approveClaim",
            "rejectClaim",
            "purchaseClaim",
            "settle",
            "callGuarantor",
            "writeOff",
            "setParams",
            "setDepositCap",
            "setAllowlistEnabled",
            "setOrgActive",
            "setOrgCap",
            "togglePause",
            "warp",
            "claims"
        ];
        for (uint256 i = 0; i < 21; i++) {
            console.log(names[i], handler.calls(bytes32(bytes(names[i]))));
        }
        console.log(names[21], registry.claimCount());
        uint256[10] memory states = handler.stateCounts();
        string[10] memory stateNames = [
            "None",
            "Submitted",
            "Approved",
            "Funded",
            "GuarantorCalled",
            "Settled",
            "Recovered",
            "WrittenOff",
            "Rejected",
            "Cancelled"
        ];
        for (uint256 i = 1; i < 10; i++) {
            console.log(string.concat("  state ", stateNames[i]), states[i]);
        }
    }
}
