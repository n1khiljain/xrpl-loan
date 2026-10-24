// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {MockFrxUSD} from "../../src/mocks/MockFrxUSD.sol";
import {ClaimRegistry} from "../../src/ClaimRegistry.sol";

/// @notice Security campaign E1 (contracts/audits/security-campaign.md): can a config edit put the mintable mock token
/// or misassigned roles on Fraxtal mainnet? Each test asserts the safe behaviour.
contract DeployConfigSecurityTest is Test {
    uint256 internal constant FRAXTAL_MAINNET = 252;
    string internal constant PLACEHOLDER = "SET_AFTER_SAFE_CREATED";
    string[4] internal roleKeys = ["admin", "underwriter", "attester", "emergencyPauser"];

    Deploy internal script;
    address internal deployer = makeAddr("deployer");
    address internal adminSafe = makeAddr("adminSafe");
    address internal underwriterSafe = makeAddr("underwriterSafe");
    address internal attesterSafe = makeAddr("attesterSafe");
    address internal emergencyKey = makeAddr("emergencyKey");

    function setUp() public {
        script = new Deploy();
    }

    function _setRole(string memory json, string memory role, address account) internal pure returns (string memory) {
        string memory current = vm.parseJsonString(json, string.concat(".roles.", role));
        return vm.replace(
            json,
            string.concat('"', role, '": "', current, '"'),
            string.concat('"', role, '": "', vm.toString(account), '"')
        );
    }

    /// @dev Puts code at the three role addresses so they pass the Safe check (E-1i).
    function _etchSafes() internal {
        vm.etch(adminSafe, hex"00");
        vm.etch(underwriterSafe, hex"00");
        vm.etch(attesterSafe, hex"00");
    }

    function _mainnet(address admin, address underwriter, address attester, address pauser)
        internal
        view
        returns (string memory json)
    {
        json = vm.readFile(script.configPath("fraxtal"));
        json = _setRole(json, "admin", admin);
        json = _setRole(json, "underwriter", underwriter);
        json = _setRole(json, "attester", attester);
        json = _setRole(json, "emergencyPauser", pauser);
    }

    /// @notice E-1g (fixed): on chain 252 the script refuses MockFrxUSD whatever the file says. The file has no
    /// `isTestnet` field any more; the script decides from `block.chainid`.
    function test_readConfig_refusesMockFrxUsdOnMainnet() public {
        vm.chainId(FRAXTAL_MAINNET);
        _etchSafes();
        string memory json = _mainnet(adminSafe, underwriterSafe, attesterSafe, emergencyKey);
        json = vm.replace(json, '"frxUSD": "0xfc00000000000000000000000000000000000001"', '"frxUSD": null');
        vm.expectRevert(Deploy.MockOnMainnet.selector);
        script.readConfig(json, deployer);
    }

    /// @notice E-1g (fixed): a stray `isTestnet: true` in the file changes nothing on chain 252.
    function test_readConfig_ignoresIsTestnetInTheFileOnMainnet() public {
        vm.chainId(FRAXTAL_MAINNET);
        _etchSafes();
        string memory json = _mainnet(adminSafe, underwriterSafe, attesterSafe, emergencyKey);
        json = vm.replace(json, '"chainId": 252,', '"chainId": 252, "isTestnet": true,');
        json = vm.replace(json, '"frxUSD": "0xfc00000000000000000000000000000000000001"', '"frxUSD": null');
        vm.expectRevert(Deploy.MockOnMainnet.selector);
        script.readConfig(json, deployer);
    }

    /// @notice E-1h (fixed): one address can't hold admin, underwriter and attester on mainnet (FR-C13).
    function test_readConfig_refusesSameAddressForEveryRoleOnMainnet() public {
        vm.chainId(FRAXTAL_MAINNET);
        vm.etch(0xFc00000000000000000000000000000000000001, address(new MockFrxUSD()).code);
        string memory json = _mainnet(adminSafe, adminSafe, adminSafe, adminSafe);
        vm.expectRevert(Deploy.RolesNotDistinct.selector);
        script.readConfig(json, deployer);
    }

    /// @notice E-1i (fixed): admin, underwriter and attester must be contracts (Safes) on mainnet; the pauser may be
    /// a key.
    function test_readConfig_refusesEoaRolesOnMainnet() public {
        vm.chainId(FRAXTAL_MAINNET);
        vm.etch(0xFc00000000000000000000000000000000000001, address(new MockFrxUSD()).code);
        assertEq(adminSafe.code.length, 0, "the admin is a plain key");
        string memory json = _mainnet(adminSafe, underwriterSafe, attesterSafe, emergencyKey);
        vm.expectRevert(abi.encodeWithSelector(Deploy.RoleNotContract.selector, "admin"));
        script.readConfig(json, deployer);
    }

    /// @notice With three distinct Safes and a key as pauser, the mainnet deploy goes through on the real frxUSD.
    function test_deploy_mainnetWithDistinctSafesAndKeyPauser() public {
        vm.chainId(FRAXTAL_MAINNET);
        vm.etch(0xFc00000000000000000000000000000000000001, address(new MockFrxUSD()).code);
        _etchSafes();
        Deploy.Deployment memory d =
            script.deploy(_mainnet(adminSafe, underwriterSafe, attesterSafe, emergencyKey), deployer);
        ClaimRegistry registry = ClaimRegistry(d.claimRegistry);
        assertEq(d.frxUSD, 0xFc00000000000000000000000000000000000001);
        assertTrue(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), adminSafe));
        assertTrue(registry.hasRole(registry.PAUSER_ROLE(), emergencyKey));
        assertFalse(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), deployer));
    }

    /// @notice Regression: the committed mainnet config still refuses to deploy while roles are placeholders.
    function test_readConfig_committedMainnetConfigRefusesPlaceholders() public {
        vm.chainId(FRAXTAL_MAINNET);
        string memory json = vm.readFile(script.configPath("fraxtal"));
        assertEq(vm.parseJsonString(json, ".roles.admin"), PLACEHOLDER);
        vm.expectRevert();
        script.readConfig(json, deployer);
    }
}
