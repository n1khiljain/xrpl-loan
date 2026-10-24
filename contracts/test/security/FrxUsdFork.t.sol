// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ClaimRegistry} from "../../src/ClaimRegistry.sol";
import {ReceivablesPool} from "../../src/ReceivablesPool.sol";
import {ClaimNFT} from "../../src/ClaimNFT.sol";
import {OrgRegistry} from "../../src/OrgRegistry.sol";
import {ClaimState, Params, RecipientType, SubmitClaimParams} from "../../src/libraries/ClaimTypes.sol";

/// @notice The admin surface of Fraxtal's frxUSD v3.0.0 as it reaches the pool (U-31). Selectors come from the
/// implementation bytecode (`cast selectors`); there is no verified source on Sourcify and Fraxscan needs an API key.
interface IFrxUsdAdmin {
    function owner() external view returns (address);
    function timelock_address() external view returns (address);
    function version() external pure returns (string memory);
    function isPaused() external view returns (bool);
    function isFrozen(address) external view returns (bool);
    function isFreezer(address) external view returns (bool);
    function minters_array(uint256) external view returns (address);
    function freeze(address) external;
    function thaw(address) external;
    function pause() external;
    function unpause() external;
    function burnFrxUsd(address, uint256) external;
}

interface ISafe {
    function getThreshold() external view returns (uint256);
    function getOwners() external view returns (address[] memory);
}

