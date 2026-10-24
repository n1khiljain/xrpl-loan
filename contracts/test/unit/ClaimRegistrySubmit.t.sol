// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BaseTest} from "../utils/BaseTest.sol";
import {MockERC1271Wallet} from "../utils/MockERC1271Wallet.sol";
import {ClaimRegistry} from "../../src/ClaimRegistry.sol";
import {ReceivablesPool} from "../../src/ReceivablesPool.sol";
import {IClaimRegistry} from "../../src/interfaces/IClaimRegistry.sol";
import {IReceivablesPool} from "../../src/interfaces/IReceivablesPool.sol";
import {IClaimNFT} from "../../src/interfaces/IClaimNFT.sol";
import {IOrgRegistry} from "../../src/interfaces/IOrgRegistry.sol";
import {
    Params,
    RecipientType,
    ClaimState,
    SubmitClaimParams,
    OrgInactive,
    NotOfficer,
    GuarantorIsRecipient,
    InvalidGuaranty,
    GuarantyExpired,
    AmountExceedsLimit,
    PacketAlreadyUsed,
    ZeroPacketHash,
    ZeroAmount,
    ZeroAddress,
    InvalidParams
} from "../../src/libraries/ClaimTypes.sol";

contract ClaimRegistrySubmitTest is BaseTest {
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    function _member(uint128 face, uint128 requested) internal returns (SubmitClaimParams memory) {
        return _params(orgId, RecipientType.Member, guarantor, face, requested);
    }

    function _submitExpectRevert(address who, SubmitClaimParams memory p, bytes memory sig, bytes memory err)
        internal
    {
        uint256 deadline = _deadline();
        vm.expectRevert(err);
        vm.prank(who);
        registry.submitClaim(p, deadline, sig);
    }

    function _validSig(address who, SubmitClaimParams memory p) internal view returns (bytes memory) {
        return _sign(guarantorKey, who, p, registry.nonces(p.guarantor), _deadline());
    }

    // ---------------------------------------------------------------- constructor

    function test_constructor_setsWiringAndParams() public view {
        assertEq(address(registry.pool()), address(pool));
        assertEq(address(registry.nft()), address(nft));
        assertEq(address(registry.orgs()), address(orgs));
        assertEq(address(registry.frxUSD()), address(frxUSD), "frxUSD comes from the pool's asset");
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), admin));
        assertEq(abi.encode(registry.params()), abi.encode(defaultParams()));
        assertEq(registry.claimCount(), 0);
        assertFalse(registry.paused());
    }

    function test_constructor_emitsInitialParams() public {
        Params memory zero;
        ReceivablesPool freshPool = new ReceivablesPool(IERC20(address(frxUSD)), admin);
        vm.expectEmit();
        emit IClaimRegistry.ParamsUpdated(zero, defaultParams());
        new ClaimRegistry(admin, freshPool, nft, orgs, defaultParams());
    }

    function test_constructor_revertsOnZeroAddress() public {
        Params memory p = defaultParams();
        vm.expectRevert(ZeroAddress.selector);
        new ClaimRegistry(address(0), pool, nft, orgs, p);
        vm.expectRevert(ZeroAddress.selector);
        new ClaimRegistry(admin, IReceivablesPool(address(0)), nft, orgs, p);
        vm.expectRevert(ZeroAddress.selector);
        new ClaimRegistry(admin, pool, IClaimNFT(address(0)), orgs, p);
        vm.expectRevert(ZeroAddress.selector);
        new ClaimRegistry(admin, pool, nft, IOrgRegistry(address(0)), p);
    }

    function test_constructor_revertsOnInvalidParams() public {
        Params memory p = defaultParams();
        p.perClaimCap = 0;
        vm.expectRevert(InvalidParams.selector);
        new ClaimRegistry(admin, pool, nft, orgs, p);
    }

    // ---------------------------------------------------------------- happy paths

    function test_submitClaim_memberWithNonOfficerClaimant() public {
        assertFalse(orgs.isActiveOfficer(orgId, claimant));
        uint256 id = _submitDefault();
        assertEq(uint8(_state(id)), uint8(ClaimState.Submitted));
        assertEq(uint8(_claim(id).recipientType), uint8(RecipientType.Member));
    }

    function test_submitClaim_treasurerWhoIsOfficer() public {
        SubmitClaimParams memory p = _params(orgId, RecipientType.OrgTreasurer, guarantor, FACE, FACE);
        uint256 id = _submitWith(treasurer, p, guarantorKey);
        assertEq(_claim(id).recipient, treasurer);
        assertEq(uint8(_claim(id).recipientType), uint8(RecipientType.OrgTreasurer));
    }

    function test_submitClaim_idsStartAtOneAndIncrement() public {
        assertEq(_submitDefault(), 1);
        assertEq(_submitDefault(), 2);
        assertEq(registry.claimCount(), 2);
        assertEq(registry.getClaim(2).id, 2);
    }

    function test_submitClaim_consumesGuarantorNonce() public {
        assertEq(registry.nonces(guarantor), 0);
        _submitDefault();
        assertEq(registry.nonces(guarantor), 1);
        _submitDefault();
        assertEq(registry.nonces(guarantor), 2);
        assertEq(registry.nonces(guarantor2), 0, "nonces are per guarantor");
    }

    function test_submitClaim_acceptsRequestAtAdvanceLimit() public {
        Params memory p = defaultParams();
        p.advanceRateBps = 8_000;
        _setParams(p);
        uint256 id = _submit(FACE, 800e18);
        assertEq(_claim(id).requestedAmount, 800e18);
    }

    function test_submitClaim_acceptsRequestAtPerClaimCap() public {
        uint256 id = _submit(3_000e18, PER_CLAIM_CAP);
        assertEq(_claim(id).requestedAmount, PER_CLAIM_CAP);
    }

    function test_submitClaim_acceptsAtDeadline() public {
        SubmitClaimParams memory p = _member(FACE, FACE);
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        bytes memory sig = _sign(guarantorKey, claimant, p, 0, deadline);
        vm.warp(deadline);
        vm.prank(claimant);
        registry.submitClaim(p, deadline, sig);
    }

    function test_submitClaim_acceptsErc1271Guarantor() public {
        (address safeOwner, uint256 safeOwnerKey) = makeAddrAndKey("safeOwner");
        MockERC1271Wallet wallet = new MockERC1271Wallet(safeOwner);
        vm.prank(admin);
        orgs.setOfficer(orgId, address(wallet), true);

        SubmitClaimParams memory p = _params(orgId, RecipientType.Member, address(wallet), FACE, FACE);
        uint256 id = _submitWith(claimant, p, safeOwnerKey);
        assertEq(_claim(id).guarantor, address(wallet));
    }

    // ---------------------------------------------------------------- reverts

    function test_submitClaim_revertsWhenPaused() public {
        vm.prank(pauser);
        registry.pause();
        SubmitClaimParams memory p = _member(FACE, FACE);
        _submitExpectRevert(
            claimant, p, _validSig(claimant, p), abi.encodeWithSelector(Pausable.EnforcedPause.selector)
        );
    }

    function test_submitClaim_revertsWhenOrgInactive() public {
        vm.prank(admin);
        orgs.setOrgActive(orgId, false);
        SubmitClaimParams memory p = _member(FACE, FACE);
        _submitExpectRevert(claimant, p, _validSig(claimant, p), abi.encodeWithSelector(OrgInactive.selector, orgId));
    }

    function test_submitClaim_revertsForUnknownOrg() public {
        SubmitClaimParams memory p = _params(99, RecipientType.Member, guarantor, FACE, FACE);
        _submitExpectRevert(
            claimant, p, _validSig(claimant, p), abi.encodeWithSelector(OrgInactive.selector, uint64(99))
        );
    }

    function test_submitClaim_revertsWhenGuarantorIsRecipient() public {
        SubmitClaimParams memory p = _params(orgId, RecipientType.OrgTreasurer, guarantor, FACE, FACE);
        _submitExpectRevert(
            guarantor, p, _validSig(guarantor, p), abi.encodeWithSelector(GuarantorIsRecipient.selector)
        );
    }

    function test_submitClaim_revertsWhenGuarantorNotOfficer() public {
        SubmitClaimParams memory p = _params(orgId, RecipientType.Member, outsider, FACE, FACE);
        _submitExpectRevert(
            claimant, p, _validSig(claimant, p), abi.encodeWithSelector(NotOfficer.selector, orgId, outsider)
        );
    }

    function test_submitClaim_revertsWhenGuarantorIsOfficerOfAnotherOrg() public {
        SubmitClaimParams memory p = _params(org2Id, RecipientType.Member, guarantor, FACE, FACE);
        _submitExpectRevert(
            claimant, p, _validSig(claimant, p), abi.encodeWithSelector(NotOfficer.selector, org2Id, guarantor)
        );
    }

    function test_submitClaim_revertsWhenGuarantorDeactivated() public {
        vm.prank(admin);
        orgs.setOfficer(orgId, guarantor, false);
        SubmitClaimParams memory p = _member(FACE, FACE);
        _submitExpectRevert(
            claimant, p, _validSig(claimant, p), abi.encodeWithSelector(NotOfficer.selector, orgId, guarantor)
        );
    }

    function test_submitClaim_revertsWhenTreasurerNotOfficer() public {
        SubmitClaimParams memory p = _params(orgId, RecipientType.OrgTreasurer, guarantor, FACE, FACE);
        _submitExpectRevert(
            claimant, p, _validSig(claimant, p), abi.encodeWithSelector(NotOfficer.selector, orgId, claimant)
        );
    }

    function test_submitClaim_revertsOnZeroAmount() public {
        SubmitClaimParams memory p = _member(FACE, 0);
        _submitExpectRevert(claimant, p, _validSig(claimant, p), abi.encodeWithSelector(ZeroAmount.selector));
    }

    function test_submitClaim_revertsAboveAdvanceRate() public {
        Params memory params_ = defaultParams();
        params_.advanceRateBps = 8_000;
        _setParams(params_);
        SubmitClaimParams memory p = _member(FACE, 800e18 + 1);
        _submitExpectRevert(
            claimant,
            p,
            _validSig(claimant, p),
            abi.encodeWithSelector(AmountExceedsLimit.selector, 800e18 + 1, 800e18)
        );
    }

    function test_submitClaim_revertsAboveFaceValue() public {
        SubmitClaimParams memory p = _member(FACE, FACE + 1);
        _submitExpectRevert(
            claimant, p, _validSig(claimant, p), abi.encodeWithSelector(AmountExceedsLimit.selector, FACE + 1, FACE)
        );
    }

    function test_submitClaim_revertsAbovePerClaimCap() public {
        SubmitClaimParams memory p = _member(5_000e18, PER_CLAIM_CAP + 1);
        _submitExpectRevert(
            claimant,
            p,
            _validSig(claimant, p),
            abi.encodeWithSelector(AmountExceedsLimit.selector, PER_CLAIM_CAP + 1, PER_CLAIM_CAP)
        );
    }

    function test_submitClaim_revertsOnZeroPacketHash() public {
        SubmitClaimParams memory p = _member(FACE, FACE);
        p.packetHash = bytes32(0);
        _submitExpectRevert(claimant, p, _validSig(claimant, p), abi.encodeWithSelector(ZeroPacketHash.selector));
    }

    function test_submitClaim_revertsOnReusedPacketHash() public {
        SubmitClaimParams memory p = _member(FACE, FACE);
        _submitWith(claimant, p, guarantorKey);
        _submitExpectRevert(
            claimant, p, _validSig(claimant, p), abi.encodeWithSelector(PacketAlreadyUsed.selector, p.packetHash)
        );
    }

    function test_submitClaim_revertsOnPacketReusedAfterCancel() public {
        SubmitClaimParams memory p = _member(FACE, FACE);
        uint256 id = _submitWith(claimant, p, guarantorKey);
        vm.prank(claimant);
        registry.cancelClaim(id);
        _submitExpectRevert(
            claimant, p, _validSig(claimant, p), abi.encodeWithSelector(PacketAlreadyUsed.selector, p.packetHash)
        );
    }

    function test_submitClaim_revertsWhenGuarantyExpired() public {
        SubmitClaimParams memory p = _member(FACE, FACE);
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;
        bytes memory sig = _sign(guarantorKey, claimant, p, 0, deadline);
        vm.warp(deadline + 1);
        vm.prank(claimant);
        vm.expectRevert(GuarantyExpired.selector);
        registry.submitClaim(p, deadline, sig);
    }

    function test_submitClaim_revertsOnWrongSigner() public {
        SubmitClaimParams memory p = _member(FACE, FACE);
        bytes memory sig = _sign(guarantor2Key, claimant, p, 0, _deadline());
        _submitExpectRevert(claimant, p, sig, abi.encodeWithSelector(InvalidGuaranty.selector));
    }

    function test_submitClaim_revertsOnTamperedTerms() public {
        SubmitClaimParams memory p = _member(FACE, 500e18);
        bytes memory sig = _validSig(claimant, p);
        p.requestedAmount = 900e18;
        _submitExpectRevert(claimant, p, sig, abi.encodeWithSelector(InvalidGuaranty.selector));
    }

    function test_submitClaim_revertsWhenSubmittedBySomeoneElse() public {
        SubmitClaimParams memory p = _member(FACE, FACE);
        bytes memory sig = _validSig(claimant, p);
        _submitExpectRevert(outsider, p, sig, abi.encodeWithSelector(InvalidGuaranty.selector));
    }

    function test_submitClaim_revertsOnWrongDeadline() public {
        SubmitClaimParams memory p = _member(FACE, FACE);
        uint256 deadline = _deadline();
        bytes memory sig = _sign(guarantorKey, claimant, p, 0, deadline);
        vm.prank(claimant);
        vm.expectRevert(InvalidGuaranty.selector);
        registry.submitClaim(p, deadline + 1, sig);
    }

    function test_submitClaim_revertsOnStaleNonce() public {
        SubmitClaimParams memory first = _member(FACE, FACE);
        SubmitClaimParams memory second = _member(FACE, FACE);
        // the guarantor signs both at nonce 0, then the first one lands
        bytes memory staleSig = _sign(guarantorKey, claimant, second, 0, _deadline());
        _submitWith(claimant, first, guarantorKey);
        _submitExpectRevert(claimant, second, staleSig, abi.encodeWithSelector(InvalidGuaranty.selector));
    }

    function test_submitClaim_revertsOnMalformedSignature() public {
        SubmitClaimParams memory p = _member(FACE, FACE);
        _submitExpectRevert(claimant, p, hex"1234", abi.encodeWithSelector(InvalidGuaranty.selector));
    }

    function test_submitClaim_revertsOnBadErc1271Signature() public {
        (address safeOwner,) = makeAddrAndKey("safeOwner");
        MockERC1271Wallet wallet = new MockERC1271Wallet(safeOwner);
        vm.prank(admin);
        orgs.setOfficer(orgId, address(wallet), true);
        SubmitClaimParams memory p = _params(orgId, RecipientType.Member, address(wallet), FACE, FACE);
        bytes memory sig = _sign(guarantorKey, claimant, p, 0, _deadline());
        _submitExpectRevert(claimant, p, sig, abi.encodeWithSelector(InvalidGuaranty.selector));
    }

    // ---------------------------------------------------------------- EIP-712

    function test_guarantyDigest_matchesEip712Spec() public view {
        bytes32 packet = keccak256("packet");
        bytes32 structHash = keccak256(
            abi.encode(
                registry.GUARANTY_TYPEHASH(), guarantor, claimant, orgId, FACE, uint128(900e18), packet, 3, 1234
            )
        );
        bytes32 expected = keccak256(abi.encodePacked("\x19\x01", registry.domainSeparator(), structHash));
        assertEq(registry.guarantyDigest(guarantor, claimant, orgId, FACE, 900e18, packet, 3, 1234), expected);
    }

    function test_guarantyDigest_typehashMatchesSystemDesign() public view {
        assertEq(
            registry.GUARANTY_TYPEHASH(),
            keccak256(
                "Guaranty(address guarantor,address recipient,uint64 orgId,uint128 faceValue,uint128 requestedAmount,bytes32 packetHash,uint256 nonce,uint256 deadline)"
            )
        );
    }

    function test_domainSeparator_bindsNameVersionChainAndRegistry() public {
        bytes32 expected = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256("FraxCollegeClaimRegistry"),
                keccak256("1"),
                block.chainid,
                address(registry)
            )
        );
        assertEq(registry.domainSeparator(), expected);

        (, string memory name, string memory version, uint256 chainId, address verifying,,) = registry.eip712Domain();
        assertEq(name, "FraxCollegeClaimRegistry");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifying, address(registry));

        vm.chainId(2523);
        assertTrue(registry.domainSeparator() != expected, "a guaranty signed for one chain is invalid on another");
    }

    function test_submitClaim_revertsOnSignatureFromAnotherChain() public {
        SubmitClaimParams memory p = _member(FACE, FACE);
        bytes memory sig = _validSig(claimant, p);
        vm.chainId(252);
        _submitExpectRevert(claimant, p, sig, abi.encodeWithSelector(InvalidGuaranty.selector));
    }
}
