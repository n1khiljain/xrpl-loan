// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ClaimRegistry} from "../../src/ClaimRegistry.sol";
import {ReceivablesPool} from "../../src/ReceivablesPool.sol";
import {ClaimNFT} from "../../src/ClaimNFT.sol";
import {OrgRegistry} from "../../src/OrgRegistry.sol";
import {MockFrxUSD} from "../../src/mocks/MockFrxUSD.sol";
import {Claim, ClaimState, Params, RecipientType, SubmitClaimParams} from "../../src/libraries/ClaimTypes.sol";

/// @notice An officer wallet that accepts every ERC-1271 signature, so the symbolic run needs no ecrecover.
contract HalmosOfficer {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0x1626ba7e;
    }
}

/// @notice Stands in for the registry so the pool's registry-only bookkeeping can be driven with symbolic amounts.
contract HalmosFakeRegistry {
    ReceivablesPool public pool;

    function setPool(ReceivablesPool pool_) external {
        pool = pool_;
    }

    function paused() external pure returns (bool) {
        return false;
    }

    function fund(address to, uint256 amount) external {
        pool.fundPurchase(to, amount);
    }

    function loss(uint256 amount) external {
        pool.realizeLoss(amount);
    }

    function returned(uint256 amount) external {
        pool.recordPrincipalReturned(amount);
    }
}

