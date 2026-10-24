// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ClaimRegistry} from "../../src/ClaimRegistry.sol";
import {ReceivablesPool} from "../../src/ReceivablesPool.sol";
import {ClaimNFT} from "../../src/ClaimNFT.sol";
import {OrgRegistry} from "../../src/OrgRegistry.sol";
import {
    CallReason,
    ClaimState,
    DepositCapExceeded,
    DepositsPaused,
    InsufficientIdleCash,
    LenderNotAllowed,
    Params,
    RecipientType,
    SubmitClaimParams
} from "../../src/libraries/ClaimTypes.sol";

/// @notice The mainnet pilot rehearsed against Fraxtal mainnet's real frxUSD on a local fork: Frax seeds 40,000, the
/// pool buys claims up to its cash, ASUC and guarantors pay, two claims are written off, and Frax exits. Uses the
/// parameters in `deployments/fraxtal.json`. Nothing is broadcast; the fork lives in memory.
/// @dev Skipped unless `FRAXTAL_RPC_URL` is set, so `forge test` stays offline:
///   FRAXTAL_RPC_URL=https://rpc.frax.com forge test --match-path "test/fork/*"
contract FraxtalPilotForkTest is Test {
    /// Fraxtal mainnet frxUSD (`deployments/fraxtal.json`)
    IERC20 internal constant FRXUSD = IERC20(0xFc00000000000000000000000000000000000001);
    /// pinned so a rerun sees the same token code and storage
    uint256 internal constant FORK_BLOCK = 42_686_534;
    uint256 internal constant SEED = 40_000e18;
    uint128 internal constant CLAIM = 2_500e18;

    OrgRegistry internal orgs;
    ClaimNFT internal nft;
    ReceivablesPool internal pool;
    ClaimRegistry internal registry;
    uint64 internal bab;

    address internal admin = makeAddr("adminSafe");
    address internal underwriter = makeAddr("underwriterSafe");
    address internal attester = makeAddr("attesterSafe");
    address internal pauser = makeAddr("pauser");
    address internal frax = makeAddr("fraxLender");
    address internal asuc = makeAddr("asucPayer");
    address internal outsider = makeAddr("outsider");
    address internal officer;
    uint256 internal officerKey;
    uint256 private _packet;

    function setUp() public {
        string memory rpc = vm.envOr("FRAXTAL_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc, FORK_BLOCK);
        (officer, officerKey) = makeAddrAndKey("babOfficer");

        orgs = new OrgRegistry(admin);
        nft = new ClaimNFT(admin);
        pool = new ReceivablesPool(FRXUSD, admin);
        registry = new ClaimRegistry(admin, pool, nft, orgs, _mainnetParams());

        vm.startPrank(admin);
        pool.setRegistry(address(registry));
        nft.setRegistry(address(registry));
        pool.setDepositCap(50_000e18);
        pool.setLenderAllowed(frax, true);
        registry.grantRole(registry.UNDERWRITER_ROLE(), underwriter);
        registry.grantRole(registry.ATTESTER_ROLE(), attester);
        registry.grantRole(registry.PAUSER_ROLE(), pauser);
        bab = orgs.addOrg("Blockchain at Berkeley");
        orgs.setOfficer(bab, officer, true);
        // U-69: B@B carries the whole pool
        registry.setOrgCap(bab, 50_000e18);
        vm.stopPrank();
    }

    /// @dev The `params` block of `deployments/fraxtal.json`.
    function _mainnetParams() internal pure returns (Params memory) {
        return Params({
            advanceRateBps: 10_000,
            feeBps: 0,
            perClaimCap: 2_500e18,
            perOrgCap: 10_000e18,
            overdueWindow: 15_552_000,
            approvalExpiry: 1_209_600,
            writeOffGrace: 5_184_000
        });
    }

    // ---------------------------------------------------------------- the real token

    function test_frxUSD_isThePlainErc20ThePoolAssumes() public view {
        assertEq(IERC20Metadata(address(FRXUSD)).decimals(), 18);
        assertEq(pool.asset(), address(FRXUSD));
        assertEq(pool.decimals(), 24, "18 + the 6-decimal virtual share offset");
    }

    function test_deposit_rehearsalThenFullSeed() public {
        // the 10 frxUSD dry run before the real deposit: in and back out, to the wei
        _give(frax, SEED + 10e18);
        vm.startPrank(frax);
        FRXUSD.approve(address(pool), type(uint256).max);
        uint256 shares = pool.deposit(10e18, frax);
        assertEq(shares, 10e18 * 1e6);
        assertEq(pool.redeem(shares, frax, frax), 10e18);
        assertEq(FRXUSD.balanceOf(frax), SEED + 10e18);

        pool.deposit(SEED, frax);
        vm.stopPrank();
        assertEq(pool.idleCash(), SEED);
        assertEq(pool.totalAssets(), SEED);
        assertEq(pool.maxWithdraw(frax), SEED);
        assertEq(FRXUSD.balanceOf(address(pool)), SEED);
    }

    // ---------------------------------------------------------------- the whole pilot

    function test_redeem_fraxExitsWithSeedMinusWriteOffsPlusLatePayments() public {
        _seedFrax();

        // sixteen 2,500 claims use every frxUSD in the pool, each paid to its member in real frxUSD
        uint256[] memory ids = new uint256[](16);
        for (uint256 i; i < 16; ++i) {
            address member = makeAddr(string.concat("member", vm.toString(i)));
            ids[i] = _approvedClaim(member);
            vm.prank(member);
            registry.purchaseClaim(ids[i]);
            assertEq(FRXUSD.balanceOf(member), CLAIM);
        }
        assertEq(pool.idleCash(), 0);
        assertEq(pool.totalAssets(), SEED, "bought claims still count at cost");
        assertEq(pool.maxWithdraw(frax), 0, "nothing to withdraw while it's all out");
        uint256 allShares = pool.balanceOf(frax);
        vm.prank(frax);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxRedeem.selector, frax, allShares, 0));
        pool.redeem(allShares, frax, frax);

        // a seventeenth claim waits for cash rather than overdrawing
        address late = makeAddr("lateMember");
        uint256 waiting = _approvedClaim(late);
        vm.prank(late);
        vm.expectRevert(abi.encodeWithSelector(InsufficientIdleCash.selector, uint256(CLAIM), uint256(0)));
        registry.purchaseClaim(waiting);

        // ASUC pays fourteen in full
        for (uint256 i; i < 14; ++i) {
            _settle(asuc, ids[i], CLAIM);
            assertEq(uint8(registry.getClaim(ids[i]).state), uint8(ClaimState.Settled));
        }
        assertEq(pool.idleCash(), 14 * uint256(CLAIM));
        assertEq(pool.totalAssets(), SEED, "settling swaps a claim for cash at the same value");

        // ASUC rejects the last two; the officer covers half of one and none of the other
        vm.startPrank(attester);
        registry.callGuarantor(ids[14], CallReason.AsucRejected);
        registry.callGuarantor(ids[15], CallReason.AsucRejected);
        vm.stopPrank();
        _settle(officer, ids[14], CLAIM / 2);

        // until the 60-day grace ends, the unpaid principal still counts (no write-off yet)
        assertEq(pool.totalAssets(), SEED - CLAIM / 2 + CLAIM / 2);
        vm.warp(registry.getClaim(ids[15]).writeOffEligibleAt);
        vm.startPrank(attester);
        registry.writeOff(ids[14]);
        registry.writeOff(ids[15]);
        vm.stopPrank();
        uint256 losses = CLAIM / 2 + CLAIM;
        assertEq(pool.totalLosses(), losses);
        assertEq(pool.outstandingPrincipal(), 0);
        assertEq(pool.totalAssets(), SEED - losses);

        // a payment after a write-off lands as new pool assets
        _settle(officer, ids[15], 500e18);
        assertEq(pool.totalAssets(), SEED - losses + 500e18);

        // Frax redeems every share and gets every frxUSD the pool holds, less at most a wei of rounding
        uint256 shares = pool.balanceOf(frax);
        assertEq(pool.maxRedeem(frax), shares);
        vm.prank(frax);
        uint256 out = pool.redeem(shares, frax, frax);
        assertApproxEqAbs(out, SEED - losses + 500e18, 1);
        assertEq(FRXUSD.balanceOf(frax), out);
        assertLe(FRXUSD.balanceOf(address(pool)), 1, "at most a wei stays behind for the virtual shares");
        assertEq(pool.totalSupply(), 0);
    }

    function test_emergencyWithdraw_fraxGetsIdleCashThenLaterSettlementAndRecovery() public {
        _seedFrax();
        address member = makeAddr("emergencyMember");
        uint256 id = _approvedClaim(member);
        vm.prank(member);
        registry.purchaseClaim(id);
        uint256 shares = pool.balanceOf(frax);
        vm.prank(pauser);
        registry.pause();
        vm.prank(admin);
        pool.activateEmergencyMode();
        vm.prank(frax);
        assertEq(pool.emergencyWithdraw(frax), SEED - CLAIM);
        assertEq(pool.idleCash(), 0);
        assertEq(pool.balanceOf(frax), shares);

        vm.prank(attester);
        registry.callGuarantor(id, CallReason.AsucRejected);
        _settle(officer, id, CLAIM / 2);
        vm.prank(frax);
        assertEq(pool.emergencyWithdraw(frax), CLAIM / 2);
        vm.warp(registry.getClaim(id).writeOffEligibleAt);
        vm.prank(attester);
        registry.writeOff(id);
        _settle(officer, id, CLAIM / 2);
        vm.prank(frax);
        assertEq(pool.emergencyWithdraw(frax), CLAIM / 2);
        assertEq(FRXUSD.balanceOf(frax), SEED);
        assertEq(pool.totalEmergencyWithdrawn(), SEED);
        assertEq(pool.idleCash(), 0);
        assertEq(pool.outstandingPrincipal(), 0);
    }

    // ---------------------------------------------------------------- who can put money in

    function test_deposit_onlyAllowlistedUnderTheCapAndNotWhilePaused() public {
        _give(outsider, 1_000e18);
        vm.startPrank(outsider);
        FRXUSD.approve(address(pool), 1_000e18);
        vm.expectRevert(abi.encodeWithSelector(LenderNotAllowed.selector, outsider));
        pool.deposit(1_000e18, outsider);
        vm.stopPrank();

        _give(frax, 60_000e18);
        vm.startPrank(frax);
        FRXUSD.approve(address(pool), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(LenderNotAllowed.selector, outsider));
        pool.deposit(1_000e18, outsider);
        vm.expectRevert(DepositCapExceeded.selector);
        pool.deposit(50_000e18 + 1, frax);
        pool.deposit(SEED, frax);
        vm.stopPrank();

        vm.prank(pauser);
        registry.pause();
        vm.prank(frax);
        vm.expectRevert(DepositsPaused.selector);
        pool.deposit(1e18, frax);
        // withdrawals stay open while paused (U-26)
        vm.prank(frax);
        pool.withdraw(1_000e18, frax, frax);
        assertEq(pool.idleCash(), SEED - 1_000e18);
    }

    function test_totalAssets_aDirectTransferOnlyRaisesFraxsShare() public {
        _seedFrax();
        _give(outsider, 1_000e18);
        vm.prank(outsider);
        FRXUSD.transfer(address(pool), 1_000e18);
        assertEq(pool.totalAssets(), SEED + 1_000e18);
        assertApproxEqAbs(pool.maxWithdraw(frax), SEED + 1_000e18, 1);
    }

    // ---------------------------------------------------------------- helpers

    /// @dev Real frxUSD for a test account, written into the token's own balance storage on the fork.
    function _give(address who, uint256 amount) internal {
        deal(address(FRXUSD), who, amount);
        assertEq(FRXUSD.balanceOf(who), amount);
    }

    function _seedFrax() internal {
        _give(frax, SEED);
        vm.startPrank(frax);
        FRXUSD.approve(address(pool), SEED);
        pool.deposit(SEED, frax);
        vm.stopPrank();
    }

    function _approvedClaim(address member) internal returns (uint256 id) {
        SubmitClaimParams memory p = SubmitClaimParams({
            orgId: bab,
            recipientType: RecipientType.Member,
            guarantor: officer,
            faceValue: CLAIM,
            requestedAmount: CLAIM,
            packetHash: keccak256(abi.encode("pilot packet", ++_packet))
        });
        uint256 deadline = block.timestamp + 7 days;
        bytes32 digest = registry.guarantyDigest(
            officer, member, bab, p.faceValue, p.requestedAmount, p.packetHash, registry.nonces(officer), deadline
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(officerKey, digest);
        vm.prank(member);
        id = registry.submitClaim(p, deadline, abi.encodePacked(r, s, v));
        vm.prank(underwriter);
        registry.approveClaim(id, CLAIM);
    }

    function _settle(address payer, uint256 id, uint256 amount) internal {
        _give(payer, FRXUSD.balanceOf(payer) + amount);
        vm.startPrank(payer);
        FRXUSD.approve(address(registry), amount);
        registry.settle(id, amount);
        vm.stopPrank();
    }
}
