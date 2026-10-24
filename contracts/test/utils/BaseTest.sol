// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ClaimRegistry} from "../../src/ClaimRegistry.sol";
import {ReceivablesPool} from "../../src/ReceivablesPool.sol";
import {ClaimNFT} from "../../src/ClaimNFT.sol";
import {OrgRegistry} from "../../src/OrgRegistry.sol";
import {MockFrxUSD} from "../../src/mocks/MockFrxUSD.sol";
import {Claim, ClaimState, RecipientType, CallReason, Params, SubmitClaimParams} from "../../src/libraries/ClaimTypes.sol";

/// @notice Deploys and wires the full system with the PRD section 6 terms, plus actors and flow helpers.
abstract contract BaseTest is Test {
    uint128 internal constant PER_CLAIM_CAP = 2_500e18;
    uint128 internal constant PER_ORG_CAP = 10_000e18;
    uint256 internal constant POOL_CAP = 50_000e18;
    uint32 internal constant OVERDUE_WINDOW = 180 days;
    uint32 internal constant APPROVAL_EXPIRY = 14 days;
    uint32 internal constant WRITE_OFF_GRACE = 60 days;
    uint256 internal constant START_TIME = 1_790_000_000;
    uint256 internal constant SEED = 20_000e18;
    uint128 internal constant FACE = 1_000e18;
    bytes32 internal constant REASON = "MISSING_RECEIPTS";

    MockFrxUSD internal frxUSD;
    OrgRegistry internal orgs;
    ClaimNFT internal nft;
    ReceivablesPool internal pool;
    ClaimRegistry internal registry;

    address internal admin = makeAddr("admin");
    address internal underwriter = makeAddr("underwriter");
    address internal attester = makeAddr("attester");
    address internal pauser = makeAddr("pauser");
    address internal lender = makeAddr("lender");
    address internal claimant = makeAddr("claimant");
    address internal treasurer = makeAddr("treasurer");
    address internal payer = makeAddr("payer");
    address internal outsider = makeAddr("outsider");
    address internal guarantor;
    uint256 internal guarantorKey;
    address internal guarantor2;
    uint256 internal guarantor2Key;

    uint64 internal orgId;
    uint64 internal org2Id;
    uint256 private _packetNonce;

    function setUp() public virtual {
        vm.warp(START_TIME);
        (guarantor, guarantorKey) = makeAddrAndKey("guarantor");
        (guarantor2, guarantor2Key) = makeAddrAndKey("guarantor2");

        frxUSD = new MockFrxUSD();
        orgs = new OrgRegistry(admin);
        nft = new ClaimNFT(admin);
        pool = new ReceivablesPool(IERC20(address(frxUSD)), admin);
        registry = new ClaimRegistry(admin, pool, nft, orgs, defaultParams());

        vm.startPrank(admin);
        pool.setRegistry(address(registry));
        nft.setRegistry(address(registry));
        nft.setBaseURI("https://functions.test/nft-metadata/");
        pool.setDepositCap(POOL_CAP);
        pool.setLenderAllowed(lender, true);
        registry.grantRole(registry.UNDERWRITER_ROLE(), underwriter);
        registry.grantRole(registry.ATTESTER_ROLE(), attester);
        registry.grantRole(registry.PAUSER_ROLE(), pauser);
        orgId = orgs.addOrg("Blockchain at Berkeley");
        orgs.setOfficer(orgId, guarantor, true);
        orgs.setOfficer(orgId, guarantor2, true);
        orgs.setOfficer(orgId, treasurer, true);
        org2Id = orgs.addOrg("Cal Rocketry");
        orgs.setOfficer(org2Id, guarantor2, true);
        vm.stopPrank();

        vm.label(address(frxUSD), "frxUSD");
        vm.label(address(orgs), "OrgRegistry");
        vm.label(address(nft), "ClaimNFT");
        vm.label(address(pool), "ReceivablesPool");
        vm.label(address(registry), "ClaimRegistry");
    }

    // ---------------------------------------------------------------- config

    function defaultParams() internal pure returns (Params memory) {
        return Params({
            advanceRateBps: 10_000,
            feeBps: 0,
            perClaimCap: PER_CLAIM_CAP,
            perOrgCap: PER_ORG_CAP,
            overdueWindow: OVERDUE_WINDOW,
            approvalExpiry: APPROVAL_EXPIRY,
            writeOffGrace: WRITE_OFF_GRACE
        });
    }

    function _setFee(uint16 feeBps) internal {
        Params memory p = registry.params();
        p.feeBps = feeBps;
        vm.prank(admin);
        registry.setParams(p);
    }

    function _setParams(Params memory p) internal {
        vm.prank(admin);
        registry.setParams(p);
    }

    // ---------------------------------------------------------------- pool

    function _seedPool(uint256 amount) internal {
        _deposit(lender, amount);
    }

    function _deposit(address who, uint256 amount) internal returns (uint256 shares) {
        frxUSD.mint(who, amount);
        vm.startPrank(who);
        frxUSD.approve(address(pool), amount);
        shares = pool.deposit(amount, who);
        vm.stopPrank();
    }

    /// @dev Assets per 1e24 shares (one whole share), the price I-4 tracks.
    function _sharePrice() internal view returns (uint256) {
        return pool.convertToAssets(10 ** pool.decimals());
    }

    // ---------------------------------------------------------------- claims

    function _nextPacket() internal returns (bytes32) {
        return keccak256(abi.encode("packet", ++_packetNonce));
    }

    function _params(uint64 org, RecipientType kind, address g, uint128 face, uint128 requested)
        internal
        returns (SubmitClaimParams memory)
    {
        return SubmitClaimParams({
            orgId: org,
            recipientType: kind,
            guarantor: g,
            faceValue: face,
            requestedAmount: requested,
            packetHash: _nextPacket()
        });
    }

    function _sign(uint256 key, address recipient, SubmitClaimParams memory p, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = registry.guarantyDigest(
            p.guarantor, recipient, p.orgId, p.faceValue, p.requestedAmount, p.packetHash, nonce, deadline
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _deadline() internal view returns (uint256) {
        return vm.getBlockTimestamp() + 7 days;
    }

    function _submitWith(address who, SubmitClaimParams memory p, uint256 key) internal returns (uint256 id) {
        uint256 deadline = _deadline();
        bytes memory sig = _sign(key, who, p, registry.nonces(p.guarantor), deadline);
        vm.prank(who);
        id = registry.submitClaim(p, deadline, sig);
    }

    function _submit(uint128 face, uint128 requested) internal returns (uint256) {
        return _submitWith(claimant, _params(orgId, RecipientType.Member, guarantor, face, requested), guarantorKey);
    }

    function _submitDefault() internal returns (uint256) {
        return _submit(FACE, FACE);
    }

    function _approve(uint256 id, uint128 amount) internal {
        vm.prank(underwriter);
        registry.approveClaim(id, amount);
    }

    function _approved(uint128 amount) internal returns (uint256 id) {
        id = _submit(amount, amount);
        _approve(id, amount);
    }

    function _purchase(uint256 id) internal {
        vm.prank(registry.getClaim(id).recipient);
        registry.purchaseClaim(id);
    }

    /// @dev Seeds the pool if needed, then takes a fresh claim to `Funded`.
    function _funded(uint128 amount) internal returns (uint256 id) {
        if (pool.idleCash() < amount) _seedPool(SEED);
        id = _approved(amount);
        _purchase(id);
    }

    function _pay(address who, uint256 id, uint256 amount) internal returns (uint256 paid) {
        frxUSD.mint(who, amount);
        vm.startPrank(who);
        frxUSD.approve(address(registry), amount);
        paid = registry.settle(id, amount);
        vm.stopPrank();
    }

    function _callGuarantor(uint256 id, CallReason reason) internal {
        vm.prank(attester);
        registry.callGuarantor(id, reason);
    }

    function _guarantorCalled(uint128 amount) internal returns (uint256 id) {
        id = _funded(amount);
        _callGuarantor(id, CallReason.AsucRejected);
    }

    function _writeOff(uint256 id) internal {
        vm.warp(registry.getClaim(id).writeOffEligibleAt);
        vm.prank(attester);
        registry.writeOff(id);
    }

    function _writtenOff(uint128 amount) internal returns (uint256 id) {
        id = _guarantorCalled(amount);
        _writeOff(id);
    }

    function _state(uint256 id) internal view returns (ClaimState) {
        return registry.getClaim(id).state;
    }

    function _claim(uint256 id) internal view returns (Claim memory) {
        return registry.getClaim(id);
    }
}
