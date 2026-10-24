// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ClaimRegistry} from "../../src/ClaimRegistry.sol";
import {ReceivablesPool} from "../../src/ReceivablesPool.sol";
import {OrgRegistry} from "../../src/OrgRegistry.sol";
import {MockFrxUSD} from "../../src/mocks/MockFrxUSD.sol";
import {
    Claim,
    ClaimState,
    RecipientType,
    CallReason,
    Params,
    SubmitClaimParams,
    OrgCapExceeded,
    InsufficientIdleCash,
    EmergencyModeActive,
    LenderNotAllowed,
    DepositsPaused
} from "../../src/libraries/ClaimTypes.sol";

/// @notice Every non-lender actor the adversarial handler drives.
struct AdversarialActors {
    address admin;
    address underwriter;
    address attester;
    address pauser;
    // not allowlisted; only ever gets shares by transfer
    address outsider;
    // never holds shares; moves other holders' shares and assets through allowances
    address spender;
    // pays claims it has nothing to do with
    address payer;
    // a fresh address that only ever receives frxUSD
    address sink;
}

/// @notice Second invariant handler for the security campaign (Workstream C). Unlike `Handler.sol` it has an
/// attacker: an outsider holding transferred shares, an allowance spender, a third-party payer, receivers that
/// differ from callers and owners, allowlist and officer toggles, over-cap purchase attempts that must revert,
/// and a one-way emergency closeout at a random point. Runs with `fail_on_revert = true`, so
/// every action checks its own preconditions. The `tracked` modifier snapshots every holder's redeemable value
/// before and after each action for I-4 and I-9.
contract AdversarialHandler is Test {
    uint256 internal constant VIRTUAL_SHARES = 1e6;
    uint256 internal constant ONE_SHARE = 1e24;
    uint256 internal constant MAX_ORGS = 4;
    /// @dev Below this NAV with shares outstanding, deposits are skipped: that region is the known zero-NAV
    /// recovery capture (Workstream A1), owned by another workstream.
    uint256 internal constant NEAR_ZERO_NAV = 1e18;

    ClaimRegistry public registry;
    ReceivablesPool public pool;
    OrgRegistry public orgs;
    MockFrxUSD public frxUSD;

    address public admin;
    address public underwriter;
    address public attester;
    address public pauser;
    address public outsider;
    address public spender;
    address public payer;
    address public sink;

    address[] public lenders;
    /// @dev H: every address that can ever hold shares (the lenders and the outsider). Nothing else gets shares.
    address[] public holders;
    address[] public members;
    address[] public officers;
    mapping(address => uint256) internal _officerKey;
    uint64[] public orgIds;

    // ---------------------------------------------------------------- I-7 money in and out
    uint256 public ghostDeposited;
    uint256 public ghostSettledIn;
    uint256 public ghostDonated;
    uint256 public ghostPurchasedOut;
    uint256 public ghostWithdrawnOut;
    uint256 public ghostEmergencyOut;
    bool public ghostOutflowOutsideAllowedPath;

    // ---------------------------------------------------------------- I-4
    bool public ghostSharePriceDroppedOutsideWriteOff;
    bool public ghostWriteOffDropMismatch;

    // ---------------------------------------------------------------- I-5 and attempts that must revert
    bool public ghostOrgCapBreachedAtPurchase;
    bool public ghostOverCapPurchaseSucceeded;
    bool public ghostOverCapWrongError;
    bool public ghostOutsiderDepositSucceeded;
    bool public ghostOutsiderDepositWrongError;
    uint256 public overCapReverts;
    uint256 public idleCashReverts;
    uint256 public emergencyPurchaseReverts;

    // ---------------------------------------------------------------- I-6
    bool public ghostTerminalStateChanged;
    bool public ghostWrittenOffMovedElsewhere;
    bool public ghostDepositOpenWhilePaused;
    mapping(uint256 claimId => ClaimState) public ghostLastState;

    // ---------------------------------------------------------------- I-9
    bool public ghostI9aViolated;
    bool public ghostI9bViolated;
    /// @dev F_j: assets in as receiver minus assets out as owner, plus value moved by share transfers.
    mapping(address => int256) public ghostFlow;
    /// @dev E_j: pro-rata share of every NAV event while j held shares.
    mapping(address => int256) public ghostNav;
    /// @dev Rounding budget for I-9c, grown by every action that moved j's position or the pool's A or S.
    mapping(address => uint256) public ghostTol;

    // ---------------------------------------------------------------- I-10
    uint256 public ghostPrincipalReturned;

    // ---------------------------------------------------------------- I-11
    bool public ghostEmergency;
    bool public ghostEmergencyFreezeBroken;
    uint256 public ghostS0;
    uint256 public ghostR;
    mapping(address => uint256) public ghostB0;

    // coverage counters: how often each check ran on a non-trivial input
    uint256 public navEventsChecked;
    uint256 public lossWriteOffsChecked;
    uint256 public crossHolderChecks;
    /// @dev Actions that did something (early returns excluded), and the count when emergency mode started.
    uint256 public actionCount;
    uint256 public emergencyAtAction;

    /// @dev The first violation found, with the action and numbers that broke it.
    string public ghostDetail;

    mapping(bytes32 action => uint256) public calls;
    uint256 internal _packetNonce;

    // per-action context, reset by `tracked`
    bytes32 internal _action;
    address internal _exemptA;
    address internal _exemptB;
    bool internal _skipI9a;
    bool internal _isWriteOff;
    bool internal _isEmergencyWithdraw;
    uint256 internal _writtenOffUnpaid;

    struct Snap {
        uint256 price;
        uint256 balance;
        uint256 assets;
        uint256 supply;
        uint256[] value;
        uint256[] shares;
    }

    constructor(
        ClaimRegistry registry_,
        ReceivablesPool pool_,
        OrgRegistry orgs_,
        MockFrxUSD frxUSD_,
        AdversarialActors memory actors,
        address[] memory lenders_,
        address[] memory members_,
        address[] memory officers_,
        uint256[] memory officerKeys,
        uint64[] memory orgIds_
    ) {
        registry = registry_;
        pool = pool_;
        orgs = orgs_;
        frxUSD = frxUSD_;
        admin = actors.admin;
        underwriter = actors.underwriter;
        attester = actors.attester;
        pauser = actors.pauser;
        outsider = actors.outsider;
        spender = actors.spender;
        payer = actors.payer;
        sink = actors.sink;
        lenders = lenders_;
        for (uint256 i = 0; i < lenders_.length; i++) {
            holders.push(lenders_[i]);
        }
        holders.push(actors.outsider);
        members = members_;
        officers = officers_;
        for (uint256 i = 0; i < officers_.length; i++) {
            _officerKey[officers_[i]] = officerKeys[i];
        }
        orgIds = orgIds_;
    }

    /// @notice Setup-only first deposit, so purchases can happen early. Not a fuzz target.
    function bootstrap(address lender, uint256 amount) external {
        frxUSD.mint(lender, amount);
        vm.startPrank(lender);
        frxUSD.approve(address(pool), amount);
        pool.deposit(amount, lender);
        vm.stopPrank();
        ghostDeposited += amount;
        ghostFlow[lender] += int256(amount);
        ghostTol[lender] += 2;
    }

    // ---------------------------------------------------------------- bookkeeping

    modifier tracked(bool mayMoveMoneyOut) {
        _action = "";
        _exemptA = address(0);
        _exemptB = address(0);
        _skipI9a = false;
        _isWriteOff = false;
        _isEmergencyWithdraw = false;
        _writtenOffUnpaid = 0;
        Snap memory before = _snap();
        _;
        _afterAction(before, mayMoveMoneyOut);
    }

    function _snap() internal view returns (Snap memory s) {
        uint256 n = holders.length;
        s.price = sharePrice();
        s.balance = frxUSD.balanceOf(address(pool));
        s.assets = pool.totalAssets();
        s.supply = pool.totalSupply();
        s.value = new uint256[](n);
        s.shares = new uint256[](n);
        for (uint256 j = 0; j < n; j++) {
            s.shares[j] = pool.balanceOf(holders[j]);
            s.value[j] = pool.previewRedeem(s.shares[j]);
        }
    }

    function _afterAction(Snap memory before, bool mayMoveMoneyOut) internal {
        Snap memory afterwards = _snap();
        _checkPrice(before, afterwards);
        if (!mayMoveMoneyOut && afterwards.balance < before.balance) {
            ghostOutflowOutsideAllowedPath = true;
            _fail("I-7 outflow", before.balance, afterwards.balance);
        }
        _checkNoCrossHolderTransfer(before, afterwards);
        _checkProRata(before, afterwards);
        _recordStates();
    }

    /// @dev I-4 strengthened: a write-off lowers the price by the loss per share, nothing else but an emergency
    /// payout (which shrinks idle cash at a fixed supply) lowers it beyond 1 wei.
    function _checkPrice(Snap memory before, Snap memory afterwards) internal {
        if (_isWriteOff) {
            if (_writtenOffUnpaid > 0) lossWriteOffsChecked++;
            uint256 expected = Math.mulDiv(ONE_SHARE, _writtenOffUnpaid, before.supply + VIRTUAL_SHARES);
            uint256 drop = before.price > afterwards.price ? before.price - afterwards.price : 0;
            if (afterwards.price > before.price || _absDiff(drop, expected) > 2) {
                ghostWriteOffDropMismatch = true;
                _fail("I-4 writeOff drop", drop, expected);
            }
        } else if (!_isEmergencyWithdraw && afterwards.price + 1 < before.price) {
            ghostSharePriceDroppedOutsideWriteOff = true;
            _fail("I-4 price drop", before.price, afterwards.price);
        }
    }

    /// @dev I-9a: no holder other than this action's share owner or share receiver loses more than 1 wei of
    /// redeemable value. writeOff and emergencyWithdraw are exempt.
    function _checkNoCrossHolderTransfer(Snap memory before, Snap memory afterwards) internal {
        if (_skipI9a) return;
        for (uint256 j = 0; j < holders.length; j++) {
            address h = holders[j];
            if (h == _exemptA || h == _exemptB) continue;
            if (_action != "" && before.value[j] > 0) crossHolderChecks++;
            if (afterwards.value[j] + 1 < before.value[j]) {
                ghostI9aViolated = true;
                _fail(string.concat("I-9a holder ", vm.toString(h)), before.value[j], afterwards.value[j]);
            }
        }
    }

    /// @dev I-9b: when no share moved, every holder's value moves by its pro-rata slice of the NAV change, within
    /// 2 wei. Also books that slice into E_j and grows every holder's I-9c rounding budget.
    function _checkProRata(Snap memory before, Snap memory afterwards) internal {
        uint256 n = holders.length;
        bool sharesMoved = afterwards.supply != before.supply;
        for (uint256 j = 0; j < n; j++) {
            if (afterwards.shares[j] != before.shares[j]) sharesMoved = true;
        }
        if (sharesMoved || afterwards.assets != before.assets) {
            uint256 perShareWei = Math.max(
                Math.ceilDiv(before.assets + 1, before.supply + VIRTUAL_SHARES),
                Math.ceilDiv(afterwards.assets + 1, afterwards.supply + VIRTUAL_SHARES)
            );
            for (uint256 j = 0; j < n; j++) {
                ghostTol[holders[j]] += 2 + perShareWei;
            }
        }
        if (sharesMoved) return;
        bool up = afterwards.assets >= before.assets;
        uint256 delta = up ? afterwards.assets - before.assets : before.assets - afterwards.assets;
        uint256 sv = before.supply + VIRTUAL_SHARES;
        if (delta > 0 && before.supply > 0) navEventsChecked++;
        for (uint256 j = 0; j < n; j++) {
            int256 expected = int256(Math.mulDiv(delta, before.shares[j], sv));
            if (!up) expected = -expected;
            int256 moved = int256(afterwards.value[j]) - int256(before.value[j]);
            int256 diff = moved - expected;
            if (diff > 2 || diff < -2) {
                ghostI9bViolated = true;
                _fail(
                    string.concat("I-9b holder ", vm.toString(holders[j]), " expected ", vm.toString(expected)),
                    before.value[j],
                    afterwards.value[j]
                );
            }
            ghostNav[holders[j]] += expected;
        }
    }

    function _fail(string memory what, uint256 a, uint256 b) internal {
        if (bytes(ghostDetail).length != 0) return;
        ghostDetail = string.concat(
            what,
            " in action ",
            string(abi.encodePacked(_action)),
            ": ",
            vm.toString(a),
            " -> ",
            vm.toString(b)
        );
    }

    function _recordStates() internal {
        uint256 count = registry.claimCount();
        for (uint256 id = 1; id <= count; id++) {
            ClaimState previous = ghostLastState[id];
            ClaimState current = registry.getClaim(id).state;
            if (_isTerminal(previous) && current != previous) ghostTerminalStateChanged = true;
            if (
                previous == ClaimState.WrittenOff && current != ClaimState.WrittenOff
                    && current != ClaimState.Recovered
            ) ghostWrittenOffMovedElsewhere = true;
            ghostLastState[id] = current;
        }
    }

    function _isTerminal(ClaimState s) internal pure returns (bool) {
        return s == ClaimState.Settled || s == ClaimState.Recovered || s == ClaimState.Rejected
            || s == ClaimState.Cancelled;
    }

    function sharePrice() public view returns (uint256) {
        return pool.convertToAssets(ONE_SHARE);
    }

    function holderCount() external view returns (uint256) {
        return holders.length;
    }

    function lenderCount() external view returns (uint256) {
        return lenders.length;
    }

    function orgCount() external view returns (uint256) {
        return orgIds.length;
    }

    function stateCounts() external view returns (uint256[10] memory counts) {
        uint256 count = registry.claimCount();
        for (uint256 id = 1; id <= count; id++) {
            counts[uint8(registry.getClaim(id).state)]++;
        }
    }

    uint256 internal constant SUBMITTED = 1 << uint8(ClaimState.Submitted);
    uint256 internal constant APPROVED = 1 << uint8(ClaimState.Approved);
    uint256 internal constant FUNDED = 1 << uint8(ClaimState.Funded);
    uint256 internal constant CALLED = 1 << uint8(ClaimState.GuarantorCalled);
    uint256 internal constant WRITTEN_OFF = 1 << uint8(ClaimState.WrittenOff);

    function _findClaim(uint256 seed, uint256 mask) internal view returns (uint256 id, Claim memory c) {
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

    function _hit(bytes32 action) internal {
        calls[action]++;
        actionCount++;
        _action = action;
    }

    function _absDiff(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : b - a;
    }

    function _lender(uint256 seed) internal view returns (address) {
        return lenders[seed % lenders.length];
    }

    function _holder(uint256 seed) internal view returns (address) {
        // one time in three the outsider, so transferred shares reach it often
        if (seed % 3 == 0) return outsider;
        return holders[(seed / 3) % holders.length];
    }

    /// @dev Any address that may receive frxUSD: a holder, the spender, the payer, or a fresh sink. Never the pool.
    function _receiver(uint256 seed) internal view returns (address) {
        uint256 n = holders.length;
        uint256 i = seed % (n + 3);
        if (i < n) return holders[i];
        if (i == n) return spender;
        if (i == n + 1) return payer;
        return sink;
    }

    /// @dev Most draws are ordinary sizes; one in four may go up to `max` (large deposits and claims).
    function _boundSize(uint256 x, uint256 max, uint256 ordinary) internal pure returns (uint256) {
        if (x % 4 == 0) return bound(x >> 2, 1, max);
        return bound(x >> 2, 1, Math.min(max, ordinary));
    }

    // ---------------------------------------------------------------- lenders, outsider, spender

    /// @dev Every deposit check, including the caller allowlist check that `maxDeposit` cannot see (U-42).
    /// @dev The seed-picked holder, or the caller when the allowlist would refuse that holder.
    function _depositReceiver(address caller, uint256 seed) internal view returns (address receiver) {
        receiver = _holder(seed);
        if (pool.allowlistEnabled() && !pool.isLenderAllowed(receiver)) receiver = caller;
    }

    function _depositRoom(address caller, address receiver) internal view returns (uint256) {
        if (pool.emergencyMode() || registry.paused()) return 0;
        if (pool.allowlistEnabled() && !pool.isLenderAllowed(caller)) return 0;
        // A1 scope exclusion: no deposits into a near-zero NAV with shares outstanding
        if (pool.totalSupply() > 0 && pool.totalAssets() < NEAR_ZERO_NAV) return 0;
        return pool.maxDeposit(receiver);
    }

    /// @notice An allowlisted lender deposits for any holder (receiver may differ from caller, and may be the
    /// outsider while the allowlist is off).
    function deposit(uint256 callerSeed, uint256 receiverSeed, uint256 amount) external tracked(false) {
        address caller = _lender(callerSeed);
        address receiver = _depositReceiver(caller, receiverSeed);
        uint256 max = _depositRoom(caller, receiver);
        if (max == 0) return;
        amount = _boundSize(amount, max, 100_000e18);
        frxUSD.mint(caller, amount);
        vm.startPrank(caller);
        frxUSD.approve(address(pool), amount);
        pool.deposit(amount, receiver);
        vm.stopPrank();
        ghostDeposited += amount;
        ghostFlow[receiver] += int256(amount);
        _exemptA = receiver;
        _hit("deposit");
    }

    function mint(uint256 callerSeed, uint256 receiverSeed, uint256 shares) external tracked(false) {
        address caller = _lender(callerSeed);
        address receiver = _depositReceiver(caller, receiverSeed);
        uint256 room = _depositRoom(caller, receiver);
        if (room == 0) return;
        uint256 max = pool.convertToShares(Math.min(room, shares % 4 == 0 ? room : 100_000e18));
        if (max == 0) return;
        shares = bound(shares >> 2, 1, max);
        uint256 assets = pool.previewMint(shares);
        if (assets > room) return;
        frxUSD.mint(caller, assets);
        vm.startPrank(caller);
        frxUSD.approve(address(pool), assets);
        pool.mint(shares, receiver);
        vm.stopPrank();
        ghostDeposited += assets;
        ghostFlow[receiver] += int256(assets);
        _exemptA = receiver;
        _hit("mint");
    }

    /// @notice Any holder withdraws to any receiver, directly or through the spender's allowance.
    function withdraw(uint256 ownerSeed, uint256 receiverSeed, uint256 amount, bool viaSpender)
        external
        tracked(true)
    {
        if (pool.emergencyMode()) return;
        address owner = _holder(ownerSeed);
        address receiver = _receiver(receiverSeed);
        uint256 max = pool.maxWithdraw(owner);
        if (max == 0) return;
        amount = bound(amount, 1, max);
        if (viaSpender) {
            uint256 shares = pool.previewWithdraw(amount);
            vm.prank(owner);
            pool.approve(spender, shares);
            vm.prank(spender);
            pool.withdraw(amount, receiver, owner);
            _hit("withdrawViaSpender");
        } else {
            vm.prank(owner);
            pool.withdraw(amount, receiver, owner);
            _hit("withdraw");
        }
        ghostWithdrawnOut += amount;
        ghostFlow[owner] -= int256(amount);
        _exemptA = owner;
    }

    function redeem(uint256 ownerSeed, uint256 receiverSeed, uint256 shares, bool viaSpender) external tracked(true) {
        if (pool.emergencyMode()) return;
        address owner = _holder(ownerSeed);
        address receiver = _receiver(receiverSeed);
        uint256 max = pool.maxRedeem(owner);
        if (max == 0) return;
        // one time in four redeem everything that can go
        shares = shares % 4 == 0 ? max : bound(shares >> 2, 1, max);
        uint256 assets;
        if (viaSpender) {
            vm.prank(owner);
            pool.approve(spender, shares);
            vm.prank(spender);
            assets = pool.redeem(shares, receiver, owner);
            _hit("redeemViaSpender");
        } else {
            vm.prank(owner);
            assets = pool.redeem(shares, receiver, owner);
            _hit("redeem");
        }
        ghostWithdrawnOut += assets;
        ghostFlow[owner] -= int256(assets);
        _exemptA = owner;
    }

    /// @notice Shares move between any two holders (often to the outsider), directly or by `transferFrom`.
    function transferShares(uint256 fromSeed, uint256 toSeed, uint256 shares, bool viaSpender)
        external
        tracked(false)
    {
        if (pool.emergencyMode()) return;
        address from = _holder(fromSeed);
        address to = _holder(toSeed);
        uint256 balance = pool.balanceOf(from);
        if (balance == 0) return;
        shares = shares % 4 == 0 ? balance : bound(shares >> 2, 1, balance);
        int256 moved = int256(pool.previewRedeem(shares));
        if (viaSpender) {
            vm.prank(from);
            pool.approve(spender, shares);
            vm.prank(spender);
            pool.transferFrom(from, to, shares);
            _hit("transferFrom");
        } else {
            vm.prank(from);
            pool.transfer(to, shares);
            _hit("transfer");
        }
        ghostFlow[from] -= moved;
        ghostFlow[to] += moved;
        _exemptA = from;
        _exemptB = to;
    }

    /// @notice frxUSD sent straight to the pool, up to the deposit cap's room (or 1,000 when there is none).
    function donate(uint256 amount) external tracked(false) {
        uint256 cap = pool.depositCap();
        uint256 assets = pool.totalAssets();
        uint256 room = cap > assets ? cap - assets : 0;
        amount = bound(amount, 1, Math.max(room, 1_000e18));
        frxUSD.mint(address(pool), amount);
        ghostDonated += amount;
        if (ghostEmergency) ghostR += amount;
        _hit("donate");
    }

    /// @notice The outsider tries to deposit for an allowlisted lender. With the allowlist on this must revert
    /// with `LenderNotAllowed(outsider)` (or the emergency or pause error that is checked first).
    function outsiderDepositAttempt(uint256 receiverSeed, uint256 amount) external tracked(false) {
        if (!pool.allowlistEnabled()) return;
        address receiver = _lender(receiverSeed);
        amount = bound(amount, 1, 1_000e18);
        bytes4 expected = pool.emergencyMode()
            ? EmergencyModeActive.selector
            : registry.paused() ? DepositsPaused.selector : LenderNotAllowed.selector;
        frxUSD.mint(outsider, amount);
        vm.prank(outsider);
        frxUSD.approve(address(pool), amount);
        vm.prank(outsider);
        try pool.deposit(amount, receiver) {
            ghostOutsiderDepositSucceeded = true;
            ghostDeposited += amount;
            ghostFlow[receiver] += int256(amount);
            _exemptA = receiver;
            _fail("outsider deposit succeeded", amount, 0);
        } catch (bytes memory reason) {
            if (_selector(reason) != expected) {
                ghostOutsiderDepositWrongError = true;
                _fail("outsider deposit wrong error", uint32(_selector(reason)), uint32(expected));
            }
        }
        vm.prank(outsider);
        frxUSD.approve(address(pool), 0);
        _hit("outsiderDepositAttempt");
    }

    function _selector(bytes memory reason) internal pure returns (bytes4) {
        if (reason.length < 4) return bytes4(0);
        return bytes4(reason);
    }

    // ---------------------------------------------------------------- claimants and payers

    function submitClaim(
        uint256 claimantSeed,
        uint256 guarantorSeed,
        uint256 orgSeed,
        uint256 face,
        uint256 requested,
        bool asTreasurer
    ) external tracked(false) {
        _doSubmit(claimantSeed, guarantorSeed, orgSeed, face, requested, asTreasurer);
    }

    /// @dev Submit, approve, and purchase in one step, stopping at the first stage that would revert.
    function fastTrack(uint256 seed, uint256 face, uint256 requested, uint256 amount) external tracked(true) {
        uint256 id = _doSubmit(seed, seed >> 8, seed >> 16, face, requested, (seed >> 24) % 3 == 0);
        if (id == 0) return;
        _doApprove(id, registry.getClaim(id), amount);
        Claim memory c = registry.getClaim(id);
        if (_purchasable(c)) _doPurchase(id, c);
        _hit("fastTrack");
    }

    function _doSubmit(
        uint256 claimantSeed,
        uint256 guarantorSeed,
        uint256 orgSeed,
        uint256 face,
        uint256 requested,
        bool asTreasurer
    ) internal returns (uint256) {
        if (registry.paused()) return 0;
        uint64 orgId = orgIds[orgSeed % orgIds.length];
        if (!orgs.isActiveOrg(orgId)) return 0;
        (address claimant, address guarantor) = _pickParties(orgId, claimantSeed, guarantorSeed, asTreasurer);
        if (guarantor == address(0)) return 0;
        SubmitClaimParams memory sp = _buildClaim(orgId, guarantor, face, requested);
        return _signAndSubmit(claimant, sp);
    }

    /// @dev The guarantor is an active officer of the org; a treasurer claimant is another active officer.
    function _pickParties(uint64 orgId, uint256 claimantSeed, uint256 guarantorSeed, bool asTreasurer)
        internal
        view
        returns (address claimant, address guarantor)
    {
        uint256 n = officers.length;
        uint256 g = n;
        for (uint256 i = 0; i < n; i++) {
            uint256 k = (guarantorSeed % n + i) % n;
            if (orgs.isActiveOfficer(orgId, officers[k])) {
                g = k;
                break;
            }
        }
        if (g == n) return (address(0), address(0));
        if (!asTreasurer) return (members[claimantSeed % members.length], officers[g]);
        for (uint256 i = 1; i < n; i++) {
            uint256 k = (g + i + claimantSeed % n) % n;
            if (k != g && orgs.isActiveOfficer(orgId, officers[k])) return (officers[k], officers[g]);
        }
        // no second active officer: fall back to a member claim
        return (members[claimantSeed % members.length], officers[g]);
    }

    function _buildClaim(uint64 orgId, address guarantor, uint256 face, uint256 requested)
        internal
        returns (SubmitClaimParams memory sp)
    {
        Params memory p = registry.params();
        // mostly ordinary sizes; one in four up to twice the per-claim cap (which can be 1e30)
        uint256 maxFace = Math.max(5_000e18, uint256(p.perClaimCap) * 2);
        face = face % 4 == 0 ? bound(face >> 2, 1e18, maxFace) : bound(face >> 2, 1e18, 5_000e18);
        uint256 limit = Math.min(face * p.advanceRateBps / 10_000, p.perClaimCap);
        sp = SubmitClaimParams({
            orgId: orgId,
            // set from the claimant in _signAndSubmit
            recipientType: RecipientType.Member,
            guarantor: guarantor,
            faceValue: uint128(face),
            requestedAmount: uint128(bound(requested, 1, limit)),
            packetHash: keccak256(abi.encode("adversarial-packet", ++_packetNonce))
        });
    }

    function _signAndSubmit(address claimant, SubmitClaimParams memory sp) internal returns (uint256 id) {
        // a treasurer claim needs the claimant to be an officer of the org
        if (orgs.isActiveOfficer(sp.orgId, claimant)) sp.recipientType = RecipientType.OrgTreasurer;
        uint256 deadline = vm.getBlockTimestamp() + 1 days;
        bytes32 digest = registry.guarantyDigest(
            sp.guarantor,
            claimant,
            sp.orgId,
            sp.faceValue,
            sp.requestedAmount,
            sp.packetHash,
            registry.nonces(sp.guarantor),
            deadline
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_officerKey[sp.guarantor], digest);
        vm.prank(claimant);
        id = registry.submitClaim(sp, deadline, abi.encodePacked(r, s, v));
        _hit("submitClaim");
    }

    function cancelClaim(uint256 seed) external tracked(false) {
        (uint256 id, Claim memory c) = _findClaim(seed, SUBMITTED);
        if (id == 0) return;
        vm.prank(c.recipient);
        registry.cancelClaim(id);
        _hit("cancelClaim");
    }

    function purchaseClaim(uint256 seed) external tracked(true) {
        (uint256 id, Claim memory c) = _findPurchasable(seed);
        if (id != 0) _doPurchase(id, c);
    }

    function _doPurchase(uint256 id, Claim memory c) internal {
        uint256 cap = registry.orgCap(c.orgId);
        vm.prank(c.recipient);
        registry.purchaseClaim(id);
        ghostPurchasedOut += c.approvedAmount;
        if (registry.orgOutstanding(c.orgId) > cap) ghostOrgCapBreachedAtPurchase = true;
        _hit("purchaseClaim");
    }

    function _purchasable(Claim memory c) internal view returns (bool) {
        if (pool.emergencyMode() || registry.paused()) return false;
        if (c.state != ClaimState.Approved || vm.getBlockTimestamp() >= c.approvalExpiresAt) return false;
        if (!orgs.isActiveOrg(c.orgId) || pool.idleCash() < c.approvedAmount) return false;
        if (!orgs.isActiveOfficer(c.orgId, c.guarantor)) return false;
        return registry.orgOutstanding(c.orgId) + c.approvedAmount <= registry.orgCap(c.orgId);
    }

    function _findPurchasable(uint256 seed) internal view returns (uint256, Claim memory) {
        uint256 count = registry.claimCount();
        Claim memory none;
        if (count == 0) return (0, none);
        uint256 start = seed % count;
        for (uint256 i = 0; i < count; i++) {
            uint256 id = (start + i) % count + 1;
            Claim memory c = registry.getClaim(id);
            if (_purchasable(c)) return (id, c);
        }
        return (0, none);
    }

    /// @notice A purchase that must fail on the org cap or idle cash (or emergency mode). When the claim found
    /// would pass, the admin lowers the org cap override to one wei under what it needs, and restores it after.
    /// Any success, or any other error, is a violation; this is what makes I-5 meaningful.
    function overCapPurchaseAttempt(uint256 seed) external tracked(true) {
        if (registry.paused()) return;
        (uint256 id, Claim memory c) = _findClaim(seed, APPROVED);
        if (id == 0) return;
        if (vm.getBlockTimestamp() >= c.approvalExpiresAt || !orgs.isActiveOrg(c.orgId)) return;
        if (!orgs.isActiveOfficer(c.orgId, c.guarantor)) return;
        uint256 needed = registry.orgOutstanding(c.orgId) + c.approvedAmount;
        bool overCap = needed > registry.orgCap(c.orgId);
        bool shortCash = pool.idleCash() < c.approvedAmount;
        bool forced;
        uint128 oldOverride = registry.orgCapOverride(c.orgId);
        if (!overCap && !shortCash && !pool.emergencyMode()) {
            // an override of 0 means "no override", so a 1-wei claim on an empty org cannot be forced
            if (needed - 1 == 0 || needed - 1 > type(uint128).max) return;
            vm.prank(admin);
            registry.setOrgCap(c.orgId, uint128(needed - 1));
            forced = true;
        }
        bytes4 expected = (overCap || forced)
            ? OrgCapExceeded.selector
            : shortCash ? InsufficientIdleCash.selector : EmergencyModeActive.selector;
        _attemptPurchase(id, c, expected);
        if (forced) {
            vm.prank(admin);
            registry.setOrgCap(c.orgId, oldOverride);
        }
        _hit("overCapPurchaseAttempt");
    }

    function _attemptPurchase(uint256 id, Claim memory c, bytes4 expected) internal {
        vm.prank(c.recipient);
        try registry.purchaseClaim(id) {
            ghostOverCapPurchaseSucceeded = true;
            ghostPurchasedOut += c.approvedAmount;
            _fail("over-cap purchase succeeded", id, c.approvedAmount);
        } catch (bytes memory reason) {
            bytes4 got = _selector(reason);
            if (got != expected) {
                ghostOverCapWrongError = true;
                _fail("over-cap purchase wrong error", uint32(got), uint32(expected));
            } else if (got == OrgCapExceeded.selector) {
                overCapReverts++;
            } else if (got == InsufficientIdleCash.selector) {
                idleCashReverts++;
            } else {
                emergencyPurchaseReverts++;
            }
        }
    }

    /// @notice The claimant, the guarantor, or an unrelated third party pays any amount up to twice what is left.
    function settle(uint256 seed, uint256 payerSeed, uint256 amount) external tracked(false) {
        (uint256 id, Claim memory c) = _findClaim(seed, FUNDED | CALLED | WRITTEN_OFF);
        if (id == 0) return;
        uint256 remaining = registry.amountRemaining(id);
        if (remaining == 0) return;
        amount = bound(amount, 1, remaining * 2);
        uint256 pick = payerSeed % 3;
        address who = pick == 0 ? c.recipient : pick == 1 ? c.guarantor : payer;
        frxUSD.mint(who, amount);
        vm.startPrank(who);
        frxUSD.approve(address(registry), amount);
        uint256 paid = registry.settle(id, amount);
        frxUSD.approve(address(registry), 0);
        vm.stopPrank();
        if (!c.principalWrittenOff) {
            uint256 paidAfter = registry.getClaim(id).amountPaid;
            uint256 price = c.purchasePrice;
            ghostPrincipalReturned += Math.min(paidAfter, price) - Math.min(c.amountPaid, price);
        }
        ghostSettledIn += paid;
        if (ghostEmergency) ghostR += paid;
        _hit(pick == 2 ? bytes32("settleThirdParty") : bytes32("settle"));
    }

    // ---------------------------------------------------------------- underwriter and attester

    function approveClaim(uint256 seed, uint256 amount) external tracked(false) {
        if (registry.paused()) return;
        (uint256 id, Claim memory c) = _findClaim(seed, seed % 4 == 0 ? APPROVED : SUBMITTED);
        if (id == 0) (id, c) = _findClaim(seed, SUBMITTED | APPROVED);
        if (id != 0) _doApprove(id, c, amount);
    }

    function _doApprove(uint256 id, Claim memory c, uint256 amount) internal {
        if (registry.paused()) return;
        uint256 max = Math.min(c.requestedAmount, registry.params().perClaimCap);
        amount = bound(amount, 1, max);
        vm.prank(underwriter);
        registry.approveClaim(id, uint128(amount));
        _hit("approveClaim");
    }

    function rejectClaim(uint256 seed) external tracked(false) {
        (uint256 id,) = _findClaim(seed, SUBMITTED | APPROVED);
        if (id == 0) return;
        vm.prank(underwriter);
        registry.rejectClaim(id, "OTHER");
        _hit("rejectClaim");
    }

    function callGuarantor(uint256 seed, uint256 reasonSeed) external tracked(false) {
        (uint256 id, Claim memory c) = _findClaim(seed, FUNDED);
        if (id == 0) return;
        CallReason reason = CallReason(bound(reasonSeed, 1, 3));
        if (reason == CallReason.Overdue && vm.getBlockTimestamp() < c.dueAt) reason = CallReason.AsucRejected;
        vm.prank(attester);
        registry.callGuarantor(id, reason);
        _hit("callGuarantor");
    }

    function writeOff(uint256 seed) external tracked(false) {
        (uint256 id, Claim memory c) = _findClaim(seed, CALLED);
        if (id == 0) return;
        if (vm.getBlockTimestamp() < c.writeOffEligibleAt) vm.warp(c.writeOffEligibleAt);
        vm.prank(attester);
        registry.writeOff(id);
        _isWriteOff = true;
        _skipI9a = true;
        _writtenOffUnpaid = registry.getClaim(id).writtenOffPrincipal;
        _hit("writeOff");
    }

    // ---------------------------------------------------------------- admin, pauser, time

    function setParams(
        uint16 advanceRateBps,
        uint16 feeBps,
        uint128 perClaimCap,
        uint128 perOrgCap,
        uint32 overdueWindow,
        uint32 approvalExpiry,
        uint32 writeOffGrace
    ) external tracked(false) {
        uint128 claimCap = perClaimCap % 4 == 0
            ? uint128(bound(perClaimCap >> 2, 100e18, 1e30))
            : uint128(bound(perClaimCap >> 2, 100e18, 5_000e18));
        uint128 orgUpper = perOrgCap % 3 == 0 ? 1e30 : uint128(Math.max(uint256(claimCap) * 4, 20_000e18));
        Params memory p = Params({
            advanceRateBps: uint16(bound(advanceRateBps, 5_000, 10_000)),
            feeBps: uint16(bound(feeBps, 0, 10_000)),
            perClaimCap: claimCap,
            perOrgCap: uint128(bound(perOrgCap, perOrgCap % 8 == 0 ? 1e18 : claimCap, orgUpper)),
            overdueWindow: uint32(bound(overdueWindow, 1 days, 200 days)),
            approvalExpiry: uint32(bound(approvalExpiry, 3 days, 30 days)),
            writeOffGrace: uint32(bound(writeOffGrace, 1 days, 90 days))
        });
        vm.prank(admin);
        registry.setParams(p);
        _hit("setParams");
    }

    function setDepositCap(uint256 cap) external tracked(false) {
        // one in four anywhere up to 1e30 (often below totalAssets, which closes deposits); otherwise room above
        // the current assets so deposits keep flowing
        uint256 assets = pool.totalAssets();
        cap = cap % 4 == 0 ? bound(cap >> 2, 0, 1e30) : bound(cap >> 2, assets, assets + 200_000e18);
        vm.prank(admin);
        pool.setDepositCap(cap);
        _hit("setDepositCap");
    }

    function setAllowlistEnabled(bool enabled) external tracked(false) {
        vm.prank(admin);
        pool.setAllowlistEnabled(enabled);
        _hit("setAllowlistEnabled");
    }

    /// @notice Toggles a lender on the allowlist (the outsider is never allowlisted).
    function setLenderAllowed(uint256 lenderSeed, uint256 allowedSeed) external tracked(false) {
        vm.prank(admin);
        pool.setLenderAllowed(_lender(lenderSeed), allowedSeed % 4 != 0);
        _hit("setLenderAllowed");
    }

    function setOrgCap(uint256 orgSeed, uint128 cap) external tracked(false) {
        cap = cap % 4 == 0 ? 0 : uint128(bound(cap, 1e18, 60_000e18));
        vm.prank(admin);
        registry.setOrgCap(orgIds[orgSeed % orgIds.length], cap);
        _hit("setOrgCap");
    }

    function setOrgActive(uint256 orgSeed, uint256 activeSeed) external tracked(false) {
        vm.prank(admin);
        orgs.setOrgActive(orgIds[orgSeed % orgIds.length], activeSeed % 4 != 0);
        _hit("setOrgActive");
    }

    function setOfficer(uint256 orgSeed, uint256 officerSeed, uint256 activeSeed) external tracked(false) {
        vm.prank(admin);
        orgs.setOfficer(orgIds[orgSeed % orgIds.length], officers[officerSeed % officers.length], activeSeed % 4 != 0);
        _hit("setOfficer");
    }

    function addOrg(uint256 officerSeed) external tracked(false) {
        if (orgIds.length >= MAX_ORGS) return;
        vm.startPrank(admin);
        uint64 orgId = orgs.addOrg(string.concat("Adversarial Org ", vm.toString(orgIds.length + 1)));
        orgs.setOfficer(orgId, officers[officerSeed % officers.length], true);
        orgs.setOfficer(orgId, officers[(officerSeed % officers.length + 1) % officers.length], true);
        vm.stopPrank();
        orgIds.push(orgId);
        _hit("addOrg");
    }

    function togglePause(uint256 seed) external tracked(false) {
        if (registry.paused()) {
            vm.prank(admin);
            registry.unpause();
            _hit("togglePause");
            return;
        }
        vm.prank(pauser);
        registry.pause();
        for (uint256 i = 0; i < holders.length; i++) {
            if (pool.maxDeposit(holders[i]) != 0 || pool.maxMint(holders[i]) != 0) ghostDepositOpenWhilePaused = true;
        }
        if (seed % 4 != 0) {
            vm.prank(admin);
            registry.unpause();
        }
        _hit("togglePause");
    }

    /// @notice One-way closeout at a random point: never in the first 10 actions, then one call in four that
    /// lands here. Most deep runs spend 100+ calls in normal operation first; about one default-profile run in
    /// five reaches it. Snapshots S0, b0_i, R0.
    function activateEmergencyMode(uint256 seed) external tracked(false) {
        if (pool.emergencyMode() || actionCount < 10 || seed % 4 != 0) return;
        emergencyAtAction = actionCount;
        ghostS0 = pool.totalSupply();
        for (uint256 i = 0; i < holders.length; i++) {
            ghostB0[holders[i]] = pool.balanceOf(holders[i]);
        }
        ghostR = pool.idleCash();
        ghostEmergency = true;
        vm.prank(admin);
        pool.activateEmergencyMode();
        _hit("activateEmergencyMode");
    }

    /// @notice Any holder with a positive entitlement takes it to itself or another receiver (never the pool).
    function emergencyWithdraw(uint256 holderSeed, uint256 receiverSeed) external tracked(true) {
        if (!pool.emergencyMode()) return;
        uint256 n = holders.length;
        address who;
        for (uint256 i = 0; i < n; i++) {
            address h = holders[(holderSeed % n + i) % n];
            if (pool.maxEmergencyWithdraw(h) > 0) {
                who = h;
                break;
            }
        }
        if (who == address(0)) return;
        address receiver = _receiver(receiverSeed);
        vm.prank(who);
        ghostEmergencyOut += pool.emergencyWithdraw(receiver);
        _isEmergencyWithdraw = true;
        _skipI9a = true;
        _hit("emergencyWithdraw");
    }

    /// @notice In emergency mode a holder tries to transfer, withdraw, redeem, and deposit. Each must revert with
    /// `EmergencyModeActive`: balances are frozen so every holder keeps its claim on later receipts (U-80).
    function emergencyFrozenAttempt(uint256 holderSeed, uint256 receiverSeed, uint256 kind) external tracked(false) {
        if (!pool.emergencyMode()) return;
        address who = _holder(holderSeed);
        address other = _holder(receiverSeed);
        uint256 balance = pool.balanceOf(who);
        uint256 amount = balance == 0 ? 1 : balance;
        bytes memory call;
        kind = kind % 5;
        if (kind == 0) call = abi.encodeCall(pool.transfer, (other, amount));
        else if (kind == 1) call = abi.encodeCall(pool.withdraw, (1, _receiver(receiverSeed), who));
        else if (kind == 2) call = abi.encodeCall(pool.redeem, (amount, _receiver(receiverSeed), who));
        else if (kind == 3) call = abi.encodeCall(pool.deposit, (1, other));
        else call = abi.encodeCall(pool.mint, (1, other));
        vm.prank(who);
        (bool ok, bytes memory reason) = address(pool).call(call);
        if (ok || _selector(reason) != EmergencyModeActive.selector) {
            ghostEmergencyFreezeBroken = true;
            _fail("emergency freeze broken, kind", kind, ok ? 1 : 0);
        }
        _hit("emergencyFrozenAttempt");
    }

    /// @notice Up to 10 days, or one time in eight up to 2 years.
    function warp(uint256 seconds_) external tracked(false) {
        uint256 step = seconds_ % 8 == 0 ? bound(seconds_ >> 3, 1, 730 days) : bound(seconds_ >> 3, 1, 10 days);
        vm.warp(vm.getBlockTimestamp() + step);
        _hit("warp");
    }
}
