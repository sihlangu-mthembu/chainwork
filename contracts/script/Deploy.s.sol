// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ChainworkEscrow} from "../src/ChainworkEscrow.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";
import {BudgetGuardHook} from "../src/BudgetGuardHook.sol";
import {AgentAccount} from "../src/AgentAccount.sol";
import {HashVerifier} from "../src/verifiers/HashVerifier.sol";
import {SignedDataVerifier} from "../src/verifiers/SignedDataVerifier.sol";

/// @notice Shared deployment of the Chainwork contracts against a given tUSD8 address.
abstract contract DeployCore is Script {
    struct Deployed {
        address token;
        address reputation;
        address escrow;
        address budgetGuard;
        address hashVerifier;
        address signedDataVerifier;
        address clientAccount;
    }

    function _deployCore(address token, address accountOwner) internal returns (Deployed memory d) {
        d.token = token;
        ReputationRegistry rep = new ReputationRegistry();
        ChainworkEscrow escrow = new ChainworkEscrow(token, address(rep));
        rep.setEscrow(address(escrow));
        BudgetGuardHook guard = new BudgetGuardHook(address(escrow));
        d.reputation = address(rep);
        d.escrow = address(escrow);
        d.budgetGuard = address(guard);
        d.hashVerifier = address(new HashVerifier());
        d.signedDataVerifier = address(new SignedDataVerifier(address(escrow)));
        if (accountOwner != address(0)) {
            d.clientAccount = address(new AgentAccount(accountOwner, address(escrow), address(guard), token));
        }
    }

    function _write(string memory path, Deployed memory d) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployedAtBlock", block.number);
        vm.serializeAddress(k, "token", d.token);
        vm.serializeAddress(k, "reputation", d.reputation);
        vm.serializeAddress(k, "escrow", d.escrow);
        vm.serializeAddress(k, "budgetGuard", d.budgetGuard);
        vm.serializeAddress(k, "hashVerifier", d.hashVerifier);
        vm.serializeAddress(k, "signedDataVerifier", d.signedDataVerifier);
        string memory json = vm.serializeAddress(k, "clientAccount", d.clientAccount);
        vm.writeJson(json, path);
        console2.log("escrow", d.escrow);
        console2.log("reputation", d.reputation);
        console2.log("budgetGuard", d.budgetGuard);
        console2.log("clientAccount", d.clientAccount);
        console2.log("written", path);
    }
}

/// @notice Aevum testnet (chain 44005) against the real tUSD8.
/// forge script contracts/script/Deploy.s.sol:DeployAevum --rpc-url aevum --broadcast --legacy \
///   --account chainwork-deployer   (encrypted keystore; never a raw key on the command line)
/// Env: ACCOUNT_OWNER = human owner of the client AgentAccount.
contract DeployAevum is DeployCore {
    address constant TUSD8 = 0x456569838f1d43009A91ebA4263147Afd7233483;

    function run() external {
        require(block.chainid == 44005, "not Aevum testnet");
        address owner = vm.envAddress("ACCOUNT_OWNER");
        vm.startBroadcast();
        Deployed memory d = _deployCore(TUSD8, owner);
        vm.stopBroadcast();
        _write("deployments/aevum.json", d);
    }
}

/// Admin surface of Circle's FiatToken V2.2 (local chain only).
interface IFiatTokenAdmin {
    function initialize(string memory, string memory, string memory, uint8, address, address, address, address)
        external;
    function initializeV2(string calldata) external;
    function initializeV2_1(address) external;
    function initializeV2_2(address[] calldata, string calldata) external;
    function configureMinter(address, uint256) external returns (bool);
    function mint(address, uint256) external returns (bool);
}

/// @notice Local anvil chain: deploys a real FiatToken V2.2 as "tUSD8", the Chainwork contracts,
///         and funds anvil's default accounts (except the coordinator, which stays at 0).
/// anvil &   forge script contracts/script/Deploy.s.sol:DeployLocal --rpc-url http://127.0.0.1:8545 --broadcast
/// Roles use anvil's default mnemonic accounts: 0 deployer/relayer, 1 client, 2 coordinator,
/// 3 specialist-data, 4 specialist-bad, 5 backup, 6 watcher, 7 evaluator.
contract DeployLocal is DeployCore {
    string constant MNEMONIC = "test test test test test test test test test test test junk";

    function run() external {
        uint256 deployerPk = vm.deriveKey(MNEMONIC, 0);
        address deployer = vm.addr(deployerPk);
        vm.startBroadcast(deployerPk);
        address token = _deployFiatToken(deployer);
        Deployed memory d = _deployCore(token, vm.addr(vm.deriveKey(MNEMONIC, 1)));
        // Fund everyone except the coordinator (index 2): it starts at 0 tUSD8 on purpose.
        uint32[6] memory funded = [uint32(1), 3, 4, 5, 6, 7];
        for (uint256 i = 0; i < funded.length; i++) {
            IFiatTokenAdmin(token).mint(vm.addr(vm.deriveKey(MNEMONIC, funded[i])), 5_000_000);
        }
        IFiatTokenAdmin(token).mint(d.clientAccount, 2_000_000);
        IFiatTokenAdmin(token).mint(deployer, 10_000_000);
        vm.stopBroadcast();
        _write("deployments/local.json", d);
    }

    /// Deploys Circle's SignatureChecker library, links it into FiatToken V2.2, deploys and initializes.
    function _deployFiatToken(address admin) internal returns (address token) {
        string memory fx = vm.readFile("contracts/test/fixtures/FiatTokenV2_2.json");
        bytes memory libCreation = vm.parseJsonBytes(fx, "._linkedLibrary.creation");
        address lib;
        assembly {
            lib := create(0, add(libCreation, 0x20), mload(libCreation))
        }
        require(lib != address(0), "lib deploy failed");
        bytes memory code = vm.parseJsonBytes(fx, ".bytecode.object");
        _link(code, address(0x0C4ECC), lib);
        assembly {
            token := create(0, add(code, 0x20), mload(code))
        }
        require(token != address(0), "token deploy failed");
        IFiatTokenAdmin a = IFiatTokenAdmin(token);
        a.initialize("tUSD8", "tUSD8", "USD", 6, admin, admin, admin, admin);
        a.initializeV2("tUSD8");
        a.initializeV2_1(address(0xdead));
        a.initializeV2_2(new address[](0), "tUSD8");
        a.configureMinter(admin, type(uint128).max);
    }

    /// Replaces every 20-byte occurrence of `from` with `to` in `code` (in place).
    function _link(bytes memory code, address from, address to) internal pure {
        bytes20 f = bytes20(from);
        bytes20 t = bytes20(to);
        for (uint256 i = 0; i + 20 <= code.length; i++) {
            bool hit = true;
            for (uint256 j = 0; j < 20; j++) {
                if (code[i + j] != f[j]) {
                    hit = false;
                    break;
                }
            }
            if (hit) {
                for (uint256 j = 0; j < 20; j++) {
                    code[i + j] = t[j];
                }
                i += 19;
            }
        }
    }
}
