// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {ClaimRegistry} from "../../src/ClaimRegistry.sol";
import {ReceivablesPool} from "../../src/ReceivablesPool.sol";
import {ClaimNFT} from "../../src/ClaimNFT.sol";
import {OrgRegistry} from "../../src/OrgRegistry.sol";
import {MockFrxUSD} from "../../src/mocks/MockFrxUSD.sol";
import {Params} from "../../src/libraries/ClaimTypes.sol";

contract SixDecimalToken is ERC20("Six", "SIX") {
    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

/// @notice The deploy script: config parsing, the local fallbacks, and every refusal (FR-C17, FR-C18, U-40).
contract DeployTest is Test {
    address internal constant FRXUSD = 0xFc00000000000000000000000000000000000001;
    string internal constant PLACEHOLDER = "SET_AFTER_SAFE_CREATED";

    Deploy internal script;
    address internal deployer = makeAddr("deployer");
    address internal adminSafe = makeAddr("adminSafe");
    address internal underwriterSafe = makeAddr("underwriterSafe");
    address internal attesterSafe = makeAddr("attesterSafe");
    address internal emergencyKey = makeAddr("emergencyKey");

    function setUp() public {
        script = new Deploy();
        // outside local the admin, underwriter and attester must be contracts (Safes); the pauser may be a key (E-1i)
        vm.etch(adminSafe, hex"00");
        vm.etch(underwriterSafe, hex"00");
        vm.etch(attesterSafe, hex"00");
    }

    function _config(string memory network) internal view returns (string memory) {
        return vm.readFile(script.configPath(network));
    }

    string[4] internal roleKeys = ["admin", "underwriter", "attester", "emergencyPauser"];

    /// @dev A network's config with every role back to the placeholder, so these tests don't depend on whether the
    /// team has filled in the committed file's Safe addresses yet (docs/RUNBOOK.md). fraxtal-testnet also gets
    /// Frax's frxUSD back if the team switched it to null for MockFrxUSD (U-25).
    function _template(string memory network) internal view returns (string memory json) {
        json = _config(network);
        if (keccak256(bytes(network)) == keccak256("fraxtal-testnet")) {
            json = vm.replace(json, '"frxUSD": null', string.concat('"frxUSD": "', vm.toString(FRXUSD), '"'));
        }
        for (uint256 i; i < roleKeys.length; ++i) {
            string memory current = vm.parseJsonString(json, string.concat(".roles.", roleKeys[i]));
            json = vm.replace(
                json,
                string.concat('"', roleKeys[i], '": "', current, '"'),
                string.concat('"', roleKeys[i], '": "', PLACEHOLDER, '"')
            );
        }
    }

    /// @dev The first role still set to the placeholder, in the order `readConfig` checks them, or "" if none.
    function _firstPlaceholder(string memory json) internal view returns (string memory) {
        for (uint256 i; i < roleKeys.length; ++i) {
            string memory value = vm.parseJsonString(json, string.concat(".roles.", roleKeys[i]));
            if (keccak256(bytes(value)) == keccak256(bytes(PLACEHOLDER))) return roleKeys[i];
        }
        return "";
    }

    function _setRole(string memory json, string memory role, address account) internal pure returns (string memory) {
        return vm.replace(
            json,
            string.concat('"', role, '": "', PLACEHOLDER, '"'),
            string.concat('"', role, '": "', vm.toString(account), '"')
        );
    }

    function _withSafes(string memory json) internal view returns (string memory) {
        json = _setRole(json, "admin", adminSafe);
        json = _setRole(json, "underwriter", underwriterSafe);
        json = _setRole(json, "attester", attesterSafe);
        return _setRole(json, "emergencyPauser", emergencyKey);
    }

    /// @dev Puts a contract with 18 decimals at the frxUSD predeploy address and switches to that chain.
    function _onChainWithFrxUSD(uint256 chainId) internal {
        vm.chainId(chainId);
        vm.etch(FRXUSD, address(new MockFrxUSD()).code);
    }

    // ---------------------------------------------------------------- local

    function test_deploy_localWiresEverythingFromConfig() public {
        Deploy.Deployment memory d = script.deploy(_config("local"), deployer);

        ClaimRegistry registry = ClaimRegistry(d.claimRegistry);
        ReceivablesPool pool = ReceivablesPool(d.pool);
        ClaimNFT nft = ClaimNFT(d.claimNft);
        OrgRegistry orgs = OrgRegistry(d.orgRegistry);

        // mock deployed because local.json sets frxUSD to null
        assertEq(MockFrxUSD(d.frxUSD).symbol(), "frxUSD");
        assertEq(MockFrxUSD(d.frxUSD).decimals(), 18);
        assertEq(pool.asset(), d.frxUSD);

        // wiring
        assertEq(pool.registry(), d.claimRegistry);
        assertEq(nft.registry(), d.claimRegistry);
        assertEq(address(registry.pool()), d.pool);
        assertEq(address(registry.nft()), d.claimNft);
        assertEq(address(registry.orgs()), d.orgRegistry);
        assertEq(nft.baseURI(), "http://127.0.0.1:54321/functions/v1/nft-metadata/");

        // PRD section 6 terms
        Params memory p = registry.params();
        assertEq(p.advanceRateBps, 10_000);
        assertEq(p.feeBps, 0);
        assertEq(p.perClaimCap, 2_500e18);
        assertEq(p.perOrgCap, 10_000e18);
        assertEq(p.overdueWindow, 180 days);
        assertEq(p.approvalExpiry, 14 days);
        assertEq(p.writeOffGrace, 60 days);
        assertEq(pool.depositCap(), 50_000e18);
        assertTrue(pool.allowlistEnabled());

        // placeholder roles fall back to the deployer on local, and nothing is renounced
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), deployer));
        assertTrue(registry.hasRole(registry.UNDERWRITER_ROLE(), deployer));
        assertTrue(registry.hasRole(registry.ATTESTER_ROLE(), deployer));
        assertTrue(registry.hasRole(registry.PAUSER_ROLE(), deployer));
        assertTrue(pool.hasRole(pool.DEFAULT_ADMIN_ROLE(), deployer));
        assertTrue(nft.hasRole(nft.DEFAULT_ADMIN_ROLE(), deployer));
        assertTrue(orgs.hasRole(orgs.DEFAULT_ADMIN_ROLE(), deployer));
        assertEq(d.blockNumber, block.number);
    }

    function test_deploy_localHonorsRealRoleAddresses() public {
        Deploy.Deployment memory d = script.deploy(_withSafes(_config("local")), deployer);
        ClaimRegistry registry = ClaimRegistry(d.claimRegistry);
        assertTrue(registry.hasRole(registry.UNDERWRITER_ROLE(), underwriterSafe));
        assertTrue(registry.hasRole(registry.ATTESTER_ROLE(), attesterSafe));
        assertTrue(registry.hasRole(registry.PAUSER_ROLE(), adminSafe));
        assertTrue(registry.hasRole(registry.PAUSER_ROLE(), emergencyKey));
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), adminSafe));
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), deployer), "local keeps the deployer as admin");
    }

    function test_deploy_revertsOnChainIdMismatch() public {
        string memory json = _config("local");
        vm.chainId(2523);
        vm.expectRevert(abi.encodeWithSelector(Deploy.ChainIdMismatch.selector, 31_337, 2523));
        script.deploy(json, deployer);
    }

    // ---------------------------------------------------------------- placeholder roles (U-40)

    function test_readConfig_revertsOnPlaceholderRoleOnFraxtalTestnet() public {
        string memory json = _template("fraxtal-testnet");
        _onChainWithFrxUSD(2523);
        vm.expectRevert(abi.encodeWithSelector(Deploy.RoleNotSet.selector, "admin"));
        script.deploy(json, deployer);
    }

    function test_readConfig_revertsOnPlaceholderRoleOnSepolia() public {
        string memory json = _template("sepolia");
        vm.chainId(11_155_111);
        vm.expectRevert(abi.encodeWithSelector(Deploy.RoleNotSet.selector, "admin"));
        script.readConfig(json, deployer);
    }

    function test_readConfig_revertsOnPlaceholderRoleOnFraxtal() public {
        string memory json = _template("fraxtal");
        _onChainWithFrxUSD(252);
        vm.expectRevert(abi.encodeWithSelector(Deploy.RoleNotSet.selector, "admin"));
        script.readConfig(json, deployer);
    }

    function test_readConfig_fraxtalTestnetRefusesEachRoleLeftAsPlaceholder() public {
        _onChainWithFrxUSD(2523);
        address[4] memory holders = [adminSafe, underwriterSafe, attesterSafe, emergencyKey];
        for (uint256 i; i < roleKeys.length; ++i) {
            string memory json = _template("fraxtal-testnet");
            for (uint256 j; j < roleKeys.length; ++j) {
                if (j != i) json = _setRole(json, roleKeys[j], holders[j]);
            }
            vm.expectRevert(abi.encodeWithSelector(Deploy.RoleNotSet.selector, roleKeys[i]));
            script.readConfig(json, deployer);
        }
    }

    /// @dev Phase 4 goal item 3, against the committed file: while any role in deployments/fraxtal-testnet.json is
    /// still the placeholder, the script refuses before deploying anything. Skipped once every role is filled in.
    function test_runFor_fraxtalTestnetRefusesWhileCommittedConfigHasPlaceholder() public {
        string memory missing = _firstPlaceholder(_config("fraxtal-testnet"));
        vm.skip(bytes(missing).length == 0);
        _onChainWithFrxUSD(2523);
        vm.expectRevert(abi.encodeWithSelector(Deploy.RoleNotSet.selector, missing));
        script.runFor("fraxtal-testnet");
    }

    function test_readConfig_revertsOnAnySinglePlaceholderRole() public {
        _onChainWithFrxUSD(2523);
        string memory json = _template("fraxtal-testnet");
        json = _setRole(json, "admin", adminSafe);
        json = _setRole(json, "underwriter", underwriterSafe);
        json = _setRole(json, "attester", attesterSafe);
        vm.expectRevert(abi.encodeWithSelector(Deploy.RoleNotSet.selector, "emergencyPauser"));
        script.readConfig(json, deployer);
    }

    function test_readConfig_revertsOnZeroRoleAddress() public {
        _onChainWithFrxUSD(2523);
        string memory json = _template("fraxtal-testnet");
        json = _setRole(json, "admin", adminSafe);
        json = _setRole(json, "underwriter", underwriterSafe);
        json = _setRole(json, "attester", address(0));
        vm.expectRevert(abi.encodeWithSelector(Deploy.RoleNotSet.selector, "attester"));
        script.readConfig(json, deployer);
    }

    // ---------------------------------------------------------------- frxUSD (FR-C18)

    function test_readConfig_revertsOnMockOnMainnet() public {
        vm.chainId(252);
        string memory json = vm.replace(
            _withSafes(_template("fraxtal")),
            '"frxUSD": "0xfc00000000000000000000000000000000000001"',
            '"frxUSD": null'
        );
        vm.expectRevert(Deploy.MockOnMainnet.selector);
        script.readConfig(json, deployer);
    }

    function test_readConfig_revertsOnAssetWithoutCode() public {
        string memory json = _withSafes(_template("fraxtal-testnet"));
        vm.chainId(2523);
        vm.expectRevert(abi.encodeWithSelector(Deploy.InvalidAsset.selector, FRXUSD));
        script.readConfig(json, deployer);
    }

    function test_readConfig_revertsOnAssetWithWrongDecimals() public {
        string memory json = _withSafes(_template("fraxtal-testnet"));
        vm.chainId(2523);
        vm.etch(FRXUSD, address(new SixDecimalToken()).code);
        vm.expectRevert(abi.encodeWithSelector(Deploy.InvalidAsset.selector, FRXUSD));
        script.readConfig(json, deployer);
    }

    function test_deploy_sepoliaDeploysMockOnTestnet() public {
        vm.chainId(11_155_111);
        Deploy.Deployment memory d = script.deploy(_withSafes(_template("sepolia")), deployer);
        assertTrue(d.frxUSD != FRXUSD);
        assertEq(MockFrxUSD(d.frxUSD).name(), "Mock frxUSD");
    }

    function test_deploy_usesConfiguredFrxUSD() public {
        _onChainWithFrxUSD(2523);
        Deploy.Deployment memory d = script.deploy(_withSafes(_template("fraxtal-testnet")), deployer);
        assertEq(d.frxUSD, FRXUSD, "no mock when the config names frxUSD");
        assertEq(ReceivablesPool(d.pool).asset(), FRXUSD);
    }

    // ---------------------------------------------------------------- non-local role handoff

    function test_deploy_nonLocalHandsRolesToSafesAndRenounces() public {
        _onChainWithFrxUSD(2523);
        Deploy.Deployment memory d = script.deploy(_withSafes(_template("fraxtal-testnet")), deployer);
        ClaimRegistry registry = ClaimRegistry(d.claimRegistry);
        ReceivablesPool pool = ReceivablesPool(d.pool);
        ClaimNFT nft = ClaimNFT(d.claimNft);
        OrgRegistry orgs = OrgRegistry(d.orgRegistry);
        bytes32 adminRole = registry.DEFAULT_ADMIN_ROLE();

        assertTrue(registry.hasRole(adminRole, adminSafe));
        assertTrue(registry.hasRole(registry.UNDERWRITER_ROLE(), underwriterSafe));
        assertTrue(registry.hasRole(registry.ATTESTER_ROLE(), attesterSafe));
        assertTrue(registry.hasRole(registry.PAUSER_ROLE(), adminSafe), "admin Safe can pause");
        assertTrue(registry.hasRole(registry.PAUSER_ROLE(), emergencyKey), "emergency key can pause");
        assertFalse(registry.hasRole(adminRole, emergencyKey), "emergency key cannot unpause");
        assertTrue(pool.hasRole(adminRole, adminSafe));
        assertTrue(nft.hasRole(adminRole, adminSafe));
        assertTrue(orgs.hasRole(adminRole, adminSafe));

        assertFalse(registry.hasRole(adminRole, deployer));
        assertFalse(pool.hasRole(adminRole, deployer));
        assertFalse(nft.hasRole(adminRole, deployer));
        assertFalse(orgs.hasRole(adminRole, deployer));
        assertEq(nft.baseURI(), "", "null nftBaseUri skips setBaseURI (U-41)");
    }

    function test_readConfig_nonLocalRefusesOneAddressForSeveralRoles() public {
        _onChainWithFrxUSD(2523);
        string memory json = _template("fraxtal-testnet");
        json = _setRole(json, "admin", adminSafe);
        json = _setRole(json, "underwriter", adminSafe);
        json = _setRole(json, "attester", attesterSafe);
        json = _setRole(json, "emergencyPauser", emergencyKey);
        vm.expectRevert(Deploy.RolesNotDistinct.selector);
        script.readConfig(json, deployer);
    }

    function test_readConfig_nonLocalRefusesDeployerKeyAsRoles() public {
        _onChainWithFrxUSD(2523);
        string memory json = _template("fraxtal-testnet");
        json = _setRole(json, "admin", deployer);
        json = _setRole(json, "underwriter", underwriterSafe);
        json = _setRole(json, "attester", attesterSafe);
        json = _setRole(json, "emergencyPauser", emergencyKey);
        vm.expectRevert(abi.encodeWithSelector(Deploy.RoleNotContract.selector, "admin"));
        script.readConfig(json, deployer);
    }

    function test_readConfig_nonLocalRefusesEachRoleWithoutCode() public {
        _onChainWithFrxUSD(2523);
        string memory json = _withSafes(_template("fraxtal-testnet"));
        address[3] memory safes = [adminSafe, underwriterSafe, attesterSafe];
        for (uint256 i; i < 3; ++i) {
            vm.etch(safes[i], "");
            vm.expectRevert(abi.encodeWithSelector(Deploy.RoleNotContract.selector, roleKeys[i]));
            script.readConfig(json, deployer);
            vm.etch(safes[i], hex"00");
        }
    }

    function test_deploy_nonLocalRenouncesPauserWhenOnlyEmergencyKeyIsDeployer() public {
        _onChainWithFrxUSD(2523);
        string memory json = _withSafes(_template("fraxtal-testnet"));
        json = vm.replace(
            json,
            string.concat('"emergencyPauser": "', vm.toString(emergencyKey), '"'),
            string.concat('"emergencyPauser": "', vm.toString(deployer), '"')
        );
        Deploy.Deployment memory d = script.deploy(json, deployer);
        ClaimRegistry registry = ClaimRegistry(d.claimRegistry);
        assertTrue(registry.hasRole(registry.PAUSER_ROLE(), deployer), "deployer is the configured emergency pauser");
        assertFalse(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), deployer));
    }

    // ---------------------------------------------------------------- run()

    function test_run_localDryRunDoesNotWriteConfig() public {
        string memory before = _config("local");
        vm.setEnv("NETWORK", "local");
        Deploy.Deployment memory d = script.run();
        assertTrue(d.claimRegistry != address(0));
        assertEq(_config("local"), before, "only a broadcast writes addresses back");
    }

    function test_runFor_revertsOnNetworkMismatch() public {
        string memory path = script.configPath("deploy-test-mismatch");
        vm.writeFile(path, _config("local"));
        vm.expectRevert(abi.encodeWithSelector(Deploy.NetworkMismatch.selector, "deploy-test-mismatch", "local"));
        script.runFor("deploy-test-mismatch");
        vm.removeFile(path);
    }

    function test_runFor_nonLocalUsesCommandLineWalletAndRefusesPlaceholders() public {
        vm.chainId(11_155_111);
        string memory missing = _firstPlaceholder(_config("sepolia"));
        vm.skip(bytes(missing).length == 0);
        vm.expectRevert(abi.encodeWithSelector(Deploy.RoleNotSet.selector, missing));
        script.runFor("sepolia");
    }

    function test_configPath_pointsAtDeploymentsDir() public view {
        assertEq(script.configPath("local"), string.concat(vm.projectRoot(), "/../deployments/local.json"));
    }
}