/// @notice Security campaign, Workstream D item 5: what frxUSD's owner can do to the pool, on a Fraxtal mainnet fork.
/// Facts pinned at FORK_BLOCK: frxUSD is an EIP-1967 proxy behind Fraxtal's ProxyAdmin predeploy; the token owner
/// and timelock are one 3-of-5 Safe that can pause the token, freeze and thaw any account, and burn any account's
/// balance without allowance (`burnFrxUsd`). Freezers can also freeze. The tests show each power's effect on the pool.
/// @dev Skipped unless `FRAXTAL_RPC_URL` is set:
///   FRAXTAL_RPC_URL=https://rpc.frax.com forge test --match-path test/security/FrxUsdFork.t.sol -vv
contract FrxUsdForkTest is Test {
    IERC20 internal constant FRXUSD = IERC20(0xFc00000000000000000000000000000000000001);
    IFrxUsdAdmin internal constant FRX = IFrxUsdAdmin(0xFc00000000000000000000000000000000000001);
    uint256 internal constant FORK_BLOCK = 42_873_553;
    bytes32 internal constant IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 internal constant ADMIN_SLOT = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;
    address internal constant IMPLEMENTATION = 0x0000000083BDf23788585D499EAb0D92A8bEfB1D;
    address internal constant PROXY_ADMIN = 0xfC0000000000000000000000000000000000000a;
    address internal constant OWNER_SAFE = 0xC4EB45d80DC1F079045E75D5d55de8eD1c1090E6;
    uint256 internal constant SEED = 20_000e18;
    uint128 internal constant CLAIM = 2500e18;

    OrgRegistry internal orgs;
    ClaimNFT internal nft;
    ReceivablesPool internal pool;
    ClaimRegistry internal registry;
    uint64 internal org;

    address internal admin = makeAddr("adminSafe");
    address internal underwriter = makeAddr("underwriterSafe");
    address internal lender = makeAddr("fraxLender");
    address internal member = makeAddr("member");
    address internal payer = makeAddr("asucPayer");
    address internal otherPayer = makeAddr("guarantorPayer");
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
        (officer, officerKey) = makeAddrAndKey("officer");

        orgs = new OrgRegistry(admin);
        nft = new ClaimNFT(admin);
        pool = new ReceivablesPool(FRXUSD, admin);
        registry = new ClaimRegistry(
            admin,
            pool,
            nft,
            orgs,
            Params({
                advanceRateBps: 10_000,
                feeBps: 0,
                perClaimCap: CLAIM,
                perOrgCap: 10_000e18,
                overdueWindow: 180 days,
                approvalExpiry: 14 days,
                writeOffGrace: 60 days
            })
        );
        vm.startPrank(admin);
        pool.setRegistry(address(registry));
        nft.setRegistry(address(registry));
        pool.setDepositCap(50_000e18);
        pool.setLenderAllowed(lender, true);
        registry.grantRole(registry.UNDERWRITER_ROLE(), underwriter);
        org = orgs.addOrg("Org");
        orgs.setOfficer(org, officer, true);
        vm.stopPrank();

        deal(address(FRXUSD), lender, SEED);
        vm.startPrank(lender);
        FRXUSD.approve(address(pool), SEED);
        pool.deposit(SEED, lender);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- facts

    function test_frxUSD_isAnUpgradeableProxyOwnedByA3of5Safe() public {
        assertEq(address(uint160(uint256(vm.load(address(FRXUSD), IMPL_SLOT)))), IMPLEMENTATION);
        assertEq(address(uint160(uint256(vm.load(address(FRXUSD), ADMIN_SLOT)))), PROXY_ADMIN);
        // the ProxyAdmin predeploy is itself a proxy whose owner is the same Safe
        (bool ok, bytes memory ret) = PROXY_ADMIN.staticcall(abi.encodeWithSignature("owner()"));
        assertTrue(ok);
        assertEq(abi.decode(ret, (address)), OWNER_SAFE);
        assertEq(FRX.owner(), OWNER_SAFE);
        assertEq(FRX.timelock_address(), OWNER_SAFE);
        assertEq(ISafe(OWNER_SAFE).getThreshold(), 3);
        assertEq(ISafe(OWNER_SAFE).getOwners().length, 5);
        // `version()` hits an opcode the repo's shanghai EVM does not have (NotActivated), while Fraxtal mainnet
        // answers it over RPC: Fraxtal runs Cancun-era opcodes (evidence for U-35).
        (ok,) = address(FRXUSD).staticcall(abi.encodeWithSignature("version()"));
        assertFalse(ok);
        vm.setEvmVersion("cancun");
        assertEq(FRX.version(), "3.0.0");
        vm.setEvmVersion("shanghai");
        assertEq(IERC20Metadata(address(FRXUSD)).decimals(), 18);
        assertFalse(FRX.isPaused());
        assertFalse(FRX.isFreezer(OWNER_SAFE));
    }

    function test_transfer_noFeeNoHookOnPlainTransfers() public {
        deal(address(FRXUSD), payer, 1000e18);
        uint256 before = FRXUSD.balanceOf(address(pool));
        vm.prank(payer);
        FRXUSD.transfer(address(pool), 1000e18);
        assertEq(FRXUSD.balanceOf(address(pool)), before + 1000e18);
        assertEq(FRXUSD.balanceOf(payer), 0);
    }

    function test_freeze_outsiderCannotFreezeOrPause() public {
        vm.startPrank(makeAddr("outsider"));
        vm.expectRevert();
        FRX.freeze(address(pool));
        vm.expectRevert();
        FRX.pause();
        vm.expectRevert();
        FRX.burnFrxUsd(address(pool), 1);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- freeze

    /// Frozen pool: lenders cannot redeem, withdraw or emergency-withdraw; everything stays until a thaw.
    function test_freeze_frozenPoolStrandsLenders() public {
        uint256 id = _purchased(member);
        vm.prank(OWNER_SAFE);
        FRX.freeze(address(pool));
        assertTrue(FRX.isFrozen(address(pool)));

        uint256 maxRedeem = pool.maxRedeem(lender);
        assertGt(maxRedeem, 0, "the view still advertises an exit");
        vm.prank(lender);
        vm.expectRevert();
        pool.redeem(maxRedeem, lender, lender);

        // settlement into a frozen pool
        deal(address(FRXUSD), payer, CLAIM);
        vm.startPrank(payer);
        FRXUSD.approve(address(registry), CLAIM);
        (bool settled,) = address(registry).call(abi.encodeCall(registry.settle, (id, CLAIM)));
        vm.stopPrank();
        assertFalse(settled, "a frozen recipient cannot receive either, so no settlement reaches the pool");

        vm.prank(admin);
        pool.activateEmergencyMode();
        vm.prank(lender);
        vm.expectRevert();
        pool.emergencyWithdraw(lender);

        vm.prank(OWNER_SAFE);
        FRX.thaw(address(pool));
        vm.prank(lender);
        assertGt(pool.emergencyWithdraw(lender), 0);
    }

    /// Frozen claimant: the purchase reverts (fundPurchase pays them), so the claim stays Approved.
    function test_freeze_frozenClaimantCannotSell() public {
        uint256 id = _approvedClaim(member);
        vm.prank(OWNER_SAFE);
        FRX.freeze(member);
        vm.prank(member);
        vm.expectRevert();
        registry.purchaseClaim(id);
        assertEq(uint8(registry.getClaim(id).state), uint8(ClaimState.Approved));
        assertEq(pool.outstandingPrincipal(), 0);
    }

    /// Frozen payer: their settle reverts; any other payer can still settle the same claim.
    function test_freeze_frozenPayerBlockedButAnotherPayerSettles() public {
        uint256 id = _purchased(member);
        deal(address(FRXUSD), payer, CLAIM);
        deal(address(FRXUSD), otherPayer, CLAIM);
        vm.prank(OWNER_SAFE);
        FRX.freeze(payer);

        vm.startPrank(payer);
        FRXUSD.approve(address(registry), CLAIM);
        vm.expectRevert();
        registry.settle(id, CLAIM);
        vm.stopPrank();

        vm.startPrank(otherPayer);
        FRXUSD.approve(address(registry), CLAIM);
        registry.settle(id, CLAIM);
        vm.stopPrank();
        assertEq(uint8(registry.getClaim(id).state), uint8(ClaimState.Settled));
    }

    /// Frozen registry (the transferFrom spender): every settlement reverts, for every payer.
    function test_freeze_frozenRegistryBlocksAllSettlements() public {
        uint256 id = _purchased(member);
        vm.prank(OWNER_SAFE);
        FRX.freeze(address(registry));
        deal(address(FRXUSD), payer, CLAIM);
        vm.startPrank(payer);
        FRXUSD.approve(address(registry), CLAIM);
        vm.expectRevert();
        registry.settle(id, CLAIM);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- pause

    /// A token-wide pause stops deposits, exits, purchases and settlements alike.
    function test_pause_tokenPauseHaltsEveryPoolFlow() public {
        uint256 funded = _purchased(member);
        uint256 approved = _approvedClaim(makeAddr("member2"));
        vm.prank(OWNER_SAFE);
        FRX.pause();
        assertTrue(FRX.isPaused());

        deal(address(FRXUSD), lender, 1e18);
        vm.startPrank(lender);
        FRXUSD.approve(address(pool), 1e18);
        vm.expectRevert();
        pool.deposit(1e18, lender);
        uint256 maxRedeem = pool.maxRedeem(lender);
        vm.expectRevert();
        pool.redeem(maxRedeem, lender, lender);
        vm.stopPrank();

        vm.prank(makeAddr("member2"));
        vm.expectRevert();
        registry.purchaseClaim(approved);

        deal(address(FRXUSD), payer, CLAIM);
        vm.startPrank(payer);
        FRXUSD.approve(address(registry), CLAIM);
        vm.expectRevert();
        registry.settle(funded, CLAIM);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- burn

    /// The token owner burns the pool's frxUSD with no allowance: totalAssets and the share price drop with no
    /// write-off, and the burned cash is gone for every lender.
    function test_burnFrxUsd_ownerBurnsPoolCashWithoutAllowance() public {
        assertEq(FRXUSD.allowance(address(pool), OWNER_SAFE), 0);
        uint256 assetsBefore = pool.totalAssets();
        uint256 valueBefore = pool.previewRedeem(pool.balanceOf(lender));
        vm.prank(OWNER_SAFE);
        FRX.burnFrxUsd(address(pool), 5000e18);
        assertEq(pool.totalAssets(), assetsBefore - 5000e18);
        assertLt(pool.previewRedeem(pool.balanceOf(lender)), valueBefore);
        assertEq(pool.totalLosses(), 0, "no write-off recorded");
    }

    // ---------------------------------------------------------------- helpers

    function _approvedClaim(address who) internal returns (uint256 id) {
        SubmitClaimParams memory p = SubmitClaimParams({
            orgId: org,
            recipientType: RecipientType.Member,
            guarantor: officer,
            faceValue: CLAIM,
            requestedAmount: CLAIM,
            packetHash: keccak256(abi.encode("frxusd fork packet", ++_packet))
        });
        uint256 deadline = block.timestamp + 7 days;
        bytes32 digest = registry.guarantyDigest(
            officer, who, org, p.faceValue, p.requestedAmount, p.packetHash, registry.nonces(officer), deadline
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(officerKey, digest);
        vm.prank(who);
        id = registry.submitClaim(p, deadline, abi.encodePacked(r, s, v));
        vm.prank(underwriter);
        registry.approveClaim(id, CLAIM);
    }

    function _purchased(address who) internal returns (uint256 id) {
        id = _approvedClaim(who);
        vm.prank(who);
        registry.purchaseClaim(id);
    }
}