/// @notice Security campaign, Workstream D item 3: Halmos symbolic checks. Every function is `check_*`, so plain
/// `forge test` ignores them; run with
///   halmos --match-path test/security/Halmos.t.sol --solver-timeout-assertion 0
/// The registry's fee math is private, so the fee checks (1, 2) replicate its exact expression
/// (`ClaimRegistry._pendingFee`, ClaimRegistry.sol:495-501); the settle checks (3) go through the deployed
/// registry's public `settle` and `amountRemaining`; the pool checks (4, 5) run on a deployed pool.
contract HalmosTest is Test {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant FEE_YEAR = 365 days;
    uint256 internal constant START = 1_790_000_000;

    MockFrxUSD internal token;
    OrgRegistry internal orgs;
    ClaimNFT internal nft;
    ReceivablesPool internal pool;
    ClaimRegistry internal registry;
    HalmosOfficer internal officer;
    uint64 internal org;
    // the block time, tracked by hand so nothing reads it back after vm.warp (forge-lint)
    uint256 internal _now;

    // pool-only system for the ERC-4626 and emergency checks
    ReceivablesPool internal vault;
    HalmosFakeRegistry internal fake;

    address internal constant LENDER = address(0x1001);
    address internal constant LENDER2 = address(0x1002);
    address internal constant MEMBER = address(0x2001);
    address internal constant PAYER = address(0x3001);

    function setUp() public {
        _now = START;
        vm.warp(_now);
        token = new MockFrxUSD();
        orgs = new OrgRegistry(address(this));
        nft = new ClaimNFT(address(this));
        pool = new ReceivablesPool(IERC20(address(token)), address(this));
        registry = new ClaimRegistry(
            address(this),
            pool,
            nft,
            orgs,
            Params({
                advanceRateBps: 10_000,
                feeBps: 0,
                perClaimCap: type(uint128).max,
                perOrgCap: type(uint128).max,
                overdueWindow: 180 days,
                approvalExpiry: 14 days,
                writeOffGrace: 60 days
            })
        );
        pool.setRegistry(address(registry));
        nft.setRegistry(address(registry));
        pool.setDepositCap(type(uint256).max);
        pool.setAllowlistEnabled(false);
        registry.grantRole(registry.UNDERWRITER_ROLE(), address(this));
        registry.grantRole(registry.ATTESTER_ROLE(), address(this));
        officer = new HalmosOfficer();
        org = orgs.addOrg("Org");
        orgs.setOfficer(org, address(officer), true);

        fake = new HalmosFakeRegistry();
        vault = new ReceivablesPool(IERC20(address(token)), address(this));
        fake.setPool(vault);
        vault.setRegistry(address(fake));
        vault.setDepositCap(type(uint256).max);
        vault.setAllowlistEnabled(false);
    }

    // ---------------------------------------------------------------- 1, 2: fee math (replicated expression)

    function _pendingFee(uint256 unpaid, uint256 feeBps, uint256 elapsed) internal pure returns (uint256) {
        return Math.mulDiv(unpaid, feeBps * elapsed, BPS * FEE_YEAR, Math.Rounding.Ceil);
    }

    /// The fee is monotone in elapsed time.
    function check_fee_monotoneInElapsed(uint128 unpaid, uint16 feeBps, uint40 e1, uint40 e2) public pure {
        vm.assume(feeBps <= BPS);
        vm.assume(e1 <= e2);
        assert(_pendingFee(unpaid, feeBps, e1) <= _pendingFee(unpaid, feeBps, e2));
    }

    /// Same property at realistic widths (unpaid < 2^80 wei = 1.2M frxUSD, < 136 years), split as e2 = e1 + d, in
    /// case the full-width query times out.
    function check_fee_monotoneInElapsedNarrow(uint80 unpaid, uint16 feeBps, uint32 e1, uint32 d) public pure {
        vm.assume(feeBps <= BPS);
        assert(_pendingFee(unpaid, feeBps, e1) <= _pendingFee(unpaid, feeBps, uint256(e1) + d));
    }

    /// Rounding up adds at most one wei over the exact pro-rata fee (and the bound is NOT `<= unpaid`, which is
    /// false past one year at 100%).
    function check_fee_atMostExactPlusOne(uint128 unpaid, uint16 feeBps, uint40 elapsed) public pure {
        vm.assume(feeBps <= BPS);
        uint256 exact = Math.mulDiv(unpaid, uint256(feeBps) * elapsed, BPS * FEE_YEAR);
        assert(_pendingFee(unpaid, feeBps, elapsed) <= exact + 1);
    }

    // ---------------------------------------------------------------- 3: settle on the deployed registry

    /// Takes a claim of `price` to Funded with `feeBps`, lets `elapsed1` pass, optionally makes one partial
    /// payment, lets `elapsed2` pass, then settles `amount`. Checks: paid <= amountDue - amountPaid (after accrual,
    /// which equals amountRemaining before the call), and the principal booked <= purchasePrice - principalPaid.
    function check_settle_neverTakesMoreThanRemaining(
        uint96 price,
        uint16 feeBps,
        uint32 elapsed1,
        uint96 firstPayment,
        uint32 elapsed2,
        uint128 amount
    ) public {
        _checkSettle(price, feeBps, elapsed1, firstPayment, elapsed2, amount);
    }

    /// The same with the launch fee of 0 (U-08): linear arithmetic only, so the solver can finish it.
    function check_settle_neverTakesMoreThanRemainingNoFee(
        uint96 price,
        uint32 elapsed1,
        uint96 firstPayment,
        uint32 elapsed2,
        uint128 amount
    ) public {
        _checkSettle(price, 0, elapsed1, firstPayment, elapsed2, amount);
    }

    /// Concrete terms (2,500 frxUSD at 10%/year, 90 days then 200 days), symbolic payments only: the fee is then
    /// a multiplication by constants, which the solver can finish where the fully symbolic versions time out.
    function check_settle_symbolicPaymentsConcreteTerms(uint96 firstPayment, uint128 amount) public {
        _checkSettle(2500e18, 1000, 90 days, firstPayment, 200 days, amount);
    }

    function _checkSettle(
        uint96 price,
        uint16 feeBps,
        uint32 elapsed1,
        uint96 firstPayment,
        uint32 elapsed2,
        uint128 amount
    ) internal {
        vm.assume(price > 0 && feeBps <= BPS);
        uint256 id = _funded(price, feeBps);

        _now += elapsed1;
        vm.warp(_now);
        if (firstPayment > 0) _settle(id, firstPayment);

        _now += elapsed2;
        vm.warp(_now);
        Claim memory c = registry.getClaim(id);
        uint256 remaining = registry.amountRemaining(id);
        uint256 principalLeft = c.purchasePrice - (c.amountPaid < c.purchasePrice ? c.amountPaid : c.purchasePrice);
        uint256 outstandingBefore = pool.outstandingPrincipal();
        vm.assume(amount > 0 && remaining > 0);

        uint256 paid = _settle(id, amount);
        Claim memory after_ = registry.getClaim(id);
        assert(paid <= remaining);
        assert(after_.amountPaid <= after_.amountDue);
        uint256 booked = outstandingBefore - pool.outstandingPrincipal();
        assert(booked <= principalLeft);
        assert(booked == (paid < principalLeft ? paid : principalLeft));
    }

    function _funded(uint128 price, uint16 feeBps) internal returns (uint256 id) {
        Params memory p = registry.params();
        p.feeBps = feeBps;
        registry.setParams(p);
        token.mint(LENDER, price);
        vm.startPrank(LENDER);
        token.approve(address(pool), price);
        pool.deposit(price, LENDER);
        vm.stopPrank();
        SubmitClaimParams memory sp = SubmitClaimParams({
            orgId: org,
            recipientType: RecipientType.Member,
            guarantor: address(officer),
            faceValue: price,
            requestedAmount: price,
            packetHash: keccak256("halmos packet")
        });
        vm.prank(MEMBER);
        id = registry.submitClaim(sp, _now + 1 days, "");
        registry.approveClaim(id, price);
        vm.prank(MEMBER);
        registry.purchaseClaim(id);
    }

    function _settle(uint256 id, uint256 amount) internal returns (uint256 paid) {
        token.mint(PAYER, amount);
        vm.startPrank(PAYER);
        token.approve(address(registry), amount);
        paid = registry.settle(id, amount);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- 4: maxRedeem / maxWithdraw satisfiable

    /// Two lenders deposit, the pool buys `bought`, takes a `lost` loss, gets `donated` and `returned` back;
    /// redeem(maxRedeem) and withdraw(maxWithdraw) then succeed for the first lender.
    function check_maxRedeem_isRedeemable(
        uint96 dep1,
        uint96 dep2,
        uint96 bought,
        uint96 lost,
        uint96 returned,
        uint96 donated
    ) public {
        _vaultState(dep1, dep2, bought, lost, returned, donated);
        uint256 shares = vault.maxRedeem(LENDER);
        vm.assume(shares > 0);
        vm.prank(LENDER);
        try vault.redeem(shares, LENDER, LENDER) {}
        catch {
            assert(false);
        }
    }

    function check_maxWithdraw_isWithdrawable(
        uint96 dep1,
        uint96 dep2,
        uint96 bought,
        uint96 lost,
        uint96 returned,
        uint96 donated
    ) public {
        _vaultState(dep1, dep2, bought, lost, returned, donated);
        uint256 assets = vault.maxWithdraw(LENDER);
        vm.assume(assets > 0);
        vm.prank(LENDER);
        try vault.withdraw(assets, LENDER, LENDER) {}
        catch {
            assert(false);
        }
    }

    /// Concrete deposits and purchase (odd amounts, so share math rounds), symbolic loss, principal return and
    /// donation: the variant the solver can finish when the fully symbolic ones time out.
    function check_maxRedeem_isRedeemableConcreteDeposits(uint96 lost, uint96 returned, uint96 donated) public {
        check_maxRedeem_isRedeemable(1_234_567_891e12, 7_654_321_987e12, 5000e18, lost, returned, donated);
    }

    function check_maxWithdraw_isWithdrawableConcreteDeposits(uint96 lost, uint96 returned, uint96 donated) public {
        check_maxWithdraw_isWithdrawable(1_234_567_891e12, 7_654_321_987e12, 5000e18, lost, returned, donated);
    }

    function _vaultState(uint96 dep1, uint96 dep2, uint96 bought, uint96 lost, uint96 returned, uint96 donated)
        internal
    {
        vm.assume(dep1 > 0);
        // zero amounts are valid no-ops on every call below, so no branches: fewer paths for the solver
        _vaultDeposit(LENDER, dep1);
        _vaultDeposit(LENDER2, dep2);
        vm.assume(bought <= uint256(dep1) + dep2);
        fake.fund(MEMBER, bought);
        vm.assume(uint256(lost) + returned <= bought);
        fake.loss(lost);
        fake.returned(returned);
        token.mint(address(vault), returned);
        token.mint(address(vault), donated);
    }

    function _vaultDeposit(address who, uint256 amount) internal {
        token.mint(who, amount);
        vm.startPrank(who);
        token.approve(address(vault), amount);
        vault.deposit(amount, who);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- 5: emergency withdrawals

    /// Emergency mode with symbolic balances and cash. Lender 1 claims, more money arrives (receipts only grow),
    /// lender 2 claims, lender 1 claims again: no step reverts, the payouts never exceed receipts, and each
    /// lender's total equals their pro-rata share of total receipts (rounded down).
    function check_emergency_noUnderflowWhileReceiptsGrow(
        uint96 dep1,
        uint96 dep2,
        uint96 bought,
        uint96 later1,
        uint96 later2
    ) public {
        vm.assume(dep1 > 0 && dep2 > 0);
        _vaultDeposit(LENDER, dep1);
        _vaultDeposit(LENDER2, dep2);
        vm.assume(bought <= uint256(dep1) + dep2);
        fake.fund(MEMBER, bought);
        vault.activateEmergencyMode();

        uint256 a1 = _emergency(LENDER);
        token.mint(address(vault), later1);
        uint256 b1 = _emergency(LENDER2);
        token.mint(address(vault), later2);
        uint256 a2 = _emergency(LENDER);
        uint256 b2 = _emergency(LENDER2);

        uint256 receipts = uint256(dep1) + dep2 - bought + later1 + later2;
        assert(a1 + a2 + b1 + b2 <= receipts);
        uint256 supply = vault.totalSupply();
        assert(a1 + a2 == Math.mulDiv(receipts, vault.balanceOf(LENDER), supply));
        assert(b1 + b2 == Math.mulDiv(receipts, vault.balanceOf(LENDER2), supply));
    }

    /// Concrete balances (odd amounts), symbolic later receipts.
    function check_emergency_noUnderflowConcreteBalances(uint96 later1, uint96 later2) public {
        check_emergency_noUnderflowWhileReceiptsGrow(1_234_567_891e12, 7_654_321_987e12, 5000e18, later1, later2);
    }

    function _emergency(address who) internal returns (uint256 got) {
        // the view must never underflow
        try vault.maxEmergencyWithdraw(who) returns (uint256 max) {
            if (max == 0) return 0;
            vm.prank(who);
            got = vault.emergencyWithdraw(who);
            assert(got == max);
        } catch {
            assert(false);
        }
    }
}
