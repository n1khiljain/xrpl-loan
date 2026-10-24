// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ClaimRegistry} from "../../../src/ClaimRegistry.sol";
import {ReceivablesPool} from "../../../src/ReceivablesPool.sol";
import {ClaimNFT} from "../../../src/ClaimNFT.sol";
import {OrgRegistry} from "../../../src/OrgRegistry.sol";
import {MockFrxUSD} from "../../../src/mocks/MockFrxUSD.sol";
import {
    Claim,
    ClaimState,
    RecipientType,
    CallReason,
    Params,
    SubmitClaimParams
} from "../../../src/libraries/ClaimTypes.sol";

interface IHevm {
    function warp(uint256) external;
}

/// @notice A wallet the harness drives. It accepts every ERC-1271 signature, so actors registered as officers
/// can guarantee claims without private keys or cheatcodes.
contract MedusaActor {
    address internal immutable _owner;

    constructor() {
        _owner = msg.sender;
    }

    function exec(address target, bytes calldata data) external returns (bool ok, bytes memory ret) {
        require(msg.sender == _owner, "owner");
        (ok, ret) = target.call(data);
    }

    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0x1626ba7e;
    }
}

/// @notice Medusa assertion-mode harness (security campaign, Workstream D item 5). It deploys the whole system with
/// itself as admin, underwriter, attester and pauser, drives lenders, claimants and officers through `MedusaActor`
/// wallets (no cheatcodes except `warp`), and after every action asserts:
///   I-1  totalAssets == balance + outstandingPrincipal, and outstandingPrincipal == an independent ghost
///   I-2  outstandingPrincipal and orgOutstanding equal the unpaid principal summed over Funded/GuarantorCalled
///   I-3  amountPaid <= amountDue
///   I-7  pool balance == deposits + settlements + donations - purchases - withdrawals - emergency payouts
///   EM   emergency entitlements: sum(max + withdrawn) <= receipts, within one wei per holder of equality, and one
///        holder's payout never lowers another's entitlement
/// plus per-call checks: settle takes at most amountRemaining, books at most the unpaid principal, and
/// redeem(maxRedeem)/withdraw(maxWithdraw) never revert.
/// Run: `medusa fuzz` from contracts/ (config: contracts/medusa.json).
contract MedusaHarness {
    IHevm internal constant HEVM = IHevm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);
    uint256 internal constant N = 3;
    uint256 internal constant MAX_CLAIMS = 24;

    MockFrxUSD public frxUSD;
    OrgRegistry public orgs;
    ClaimNFT public nft;
    ReceivablesPool public pool;
    ClaimRegistry public registry;

    MedusaActor[N] public lenders;
    MedusaActor[N] public members;
    MedusaActor[N] public officers;
    uint64[2] public orgIds;

    uint256 public ghostIn; // deposits, settlements, donations
    uint256 public ghostOut; // purchases, withdrawals, emergency payouts
    uint256 public ghostPrincipal; // purchases - booked principal returns - write-offs
    uint256 internal _packetNonce;

    constructor() {
        frxUSD = new MockFrxUSD();
        orgs = new OrgRegistry(address(this));
        nft = new ClaimNFT(address(this));
        pool = new ReceivablesPool(IERC20(address(frxUSD)), address(this));
        registry = new ClaimRegistry(
            address(this),
            pool,
            nft,
            orgs,
            Params({
                advanceRateBps: 10_000,
                feeBps: 1000,
                perClaimCap: 2500e18,
                perOrgCap: 10_000e18,
                overdueWindow: 30 days,
                approvalExpiry: 14 days,
                writeOffGrace: 1 days
            })
        );
        pool.setRegistry(address(registry));
        nft.setRegistry(address(registry));
        pool.setDepositCap(200_000e18);
        registry.grantRole(registry.UNDERWRITER_ROLE(), address(this));
        registry.grantRole(registry.ATTESTER_ROLE(), address(this));
        registry.grantRole(registry.PAUSER_ROLE(), address(this));
        orgIds[0] = orgs.addOrg("Org A");
        orgIds[1] = orgs.addOrg("Org B");
        for (uint256 i = 0; i < N; i++) {
            lenders[i] = new MedusaActor();
            members[i] = new MedusaActor();
            officers[i] = new MedusaActor();
            pool.setLenderAllowed(address(lenders[i]), true);
            orgs.setOfficer(orgIds[0], address(officers[i]), true);
            orgs.setOfficer(orgIds[1], address(officers[i]), true);
        }
        _deposit(lenders[0], 30_000e18);
    }

    // ---------------------------------------------------------------- helpers

    function _bound(uint256 x, uint256 lo, uint256 hi) internal pure returns (uint256) {
        if (hi <= lo) return lo;
        return lo + x % (hi - lo + 1);
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _exec(MedusaActor who, address target, bytes memory data) internal returns (bool ok, bytes memory ret) {
        (ok, ret) = who.exec(target, data);
    }

    function _deposit(MedusaActor lender, uint256 amount) internal returns (bool ok) {
        frxUSD.mint(address(lender), amount);
        _exec(lender, address(frxUSD), abi.encodeCall(IERC20.approve, (address(pool), amount)));
        (ok,) = _exec(lender, address(pool), abi.encodeCall(pool.deposit, (amount, address(lender))));
        if (ok) ghostIn += amount;
    }

    function _find(uint256 seed, uint256 mask) internal view returns (uint256 id, Claim memory c) {
        uint256 count = registry.claimCount();
        if (count == 0) return (0, c);
        uint256 start = seed % count;
        for (uint256 i = 0; i < count; i++) {
            uint256 candidate = (start + i) % count + 1;
            Claim memory found = registry.getClaim(candidate);
            if (mask & (1 << uint8(found.state)) != 0) return (candidate, found);
        }
        return (0, c);
    }

    uint256 internal constant SUBMITTED = 1 << uint8(ClaimState.Submitted);
    uint256 internal constant APPROVED = 1 << uint8(ClaimState.Approved);
    uint256 internal constant FUNDED = 1 << uint8(ClaimState.Funded);
    uint256 internal constant CALLED = 1 << uint8(ClaimState.GuarantorCalled);
    uint256 internal constant WRITTEN_OFF = 1 << uint8(ClaimState.WrittenOff);

    function _principalPaid(Claim memory c) internal pure returns (uint256) {
        return c.amountPaid < c.purchasePrice ? c.amountPaid : c.purchasePrice;
    }

    // ---------------------------------------------------------------- properties

    function _checkAll() internal view {
        // I-1
        assert(pool.totalAssets() == frxUSD.balanceOf(address(pool)) + pool.outstandingPrincipal());
        assert(pool.outstandingPrincipal() == ghostPrincipal);
        // I-2, I-3
        uint256 total;
        uint256[2] memory perOrg;
        uint256 count = registry.claimCount();
        for (uint256 id = 1; id <= count; id++) {
            Claim memory c = registry.getClaim(id);
            assert(c.amountPaid <= c.amountDue);
            if (c.state != ClaimState.Funded && c.state != ClaimState.GuarantorCalled) continue;
            uint256 unpaid = c.purchasePrice - _principalPaid(c);
            total += unpaid;
            perOrg[c.orgId == orgIds[0] ? 0 : 1] += unpaid;
        }
        assert(pool.outstandingPrincipal() == total);
        assert(registry.orgOutstanding(orgIds[0]) == perOrg[0]);
        assert(registry.orgOutstanding(orgIds[1]) == perOrg[1]);
        // I-7
        assert(frxUSD.balanceOf(address(pool)) == ghostIn - ghostOut);
        assert(frxUSD.balanceOf(address(registry)) == 0);
        // emergency entitlement conservation
        if (pool.emergencyMode()) {
            uint256 receipts = pool.idleCash() + pool.totalEmergencyWithdrawn();
            uint256 claimed;
            for (uint256 i = 0; i < N; i++) {
                address l = address(lenders[i]);
                claimed += pool.maxEmergencyWithdraw(l) + pool.emergencyWithdrawn(l);
            }
            assert(claimed <= receipts);
            // With zero supply nobody is entitled and receipts stay stranded in the pool (D-2)
            // (first medusa smoke run: withdraw all, donate, activate). Documented, so only checked with holders.
            if (pool.totalSupply() > 0) assert(claimed + N >= receipts);
        }
    }

    // ---------------------------------------------------------------- lenders

    function deposit(uint256 seed, uint256 amount) external {
        MedusaActor l = lenders[seed % N];
        uint256 max = _min(pool.maxDeposit(address(l)), 100_000e18);
        if (max == 0) return;
        _deposit(l, _bound(amount, 1, max));
        _checkAll();
    }

    function mint(uint256 seed, uint256 shares) external {
        MedusaActor l = lenders[seed % N];
        uint256 max = _min(pool.maxMint(address(l)), pool.previewDeposit(100_000e18));
        if (max == 0) return;
        shares = _bound(shares, 1, max);
        uint256 assets = pool.previewMint(shares);
        frxUSD.mint(address(l), assets);
        _exec(l, address(frxUSD), abi.encodeCall(IERC20.approve, (address(pool), assets)));
        (bool ok, bytes memory ret) = _exec(l, address(pool), abi.encodeCall(pool.mint, (shares, address(l))));
        if (ok) ghostIn += abi.decode(ret, (uint256));
        _checkAll();
    }

    function withdraw(uint256 seed, uint256 amount, bool useMax) external {
        MedusaActor l = lenders[seed % N];
        uint256 max = pool.maxWithdraw(address(l));
        if (max == 0) return;
        amount = useMax ? max : _bound(amount, 1, max);
        (bool ok,) = _exec(l, address(pool), abi.encodeCall(pool.withdraw, (amount, address(l), address(l))));
        // ERC-4626: anything up to maxWithdraw must succeed
        assert(ok);
        ghostOut += amount;
        _checkAll();
    }

    function redeem(uint256 seed, uint256 shares, bool useMax) external {
        MedusaActor l = lenders[seed % N];
        uint256 max = pool.maxRedeem(address(l));
        if (max == 0) return;
        shares = useMax ? max : _bound(shares, 1, max);
        (bool ok, bytes memory ret) =
            _exec(l, address(pool), abi.encodeCall(pool.redeem, (shares, address(l), address(l))));
        // ERC-4626: anything up to maxRedeem must succeed
        assert(ok);
        ghostOut += abi.decode(ret, (uint256));
        _checkAll();
    }

    function transferShares(uint256 fromSeed, uint256 toSeed, uint256 shares) external {
        MedusaActor from = lenders[fromSeed % N];
        MedusaActor to = lenders[toSeed % N];
        uint256 bal = pool.balanceOf(address(from));
        if (bal == 0 || pool.emergencyMode()) return;
        _exec(from, address(pool), abi.encodeCall(IERC20.transfer, (address(to), _bound(shares, 1, bal))));
        _checkAll();
    }

    function donate(uint256 amount) external {
        amount = _bound(amount, 1, 1000e18);
        frxUSD.mint(address(pool), amount);
        ghostIn += amount;
        _checkAll();
    }

    // ---------------------------------------------------------------- claimants

    function submit(uint256 claimantSeed, uint256 guarantorSeed, uint256 orgSeed, uint256 face, uint256 requested)
        public
        returns (uint256 id)
    {
        if (registry.claimCount() >= MAX_CLAIMS || registry.paused()) return 0;
        uint64 orgId = orgIds[orgSeed % 2];
        if (!orgs.isActiveOrg(orgId)) return 0;
        bool asTreasurer = (claimantSeed >> 8) % 3 == 0;
        uint256 g = guarantorSeed % N;
        MedusaActor claimant = asTreasurer ? officers[(g + 1 + claimantSeed % (N - 1)) % N] : members[claimantSeed % N];
        Params memory p = registry.params();
        face = _bound(face, 1e18, 5000e18);
        uint256 limit = _min(face * p.advanceRateBps / 10_000, p.perClaimCap);
        if (limit == 0) return 0;
        SubmitClaimParams memory sp = SubmitClaimParams({
            orgId: orgId,
            recipientType: asTreasurer ? RecipientType.OrgTreasurer : RecipientType.Member,
            guarantor: address(officers[g]),
            faceValue: uint128(face),
            requestedAmount: uint128(_bound(requested, 1, limit)),
            packetHash: keccak256(abi.encode("medusa-packet", ++_packetNonce))
        });
        (bool ok, bytes memory ret) =
            _exec(claimant, address(registry), abi.encodeCall(registry.submitClaim, (sp, block.timestamp + 1 days, "")));
        if (ok) id = abi.decode(ret, (uint256));
        _checkAll();
    }

    function cancel(uint256 seed) external {
        (uint256 id, Claim memory c) = _find(seed, SUBMITTED);
        if (id == 0) return;
        _exec(MedusaActor(c.recipient), address(registry), abi.encodeCall(registry.cancelClaim, (id)));
        _checkAll();
    }

    function approve(uint256 seed, uint256 amount) public {
        (uint256 id, Claim memory c) = _find(seed, SUBMITTED | APPROVED);
        if (id == 0 || registry.paused()) return;
        amount = _bound(amount, 1, _min(c.requestedAmount, registry.params().perClaimCap));
        registry.approveClaim(id, uint128(amount));
        _checkAll();
    }

    function reject(uint256 seed) external {
        (uint256 id,) = _find(seed, SUBMITTED | APPROVED);
        if (id == 0) return;
        registry.rejectClaim(id, "OTHER");
        _checkAll();
    }

    function purchase(uint256 seed) public {
        (uint256 id, Claim memory c) = _find(seed, APPROVED);
        if (id == 0) return;
        (bool ok,) = _exec(MedusaActor(c.recipient), address(registry), abi.encodeCall(registry.purchaseClaim, (id)));
        if (ok) {
            ghostOut += c.approvedAmount;
            ghostPrincipal += c.approvedAmount;
            assert(registry.orgOutstanding(c.orgId) <= registry.orgCap(c.orgId));
        }
        _checkAll();
    }

    /// @dev submit + approve + purchase in one call so short sequences reach the post-purchase states.
    function fastTrack(uint256 seed, uint256 face, uint256 requested, uint256 amount) external {
        uint256 id = submit(seed, seed >> 16, seed >> 32, face, requested);
        if (id == 0) return;
        approve(id - 1, amount);
        purchase(id - 1);
    }

    function settle(uint256 seed, uint256 payerSeed, uint256 amount) external {
        (uint256 id, Claim memory c) = _find(seed, FUNDED | CALLED | WRITTEN_OFF);
        if (id == 0) return;
        uint256 remainingBefore = registry.amountRemaining(id);
        amount = _bound(amount, 1, remainingBefore * 2 + 1);
        MedusaActor payer = payerSeed % 3 == 0
            ? MedusaActor(c.recipient)
            : payerSeed % 3 == 1 ? MedusaActor(c.guarantor) : lenders[payerSeed % N];
        frxUSD.mint(address(payer), amount);
        _exec(payer, address(frxUSD), abi.encodeCall(IERC20.approve, (address(registry), amount)));
        uint256 outstandingBefore = pool.outstandingPrincipal();
        (bool ok, bytes memory ret) = _exec(payer, address(registry), abi.encodeCall(registry.settle, (id, amount)));
        if (ok) {
            uint256 paid = abi.decode(ret, (uint256));
            assert(paid <= remainingBefore);
            assert(registry.amountRemaining(id) == remainingBefore - paid);
            uint256 booked = outstandingBefore - pool.outstandingPrincipal();
            assert(booked <= c.purchasePrice - _principalPaid(c));
            uint256 expectedBooked = c.principalWrittenOff ? 0 : _min(paid, c.purchasePrice - _principalPaid(c));
            assert(booked == expectedBooked);
            ghostPrincipal -= expectedBooked;
            ghostIn += paid;
        } else {
            // the only legitimate failure is nothing left to pay
            assert(remainingBefore == 0);
        }
        _exec(payer, address(frxUSD), abi.encodeCall(IERC20.approve, (address(registry), 0)));
        _checkAll();
    }

    // ---------------------------------------------------------------- attester

    function callGuarantor(uint256 seed, uint256 reasonSeed) external {
        (uint256 id, Claim memory c) = _find(seed, FUNDED);
        if (id == 0) return;
        CallReason reason = CallReason(_bound(reasonSeed, 1, 3));
        if (reason == CallReason.Overdue && block.timestamp < c.dueAt) reason = CallReason.AsucRejected;
        registry.callGuarantor(id, reason);
        _checkAll();
    }

    function writeOff(uint256 seed) external {
        (uint256 id, Claim memory c) = _find(seed, CALLED);
        if (id == 0) return;
        if (block.timestamp < c.writeOffEligibleAt) HEVM.warp(c.writeOffEligibleAt);
        registry.writeOff(id);
        ghostPrincipal -= c.purchasePrice - _principalPaid(c);
        _checkAll();
    }

    // ---------------------------------------------------------------- admin

    function setParams(uint16 advance, uint16 fee, uint128 claimCap, uint128 orgCap, uint32 grace) external {
        uint128 cc = uint128(_bound(claimCap, 100e18, 5000e18));
        registry.setParams(
            Params({
                advanceRateBps: uint16(_bound(advance, 5000, 10_000)),
                feeBps: uint16(_bound(fee, 0, 10_000)),
                perClaimCap: cc,
                perOrgCap: uint128(_bound(orgCap, orgCap % 8 == 0 ? 1e18 : cc, 20_000e18)),
                overdueWindow: 30 days,
                approvalExpiry: 14 days,
                writeOffGrace: uint32(_bound(grace, 1 days, 30 days))
            })
        );
        _checkAll();
    }

    function setDepositCap(uint256 cap) external {
        pool.setDepositCap(_bound(cap, 0, 300_000e18));
        _checkAll();
    }

    function setOrgActive(uint256 orgSeed, uint256 activeSeed) external {
        orgs.setOrgActive(orgIds[orgSeed % 2], activeSeed % 4 != 0);
        _checkAll();
    }

    function setOrgCap(uint256 orgSeed, uint128 cap) external {
        registry.setOrgCap(orgIds[orgSeed % 2], cap % 4 == 0 ? 0 : uint128(_bound(cap, 1e18, 60_000e18)));
        _checkAll();
    }

    function togglePause() external {
        if (registry.paused()) registry.unpause();
        else registry.pause();
        _checkAll();
    }

    function warp(uint256 secs) external {
        HEVM.warp(block.timestamp + _bound(secs, 1, 400 days));
        _checkAll();
    }

    // ---------------------------------------------------------------- emergency mode

    /// @dev One way; one call in 8 so most sequences stay in normal mode.
    function activateEmergency(uint256 seed) external {
        if (seed % 8 != 0 || pool.emergencyMode()) return;
        pool.activateEmergencyMode();
        _checkAll();
    }

    function emergencyWithdraw(uint256 seed) external {
        if (!pool.emergencyMode()) return;
        uint256 who = seed % N;
        uint256 expected = pool.maxEmergencyWithdraw(address(lenders[who]));
        uint256[N] memory othersBefore;
        for (uint256 i = 0; i < N; i++) {
            othersBefore[i] = pool.maxEmergencyWithdraw(address(lenders[i]));
        }
        (bool ok, bytes memory ret) =
            _exec(lenders[who], address(pool), abi.encodeCall(pool.emergencyWithdraw, (address(lenders[who]))));
        if (expected == 0) {
            assert(!ok);
            return;
        }
        assert(ok);
        assert(abi.decode(ret, (uint256)) == expected);
        ghostOut += expected;
        assert(pool.maxEmergencyWithdraw(address(lenders[who])) == 0);
        for (uint256 i = 0; i < N; i++) {
            if (i != who) assert(pool.maxEmergencyWithdraw(address(lenders[i])) >= othersBefore[i]);
        }
        _checkAll();
    }
}
