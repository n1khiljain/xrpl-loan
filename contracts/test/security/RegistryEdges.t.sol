// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {BaseTest} from "../utils/BaseTest.sol";
import {ReentrantERC1271Wallet} from "./mocks/ReentrantERC1271Wallet.sol";
import {
    CallReason,
    ClaimState,
    Params,
    RecipientType,
    SubmitClaimParams,
    EmergencyModeActive,
    InvalidGuaranty,
    DepositsPaused,
    NotOfficer
} from "../../src/libraries/ClaimTypes.sol";

/// @notice Workstream B2 and B6-B12: guaranty, approval, grace, emergency and pause edges of the claim registry.
contract RegistryEdgesTest is BaseTest {
    // ---------------------------------------------------------------- B2

    function _walletOwnerKey() internal pure returns (uint256) {
        return uint256(keccak256("walletOwner"));
    }

    /// @dev Sets up a reentering ERC-1271 guarantor and a `Submitted` claim it could cancel if its reentry worked.
    function _reentrantWallet() internal returns (ReentrantERC1271Wallet wallet, uint256 victimId) {
        address owner = vm.addr(_walletOwnerKey());
        wallet = new ReentrantERC1271Wallet(owner);
        vm.prank(admin);
        orgs.setOfficer(orgId, address(wallet), true);
        victimId =
            _submitWith(address(wallet), _params(orgId, RecipientType.Member, guarantor2, FACE, FACE), guarantor2Key);
        wallet.setReentry(address(registry), abi.encodeCall(registry.cancelClaim, (victimId)));
    }

    /// @notice Hypothesis: an ERC-1271 guarantor that changes state while validating cannot get a claim submitted,
    /// because the validation runs under `staticcall`.
    function test_submitClaim_reenteringErc1271GuarantorIsRejected() public {
        (ReentrantERC1271Wallet wallet, uint256 victimId) = _reentrantWallet();
        uint256 ownerKey = _walletOwnerKey();
        SubmitClaimParams memory p = _params(orgId, RecipientType.Member, address(wallet), FACE, FACE);
        uint256 deadline = _deadline();
        uint256 nonce = registry.nonces(address(wallet));
        bytes memory sig = _sign(ownerKey, claimant, p, nonce, deadline);

        uint256 gasBefore = gasleft();
        vm.prank(claimant);
        vm.expectRevert(InvalidGuaranty.selector);
        registry.submitClaim(p, deadline, sig);
        // the write under staticcall is an exceptional halt, so it burns the gas forwarded to the wallet
        emit log_named_uint("gas burned by the failed submission", gasBefore - gasleft());
        assertEq(uint8(_state(victimId)), uint8(ClaimState.Submitted), "the reentry did not land");
        assertEq(registry.nonces(address(wallet)), nonce, "the nonce rolled back");

        // control: the same signature works once the wallet stops reentering
        wallet.setReentry(address(0), "");
        vm.prank(claimant);
        registry.submitClaim(p, deadline, sig);
    }

    // ---------------------------------------------------------------- B6

    /// @dev FINDING B-6 (design limitation): guaranty nonces are ordered, so two guaranties an officer signs from
    /// the same live `nonces()` read invalidate each other, and an unsubmitted one blocks every later one.
    /// @notice Hypothesis: every guaranty an officer signs can be submitted until its deadline.
    function test_submitClaim_documentsSameNonceGuarantiesInvalidateEachOther() public {
        address claimantB = makeAddr("claimantB");
        uint256 n = registry.nonces(guarantor);
        uint256 deadline = _deadline();
        SubmitClaimParams memory a = _params(orgId, RecipientType.Member, guarantor, FACE, FACE);
        SubmitClaimParams memory b = _params(orgId, RecipientType.Member, guarantor, FACE, FACE);
        bytes memory sigA = _sign(guarantorKey, claimant, a, n, deadline);
        bytes memory sigB = _sign(guarantorKey, claimantB, b, n, deadline);
        bytes memory sigBNext = _sign(guarantorKey, claimantB, b, n + 1, deadline);

        // a guaranty signed ahead at n + 1 is unusable while A's (nonce n) is unsubmitted
        vm.prank(claimantB);
        vm.expectRevert(InvalidGuaranty.selector);
        registry.submitClaim(b, deadline, sigBNext);
        assertEq(registry.nonces(guarantor), n, "a failed submission does not consume the nonce");

        vm.prank(claimant);
        registry.submitClaim(a, deadline, sigA);
        // B's guaranty, signed from the same live nonce read, is now dead
        vm.prank(claimantB);
        vm.expectRevert(InvalidGuaranty.selector);
        registry.submitClaim(b, deadline, sigB);
        // only a fresh signature at n + 1 works
        vm.prank(claimantB);
        registry.submitClaim(b, deadline, sigBNext);
        assertEq(registry.nonces(guarantor), n + 2);
    }

    // ---------------------------------------------------------------- B7

    /// @notice Hypothesis: a claim cannot be purchased once its guarantor is no longer an active officer.
    /// Was FINDING B-7: `_checkPurchase` checked the org but not the officer.
    function test_purchaseClaim_revertsWhenGuarantorDeactivated() public {
        _seedPool(SEED);
        uint256 id = _approved(FACE);
        vm.prank(admin);
        orgs.setOfficer(orgId, guarantor, false);
        address recipient = _claim(id).recipient;
        vm.prank(recipient);
        vm.expectRevert(abi.encodeWithSelector(NotOfficer.selector, orgId, guarantor));
        registry.purchaseClaim(id);
        assertEq(uint8(_state(id)), uint8(ClaimState.Approved));
    }

    // ---------------------------------------------------------------- B8

    /// @dev FINDING B-8: the advance rate is enforced only in `submitClaim`; an approval (first or repeated) after
    /// the admin lowers `advanceRateBps` still approves the old, larger request.
    /// @notice Hypothesis: an approval after the advance rate is lowered cannot exceed the new rate of face value.
    function test_approveClaim_documentsLoweredAdvanceRateNotReapplied() public {
        uint256 id = _submit(FACE, FACE);
        _approve(id, FACE);
        Params memory p = defaultParams();
        p.advanceRateBps = 5000;
        _setParams(p);
        _approve(id, FACE);
        uint256 limit = uint256(FACE) * p.advanceRateBps / 10_000;
        emit log_named_uint("approved (wei)", _claim(id).approvedAmount);
        emit log_named_uint("advance limit at the new rate (wei)", limit);
        assertEq(_claim(id).approvedAmount, FACE);
        assertGt(_claim(id).approvedAmount, limit);
        assertGt(_claim(id).approvalExpiresAt, vm.getBlockTimestamp(), "and the re-approval restarted the expiry");
    }

    // ---------------------------------------------------------------- B9

    /// @dev FINDING B-9 (trusted roles): with `writeOffGrace = 1` the admin and attester can book a full loss one
    /// second after purchase; the grace window is only as long as the admin's latest `setParams`.
    /// @notice Hypothesis: a purchased claim cannot be written off within seconds of purchase.
    function test_writeOff_documentsOneSecondGraceAfterPurchase() public {
        Params memory p = defaultParams();
        p.writeOffGrace = 1;
        _setParams(p);
        uint256 id = _funded(FACE);
        uint256 purchasedAt = _claim(id).purchasedAt;
        uint256 priceBefore = _sharePrice();
        _callGuarantor(id, CallReason.AsucRejected);
        vm.warp(vm.getBlockTimestamp() + 1);
        vm.prank(attester);
        registry.writeOff(id);
        emit log_named_uint("seconds from purchase to write-off", vm.getBlockTimestamp() - purchasedAt);
        emit log_named_uint("loss booked (wei)", pool.totalLosses());
        assertEq(uint8(_state(id)), uint8(ClaimState.WrittenOff));
        assertEq(pool.totalLosses(), FACE);
        assertLt(_sharePrice(), priceBefore);
    }

    // ---------------------------------------------------------------- B10

    /// @notice Hypothesis: activating emergency mode with a live approval makes its purchase revert cleanly,
    /// leaving the org's outstanding, the NFT and the claim untouched.
    function test_purchaseClaim_liveApprovalAfterEmergencyRevertsCleanly() public {
        _seedPool(SEED);
        uint256 id = _approved(FACE);
        vm.prank(admin);
        pool.activateEmergencyMode();
        vm.prank(claimant);
        vm.expectRevert(EmergencyModeActive.selector);
        registry.purchaseClaim(id);
        assertEq(uint8(_state(id)), uint8(ClaimState.Approved));
        assertEq(registry.orgOutstanding(orgId), 0);
        assertEq(pool.outstandingPrincipal(), 0);
        assertEq(pool.idleCash(), SEED);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, id));
        nft.ownerOf(id);
        // the approval can still be closed out
        vm.prank(underwriter);
        registry.rejectClaim(id, REASON);
    }

    // ---------------------------------------------------------------- B11

    /// @notice Hypothesis: when principal was fully paid while `GuarantorCalled`, the write-off books no loss and
    /// paying the fee afterwards moves the claim to `Recovered` and raises NAV by exactly the fee.
    function test_settle_feeAfterFeeOnlyWriteOffRecoversWithoutLoss() public {
        _setFee(500);
        uint256 id = _funded(FACE);
        vm.warp(vm.getBlockTimestamp() + 365 days);
        _callGuarantor(id, CallReason.AsucRejected);
        _pay(guarantor, id, FACE);
        _writeOff(id);
        assertEq(_claim(id).writtenOffPrincipal, 0);
        assertTrue(_claim(id).principalWrittenOff, "flag set even with nothing written off");

        uint256 fee = registry.amountRemaining(id);
        uint256 assetsBefore = pool.totalAssets();
        uint256 outstandingBefore = pool.outstandingPrincipal();
        _pay(payer, id, fee);
        assertEq(fee, 50e18);
        assertEq(uint8(_state(id)), uint8(ClaimState.Recovered));
        assertEq(pool.totalLosses(), 0);
        assertEq(pool.totalAssets(), assetsBefore + fee, "NAV rises by the fee");
        assertEq(pool.outstandingPrincipal(), outstandingBefore);
        assertEq(registry.orgOutstanding(orgId), 0);
    }

    // ---------------------------------------------------------------- B12

    /// @notice Hypothesis: while the registry is paused, lenders can still exit or move shares, anyone can settle,
    /// claims can still be resolved, and emergency closeout still works; only new business stops.
    function test_pause_lenderExitAndClaimResolutionStayOpen() public {
        _seedPool(SEED);
        uint256 toSettle = _funded(FACE);
        uint256 toCall = _funded(FACE);
        uint256 toWriteOff = _guarantorCalled(FACE);
        uint256 toCancel = _submitDefault();
        uint256 toReject = _approved(FACE);
        vm.warp(_claim(toWriteOff).writeOffEligibleAt);
        vm.prank(pauser);
        registry.pause();

        // new business is closed
        frxUSD.mint(lender, 1e18);
        vm.startPrank(lender);
        frxUSD.approve(address(pool), 1e18);
        vm.expectRevert(DepositsPaused.selector);
        pool.deposit(1e18, lender);
        vm.stopPrank();
        vm.prank(claimant);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        registry.purchaseClaim(toReject);

        // resolution and exits stay open
        _pay(payer, toSettle, FACE);
        _callGuarantor(toCall, CallReason.AsucRejected);
        vm.prank(attester);
        registry.writeOff(toWriteOff);
        vm.prank(claimant);
        registry.cancelClaim(toCancel);
        vm.prank(underwriter);
        registry.rejectClaim(toReject, REASON);
        vm.startPrank(lender);
        pool.withdraw(1000e18, lender, lender);
        pool.redeem(pool.balanceOf(lender) / 10, lender, lender);
        pool.transfer(outsider, pool.balanceOf(lender) / 2);
        vm.stopPrank();
        assertEq(uint8(_state(toSettle)), uint8(ClaimState.Settled));
        assertEq(uint8(_state(toCall)), uint8(ClaimState.GuarantorCalled));
        assertEq(uint8(_state(toWriteOff)), uint8(ClaimState.WrittenOff));
        assertEq(uint8(_state(toCancel)), uint8(ClaimState.Cancelled));
        assertEq(uint8(_state(toReject)), uint8(ClaimState.Rejected));

        // emergency closeout works while paused, for every holder
        vm.prank(admin);
        pool.activateEmergencyMode();
        vm.prank(lender);
        assertGt(pool.emergencyWithdraw(lender), 0);
        vm.prank(outsider);
        assertGt(pool.emergencyWithdraw(outsider), 0);
        // and a settlement still reaches holders after that
        _pay(payer, toCall, FACE);
        assertEq(uint8(_state(toCall)), uint8(ClaimState.Recovered));
    }
}
