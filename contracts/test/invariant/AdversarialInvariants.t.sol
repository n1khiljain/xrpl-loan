// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {console} from "forge-std/console.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {BaseTest} from "../utils/BaseTest.sol";
import {AdversarialHandler, AdversarialActors} from "./AdversarialHandler.sol";
import {Claim, ClaimState, Params} from "../../src/libraries/ClaimTypes.sol";

/// @notice Security campaign Workstream C: I-1 to I-8 re-run under an adversarial handler, plus I-9 (holder
/// fairness), I-10 (loss accounting and the purchase flow identity) and I-11 (emergency conservation). Uses
/// `fail_on_revert = true`; run deep with `FOUNDRY_PROFILE=deep`.
contract AdversarialInvariantsTest is StdInvariant, BaseTest {
    AdversarialHandler internal handler;
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
            lenders[i] = makeAddr(string.concat("adv-lender-", vm.toString(i)));
            members[i] = makeAddr(string.concat("adv-member-", vm.toString(i)));
            (officers[i], keys[i]) = makeAddrAndKey(string.concat("adv-officer-", vm.toString(i)));
            pool.setLenderAllowed(lenders[i], true);
            orgs.setOfficer(orgId, officers[i], true);
            orgs.setOfficer(org2Id, officers[i], true);
        }
        // a non-zero fee from the start (20% a year on unpaid principal)
        Params memory p = registry.params();
        p.feeBps = 2_000;
        registry.setParams(p);
        vm.stopPrank();

        AdversarialActors memory actors = AdversarialActors({
            admin: admin,
            underwriter: underwriter,
            attester: attester,
            pauser: pauser,
            outsider: makeAddr("adv-outsider"),
            spender: makeAddr("adv-spender"),
            payer: makeAddr("adv-third-party-payer"),
            sink: makeAddr("adv-sink")
        });
        handler = new AdversarialHandler(
            registry, pool, orgs, frxUSD, actors, lenders, members, officers, keys, orgList
        );
        handler.bootstrap(lenders[0], 30_000e18);

        _weight(AdversarialHandler.fastTrack.selector, 4);
        _weight(AdversarialHandler.submitClaim.selector, 2);
        _weight(AdversarialHandler.approveClaim.selector, 3);
        _weight(AdversarialHandler.purchaseClaim.selector, 2);
        _weight(AdversarialHandler.overCapPurchaseAttempt.selector, 2);
        _weight(AdversarialHandler.settle.selector, 4);
        _weight(AdversarialHandler.callGuarantor.selector, 3);
        _weight(AdversarialHandler.writeOff.selector, 3);
        _weight(AdversarialHandler.cancelClaim.selector, 1);
        _weight(AdversarialHandler.rejectClaim.selector, 1);
        _weight(AdversarialHandler.deposit.selector, 3);
        _weight(AdversarialHandler.mint.selector, 2);
        _weight(AdversarialHandler.withdraw.selector, 2);
        _weight(AdversarialHandler.redeem.selector, 2);
        _weight(AdversarialHandler.transferShares.selector, 3);
        _weight(AdversarialHandler.donate.selector, 1);
        _weight(AdversarialHandler.outsiderDepositAttempt.selector, 1);
        _weight(AdversarialHandler.setParams.selector, 1);
        _weight(AdversarialHandler.setDepositCap.selector, 1);
        _weight(AdversarialHandler.setAllowlistEnabled.selector, 1);
        _weight(AdversarialHandler.setLenderAllowed.selector, 1);
        _weight(AdversarialHandler.setOrgActive.selector, 1);
        _weight(AdversarialHandler.setOrgCap.selector, 1);
        _weight(AdversarialHandler.setOfficer.selector, 1);
        _weight(AdversarialHandler.addOrg.selector, 1);
        _weight(AdversarialHandler.togglePause.selector, 1);
        _weight(AdversarialHandler.activateEmergencyMode.selector, 2);
        _weight(AdversarialHandler.emergencyWithdraw.selector, 3);
        _weight(AdversarialHandler.emergencyFrozenAttempt.selector, 1);
        _weight(AdversarialHandler.warp.selector, 2);
        bytes4[] memory selectors = new bytes4[](_weighted.length);
        for (uint256 i = 0; i < _weighted.length; i++) {
            selectors[i] = _weighted[i];
        }
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    // ---------------------------------------------------------------- PRD section 13, adversarial

    /// @dev I-1: totalAssets() == frxUSD.balanceOf(pool) + outstandingPrincipal.
    function invariant_I1_totalAssetsIsBalancePlusOutstanding() public view {
        assertEq(pool.totalAssets(), frxUSD.balanceOf(address(pool)) + pool.outstandingPrincipal());
    }

    /// @dev I-2: outstandingPrincipal and every org's outstanding equal the unpaid principal of Funded and
    /// GuarantorCalled claims (orgs added mid-run included).
    function invariant_I2_outstandingPrincipalMatchesClaims() public view {
        uint256 total;
        uint256 orgTotal = orgs.orgCount();
        uint256[] memory perOrg = new uint256[](orgTotal + 1);
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
        for (uint64 o = 1; o <= orgTotal; o++) {
            assertEq(registry.orgOutstanding(o), perOrg[o]);
        }
    }

    /// @dev I-3: amountPaid <= amountDue for every claim.
    function invariant_I3_amountPaidWithinAmountDue() public view {
        uint256 count = registry.claimCount();
        for (uint256 id = 1; id <= count; id++) {
            Claim memory c = registry.getClaim(id);
            assertLe(c.amountPaid, c.amountDue);
        }
    }

    /// @dev I-4 strengthened: on writeOff the price drops by mulDiv(1e24, unpaid, S + 1e6) within 2 wei; no
    /// other action except an emergency payout lowers it by more than 1 wei (warp included: unaccrued fee is not
    /// in totalAssets).
    function invariant_I4_sharePriceOnlyDropsOnWriteOff() public view {
        assertFalse(handler.ghostSharePriceDroppedOutsideWriteOff(), handler.ghostDetail());
        assertFalse(handler.ghostWriteOffDropMismatch(), handler.ghostDetail());
    }

    /// @dev I-5: every successful purchase stays within the org cap, and every attempt over the org cap or idle
    /// cash (or in emergency mode) reverts with exactly the matching error.
    function invariant_I5_purchasesStayWithinOrgCap() public view {
        assertFalse(handler.ghostOrgCapBreachedAtPurchase(), handler.ghostDetail());
        assertFalse(handler.ghostOverCapPurchaseSucceeded(), handler.ghostDetail());
        assertFalse(handler.ghostOverCapWrongError(), handler.ghostDetail());
    }

    /// @dev I-6: terminal states never change, and WrittenOff can only move to Recovered.
    function invariant_I6_terminalStatesNeverChange() public view {
        assertFalse(handler.ghostTerminalStateChanged());
        assertFalse(handler.ghostWrittenOffMovedElsewhere());
    }

    /// @dev I-7: the pool balance equals every tracked inflow minus purchases, lender exits and emergency payouts;
    /// no other action lowers it; the registry never holds funds.
    function invariant_I7_frxUSDLeavesOnlyThroughAllowedPaths() public view {
        uint256 inflow = handler.ghostDeposited() + handler.ghostSettledIn() + handler.ghostDonated();
        uint256 outflow = handler.ghostPurchasedOut() + handler.ghostWithdrawnOut() + handler.ghostEmergencyOut();
        assertEq(frxUSD.balanceOf(address(pool)), inflow - outflow);
        assertFalse(handler.ghostOutflowOutsideAllowedPath(), handler.ghostDetail());
        assertEq(frxUSD.balanceOf(address(registry)), 0);
    }

    /// @dev I-8: redeemable value of every holder (outsider included) is within totalAssets; what any holder
    /// can take now is within idle cash. The outsider can never deposit while the allowlist is on.
    function invariant_I8_redeemableValueWithinTotalAssets() public view {
        uint256 redeemable;
        uint256 n = handler.holderCount();
        for (uint256 i = 0; i < n; i++) {
            address h = handler.holders(i);
            redeemable += pool.previewRedeem(pool.balanceOf(h));
            assertLe(pool.maxWithdraw(h), pool.idleCash());
        }
        assertLe(redeemable, pool.totalAssets());
        assertLe(pool.convertToAssets(pool.totalSupply()), pool.totalAssets());
        assertFalse(handler.ghostOutsiderDepositSucceeded(), handler.ghostDetail());
        assertFalse(handler.ghostOutsiderDepositWrongError(), handler.ghostDetail());
        assertFalse(handler.ghostDepositOpenWhilePaused());
    }

    /// @dev Precondition for I-9 and I-11: every share is held by a tracked holder, and never by the pool.
    function invariant_I9_sharesHeldOnlyByTrackedHolders() public view {
        uint256 sum;
        uint256 n = handler.holderCount();
        for (uint256 i = 0; i < n; i++) {
            sum += pool.balanceOf(handler.holders(i));
        }
        assertEq(sum, pool.totalSupply());
        assertEq(pool.balanceOf(address(pool)), 0);
    }

    /// @dev I-9a: no action except writeOff and emergencyWithdraw lowers the redeemable value of a holder
    /// that is not its share owner or share receiver by more than 1 wei.
    function invariant_I9a_noCrossHolderTransfer() public view {
        assertFalse(handler.ghostI9aViolated(), handler.ghostDetail());
    }

    /// @dev I-9b: an action that moves no shares (settle, donate, writeOff, purchase, warp, emergencyWithdraw,
    /// admin knobs) moves each holder's value by its pro-rata slice of the NAV change, within 2 wei.
    function invariant_I9b_proRataOnNavEvents() public view {
        assertFalse(handler.ghostI9bViolated(), handler.ghostDetail());
    }

    /// @dev I-9c: each holder's value equals its net flows plus its pro-rata NAV slices, within its rounding
    /// budget (2 + ceil((A+1)/(S+1e6)) per action that changed A, S or the holder's balance, plus 2).
    function invariant_I9c_cumulativeValueMatchesFlows() public view {
        uint256 n = handler.holderCount();
        for (uint256 i = 0; i < n; i++) {
            address h = handler.holders(i);
            int256 expected = handler.ghostFlow(h) + handler.ghostNav(h);
            int256 actual = int256(pool.previewRedeem(pool.balanceOf(h)));
            uint256 gap = actual > expected ? uint256(actual - expected) : uint256(expected - actual);
            assertLe(gap, handler.ghostTol(h) + 2, string.concat("I-9c holder ", vm.toString(h)));
        }
    }

    /// @dev I-10: totalLosses equals the sum of writtenOffPrincipal, a booked loss implies the written-off flag,
    /// the flag implies WrittenOff or Recovered, and every purchased wei is outstanding, lost, or returned.
    function invariant_I10_lossAccountingAndFlowIdentity() public view {
        uint256 losses;
        uint256 count = registry.claimCount();
        for (uint256 id = 1; id <= count; id++) {
            Claim memory c = registry.getClaim(id);
            losses += c.writtenOffPrincipal;
            if (c.writtenOffPrincipal > 0) assertTrue(c.principalWrittenOff);
            if (c.principalWrittenOff) {
                assertTrue(c.state == ClaimState.WrittenOff || c.state == ClaimState.Recovered);
            }
        }
        assertEq(pool.totalLosses(), losses);
        assertEq(
            handler.ghostPurchasedOut(),
            pool.outstandingPrincipal() + pool.totalLosses() + handler.ghostPrincipalReturned()
        );
    }

    /// @dev I-11: from activation on, transfers, deposits, mints, withdrawals and redemptions revert with
    /// EmergencyModeActive, balances and supply are frozen, payouts add up, cash plus payouts equals
    /// what came in since activation, each holder's paid plus claimable equals its exact pro-rata slice, and at
    /// most |H| - 1 wei of rounding dust is unclaimable.
    function invariant_I11_emergencyConservation() public view {
        if (!handler.ghostEmergency()) {
            assertFalse(pool.emergencyMode());
            assertEq(pool.totalEmergencyWithdrawn(), 0);
            return;
        }
        assertTrue(pool.emergencyMode());
        assertFalse(handler.ghostEmergencyFreezeBroken(), handler.ghostDetail());
        uint256 n = handler.holderCount();
        uint256 s0 = handler.ghostS0();
        uint256 r = handler.ghostR();
        uint256 withdrawnSum;
        uint256 claimableSum;
        for (uint256 i = 0; i < n; i++) {
            address h = handler.holders(i);
            uint256 b0 = handler.ghostB0(h);
            assertEq(pool.balanceOf(h), b0, "I-11 balance moved");
            withdrawnSum += pool.emergencyWithdrawn(h);
            claimableSum += pool.maxEmergencyWithdraw(h);
            uint256 slice = s0 == 0 ? 0 : Math.mulDiv(r, b0, s0);
            assertEq(pool.emergencyWithdrawn(h) + pool.maxEmergencyWithdraw(h), slice, "I-11 slice");
        }
        assertEq(pool.totalSupply(), s0, "I-11 supply moved");
        assertEq(withdrawnSum, pool.totalEmergencyWithdrawn(), "I-11 payout sum");
        assertEq(pool.idleCash() + pool.totalEmergencyWithdrawn(), r, "I-11 cash conservation");
        if (s0 > 0) assertLe(pool.idleCash() - claimableSum, n - 1, "I-11 dust");
    }

    /// @dev Prints how often each action ran, so a run shows the handler reached every path.
    function afterInvariant() public view {
        string[35] memory names = [
            "fastTrack",
            "submitClaim",
            "approveClaim",
            "purchaseClaim",
            "overCapPurchaseAttempt",
            "settle",
            "settleThirdParty",
            "callGuarantor",
            "writeOff",
            "cancelClaim",
            "rejectClaim",
            "deposit",
            "mint",
            "withdraw",
            "withdrawViaSpender",
            "redeem",
            "redeemViaSpender",
            "transfer",
            "transferFrom",
            "donate",
            "outsiderDepositAttempt",
            "setParams",
            "setDepositCap",
            "setAllowlistEnabled",
            "setLenderAllowed",
            "setOrgActive",
            "setOrgCap",
            "setOfficer",
            "addOrg",
            "togglePause",
            "activateEmergencyMode",
            "emergencyWithdraw",
            "emergencyFrozenAttempt",
            "warp",
            "claims"
        ];
        for (uint256 i = 0; i < names.length - 1; i++) {
            console.log(names[i], handler.calls(bytes32(bytes(names[i]))));
        }
        console.log(names[names.length - 1], registry.claimCount());
        console.log("  overCap reverts (OrgCapExceeded)", handler.overCapReverts());
        console.log("  overCap reverts (InsufficientIdleCash)", handler.idleCashReverts());
        console.log("  overCap reverts (EmergencyModeActive)", handler.emergencyPurchaseReverts());
        console.log("  I-9b NAV events checked", handler.navEventsChecked());
        console.log("  I-4 write-offs with loss checked", handler.lossWriteOffsChecked());
        console.log("  I-9a holder checks", handler.crossHolderChecks());
        console.log("  emergency active", handler.ghostEmergency());
        console.log("  emergency at action", handler.emergencyAtAction());
        console.log("  actions", handler.actionCount());
        console.log("  outsider shares", pool.balanceOf(handler.outsider()));
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
