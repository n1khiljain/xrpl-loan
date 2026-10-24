// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ClaimRegistry} from "../src/ClaimRegistry.sol";
import {ReceivablesPool} from "../src/ReceivablesPool.sol";
import {ClaimNFT} from "../src/ClaimNFT.sol";
import {OrgRegistry} from "../src/OrgRegistry.sol";
import {MockFrxUSD} from "../src/mocks/MockFrxUSD.sol";
import {Params} from "../src/libraries/ClaimTypes.sol";

/// @title Deploy
/// @notice Deploys the contracts for one network from `deployments/$NETWORK.json` and writes the addresses back
/// into its `deployed` block (FR-C17, SYSTEM_DESIGN section 2.7).
/// @dev Usage: `NETWORK=local forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast`.
/// On `local` the deployer is anvil's first default account. Everywhere else it is the wallet passed on the command
/// line (`--account` or `--ledger`). Only local anvil is a supported broadcast target in this phase.
contract Deploy is Script {
    using SafeCast for uint256;

    /// @notice Role value left in a config until the Safe for that role exists.
    string public constant PLACEHOLDER = "SET_AFTER_SAFE_CREATED";

    /// @dev Anvil's default dev mnemonic, printed by anvil on every start. It holds no real funds and is only used
    /// when the config is `local` and the chain is anvil's 31337.
    string internal constant ANVIL_DEV_MNEMONIC = "test test test test test test test test test test test junk";
    uint256 internal constant ANVIL_CHAIN_ID = 31_337;
    /// @dev Fraxtal mainnet. Every other chain is treated as a testnet; the chain decides, never the file (E-1).
    uint256 internal constant FRAXTAL_MAINNET_CHAIN_ID = 252;
    uint8 internal constant FRXUSD_DECIMALS = 18;

    /// @notice Role holders after placeholders are resolved.
    struct Roles {
        address admin;
        address underwriter;
        address attester;
        address emergencyPauser;
    }

    /// @notice Everything the script reads from a network config.
    struct Config {
        string network;
        bool isLocal;
        address frxUSD;
        string nftBaseUri;
        uint256 poolDepositCap;
        bool lenderAllowlistEnabled;
        Roles roles;
        Params params;
    }

    /// @notice Addresses written back into the config's `deployed` block.
    struct Deployment {
        uint256 blockNumber;
        address frxUSD;
        address orgRegistry;
        address claimRegistry;
        address pool;
        address claimNft;
    }

    /// @notice The config's chain ID does not match the connected chain.
    /// @param expected The config's `chainId`.
    /// @param actual `block.chainid`.
    error ChainIdMismatch(uint256 expected, uint256 actual);

    /// @notice The config's `network` does not match `NETWORK`.
    /// @param expected The `NETWORK` env var.
    /// @param actual The config's `network`.
    error NetworkMismatch(string expected, string actual);

    /// @notice A role is still the placeholder, or zero, on a network other than local (U-40).
    /// @param role The role key in the config.
    error RoleNotSet(string role);

    /// @notice The config sets `frxUSD` to null on Fraxtal mainnet (chain 252), which would deploy MockFrxUSD (FR-C18).
    error MockOnMainnet();

    /// @notice Two of admin, underwriter and attester are the same address on a network other than local (FR-C13).
    error RolesNotDistinct();

    /// @notice Admin, underwriter or attester has no code on a network other than local, so it is not a Safe.
    /// @param role The role key in the config.
    error RoleNotContract(string role);

    /// @notice The configured frxUSD address has no code or does not have 18 decimals.
    /// @param asset The configured address.
    error InvalidAsset(address asset);

    /// @notice Reads `deployments/$NETWORK.json`, deploys, and writes the addresses back when broadcasting.
    /// @return d The deployed addresses.
    function run() external returns (Deployment memory d) {
        return runFor(vm.envString("NETWORK"));
    }

    /// @notice `run()` for a named network instead of `NETWORK`. Tests call it so they never share an env var.
    /// @param network Picks `deployments/<network>.json`.
    /// @return d The deployed addresses.
    function runFor(string memory network) public returns (Deployment memory d) {
        string memory path = configPath(network);
        string memory json = vm.readFile(path);
        string memory configured = vm.parseJsonString(json, ".network");
        if (keccak256(bytes(configured)) != keccak256(bytes(network))) revert NetworkMismatch(network, configured);

        d = deploy(json, _deployer(network));

        // a dry run (no --broadcast) must never write addresses that do not exist onchain
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            _writeDeployment(path, d);
        }
    }

    /// @notice Validates a network config and deploys and wires every contract from it.
    /// @param json The network config.
    /// @param deployer The broadcasting account. Holds temporary admin roles during the deploy.
    /// @return d The deployed addresses.
    function deploy(string memory json, address deployer) public returns (Deployment memory d) {
        Config memory cfg = readConfig(json, deployer);
        d.blockNumber = block.number;

        vm.startBroadcast(deployer);

        // UNCERTAIN: U-25
        d.frxUSD = cfg.frxUSD == address(0) ? address(new MockFrxUSD()) : cfg.frxUSD;

        OrgRegistry orgs = new OrgRegistry(deployer);
        ClaimNFT nft = new ClaimNFT(deployer);
        ReceivablesPool pool = new ReceivablesPool(IERC20(d.frxUSD), deployer);
        ClaimRegistry registry = new ClaimRegistry(deployer, pool, nft, orgs, cfg.params);

        pool.setRegistry(address(registry));
        nft.setRegistry(address(registry));
        // UNCERTAIN: U-41
        if (bytes(cfg.nftBaseUri).length != 0) nft.setBaseURI(cfg.nftBaseUri);
        pool.setDepositCap(cfg.poolDepositCap);
        pool.setAllowlistEnabled(cfg.lenderAllowlistEnabled);

        _grantRoles(cfg.roles, registry, pool, nft, orgs);
        if (!cfg.isLocal) _renounceDeployerRoles(cfg.roles, deployer, registry, pool, nft, orgs);

        vm.stopBroadcast();

        d.orgRegistry = address(orgs);
        d.claimRegistry = address(registry);
        d.pool = address(pool);
        d.claimNft = address(nft);
    }

    /// @notice Parses and validates a network config.
    /// @dev Reverts on a chain ID mismatch, a placeholder role outside local, admin/underwriter/attester that are not
    /// three distinct contracts outside local, a null frxUSD on chain 252, or a configured frxUSD without code or with
    /// the wrong decimals. Whether the network is mainnet comes from `block.chainid`, never from the file (E-1).
    /// @param json The network config.
    /// @param deployer The account placeholder roles fall back to on local.
    /// @return cfg The parsed config.
    function readConfig(string memory json, address deployer) public view returns (Config memory cfg) {
        uint256 chainId = vm.parseJsonUint(json, ".chainId");
        if (chainId != block.chainid) revert ChainIdMismatch(chainId, block.chainid);

        cfg.network = vm.parseJsonString(json, ".network");
        cfg.isLocal = keccak256(bytes(cfg.network)) == keccak256("local") && chainId == ANVIL_CHAIN_ID;

        cfg.roles = Roles({
            admin: _role(json, "admin", cfg.isLocal, deployer),
            underwriter: _role(json, "underwriter", cfg.isLocal, deployer),
            attester: _role(json, "attester", cfg.isLocal, deployer),
            emergencyPauser: _role(json, "emergencyPauser", cfg.isLocal, deployer)
        });
        // the pauser may be a plain key so it can act fast; the other three must be separate Safes (E-1h, E-1i)
        if (!cfg.isLocal) _requireSafes(cfg.roles);

        // null parses to a zero word
        cfg.frxUSD = abi.decode(vm.parseJson(json, ".frxUSD"), (address));
        if (cfg.frxUSD == address(0)) {
            if (block.chainid == FRAXTAL_MAINNET_CHAIN_ID) revert MockOnMainnet();
        } else if (cfg.frxUSD.code.length == 0 || IERC20Metadata(cfg.frxUSD).decimals() != FRXUSD_DECIMALS) {
            revert InvalidAsset(cfg.frxUSD);
        }

        bytes memory rawUri = vm.parseJson(json, ".nftBaseUri");
        cfg.nftBaseUri = rawUri.length == 32 ? "" : vm.parseJsonString(json, ".nftBaseUri");

        cfg.poolDepositCap = vm.parseJsonUint(json, ".params.poolDepositCap");
        cfg.lenderAllowlistEnabled = vm.parseJsonBool(json, ".params.lenderAllowlistEnabled");
        cfg.params = Params({
            advanceRateBps: vm.parseJsonUint(json, ".params.advanceRateBps").toUint16(),
            feeBps: vm.parseJsonUint(json, ".params.feeBps").toUint16(),
            perClaimCap: vm.parseJsonUint(json, ".params.perClaimCap").toUint128(),
            perOrgCap: vm.parseJsonUint(json, ".params.perOrgCap").toUint128(),
            overdueWindow: vm.parseJsonUint(json, ".params.overdueWindowSeconds").toUint32(),
            approvalExpiry: vm.parseJsonUint(json, ".params.approvalExpirySeconds").toUint32(),
            writeOffGrace: vm.parseJsonUint(json, ".params.writeOffGraceSeconds").toUint32()
        });
    }

    /// @notice Path of a network's config file.
    /// @param network The network name.
    /// @return The absolute path to `deployments/<network>.json`.
    function configPath(string memory network) public view returns (string memory) {
        return string.concat(vm.projectRoot(), "/../deployments/", network, ".json");
    }

    function _deployer(string memory network) internal returns (address) {
        if (keccak256(bytes(network)) == keccak256("local") && block.chainid == ANVIL_CHAIN_ID) {
            return vm.rememberKey(vm.deriveKey(ANVIL_DEV_MNEMONIC, 0));
        }
        (, address sender,) = vm.readCallers();
        return sender;
    }

    function _role(string memory json, string memory name, bool isLocal, address deployer)
        internal
        pure
        returns (address)
    {
        string memory value = vm.parseJsonString(json, string.concat(".roles.", name));
        if (keccak256(bytes(value)) == keccak256(bytes(PLACEHOLDER))) {
            // UNCERTAIN: U-40 (the PRD's rule: only local falls back to the deployer)
            if (isLocal) return deployer;
            revert RoleNotSet(name);
        }
        address account = vm.parseAddress(value);
        if (account == address(0)) revert RoleNotSet(name);
        return account;
    }

    function _requireSafes(Roles memory r) internal view {
        if (r.admin == r.underwriter || r.admin == r.attester || r.underwriter == r.attester) {
            revert RolesNotDistinct();
        }
        if (r.admin.code.length == 0) revert RoleNotContract("admin");
        if (r.underwriter.code.length == 0) revert RoleNotContract("underwriter");
        if (r.attester.code.length == 0) revert RoleNotContract("attester");
    }

    function _grantRoles(
        Roles memory r,
        ClaimRegistry registry,
        ReceivablesPool pool,
        ClaimNFT nft,
        OrgRegistry orgs
    ) internal {
        bytes32 adminRole = registry.DEFAULT_ADMIN_ROLE();
        registry.grantRole(registry.UNDERWRITER_ROLE(), r.underwriter);
        registry.grantRole(registry.ATTESTER_ROLE(), r.attester);
        registry.grantRole(registry.PAUSER_ROLE(), r.admin);
        registry.grantRole(registry.PAUSER_ROLE(), r.emergencyPauser);
        registry.grantRole(adminRole, r.admin);
        pool.grantRole(adminRole, r.admin);
        nft.grantRole(adminRole, r.admin);
        orgs.grantRole(adminRole, r.admin);
    }

    /// @dev Drops every role the deployer holds that the config did not assign to it.
    function _renounceDeployerRoles(
        Roles memory r,
        address deployer,
        ClaimRegistry registry,
        ReceivablesPool pool,
        ClaimNFT nft,
        OrgRegistry orgs
    ) internal {
        bytes32 adminRole = registry.DEFAULT_ADMIN_ROLE();
        if (r.underwriter != deployer) _renounce(registry, registry.UNDERWRITER_ROLE(), deployer);
        if (r.attester != deployer) _renounce(registry, registry.ATTESTER_ROLE(), deployer);
        if (r.admin != deployer && r.emergencyPauser != deployer) {
            _renounce(registry, registry.PAUSER_ROLE(), deployer);
        }
        if (r.admin != deployer) {
            _renounce(registry, adminRole, deployer);
            _renounce(pool, adminRole, deployer);
            _renounce(nft, adminRole, deployer);
            _renounce(orgs, adminRole, deployer);
        }
    }

    function _renounce(IAccessControl target, bytes32 role, address deployer) internal {
        if (target.hasRole(role, deployer)) target.renounceRole(role, deployer);
    }

    function _writeDeployment(string memory path, Deployment memory d) internal {
        string memory key = "deployed";
        vm.serializeUint(key, "block", d.blockNumber);
        vm.serializeAddress(key, "frxUSD", d.frxUSD);
        vm.serializeAddress(key, "orgRegistry", d.orgRegistry);
        vm.serializeAddress(key, "claimRegistry", d.claimRegistry);
        vm.serializeAddress(key, "pool", d.pool);
        string memory deployed = vm.serializeAddress(key, "claimNft", d.claimNft);
        vm.writeJson(deployed, path, ".deployed");
        vm.writeFile(path, string.concat(vm.readFile(path), "\n"));
    }
}
