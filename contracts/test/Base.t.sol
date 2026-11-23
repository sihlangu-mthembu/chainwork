// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ChainworkEscrow} from "../src/ChainworkEscrow.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";
import {BudgetGuardHook} from "../src/BudgetGuardHook.sol";
import {HashVerifier} from "../src/verifiers/HashVerifier.sol";
import {SignedDataVerifier} from "../src/verifiers/SignedDataVerifier.sol";
import {IChainworkEscrow} from "@chainwork/interfaces/IChainworkEscrow.sol";
import {IERC8183} from "@chainwork/interfaces/IERC8183.sol";
import {IFiatTokenV2_2} from "@chainwork/interfaces/IFiatTokenV2_2.sol";

/// Admin surface of Circle's FiatToken V2.2, used only to set up the test token.
interface IFiatTokenAdmin {
    function initialize(
        string memory tokenName,
        string memory tokenSymbol,
        string memory tokenCurrency,
        uint8 tokenDecimals,
        address newMasterMinter,
        address newPauser,
        address newBlacklister,
        address newOwner
    ) external;
    function initializeV2(string calldata newName) external;
    function initializeV2_1(address lostAndFound) external;
    function initializeV2_2(address[] calldata accountsToBlacklist, string calldata newSymbol) external;
    function configureMinter(address minter, uint256 minterAllowedAmount) external returns (bool);
    function mint(address to, uint256 amount) external returns (bool);
}

/// @notice Shared fixture: the real Circle FiatToken V2.2 bytecode (same logic as tUSD8 on Aevum),
///         the Chainwork contracts, and helpers to sign EIP-3009 and EIP-2612 messages.
abstract contract BaseTest is Test {
    bytes32 internal constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    uint256 internal constant CENT = 10_000; // 0.01 tUSD8

    IFiatTokenV2_2 internal token;
    ChainworkEscrow internal escrow;
    ReputationRegistry internal rep;
    BudgetGuardHook internal guard;
    HashVerifier internal hashVerifier;
    SignedDataVerifier internal signedVerifier;

    uint256 internal clientPk = 0xC11E;
    uint256 internal coordPk = 0xC00D;
    uint256 internal dataPk = 0xDA7A;
    uint256 internal badPk = 0xBAD;
    uint256 internal backupPk = 0xBAC0;
    uint256 internal watcherPk = 0x3A7C;
    uint256 internal oraclePk = 0x0AC1E;

    address internal client;
    address internal coord;
    address internal dataAgent;
    address internal badAgent;
    address internal backup;
    address internal watcher;
    address internal oracle;
    address internal evaluator = makeAddr("evaluator");
    address internal relayer = makeAddr("relayer");
    address internal seedClient = makeAddr("seedClient");

    function setUp() public virtual {
        vm.warp(1_764_000_000);
        client = vm.addr(clientPk);
        coord = vm.addr(coordPk);
        dataAgent = vm.addr(dataPk);
        badAgent = vm.addr(badPk);
        backup = vm.addr(backupPk);
        watcher = vm.addr(watcherPk);
        oracle = vm.addr(oraclePk);

        // Circle's FiatToken links an external SignatureChecker library; the fixture is pre-linked
        // to this fixed address, so plant the library's runtime code there first.
        string memory fx = vm.readFile("contracts/test/fixtures/FiatTokenV2_2.json");
        vm.etch(address(0x0C4ECC), vm.parseJsonBytes(fx, "._linkedLibrary.runtime"));
        address t = deployCode("contracts/test/fixtures/FiatTokenV2_2.json");
        IFiatTokenAdmin a = IFiatTokenAdmin(t);
        a.initialize("tUSD8", "tUSD8", "USD", 6, address(this), address(this), address(this), address(this));
        a.initializeV2("tUSD8");
        a.initializeV2_1(address(0xdead));
        a.initializeV2_2(new address[](0), "tUSD8");
        a.configureMinter(address(this), type(uint128).max);
        token = IFiatTokenV2_2(t);

        rep = new ReputationRegistry();
        escrow = new ChainworkEscrow(address(token), address(rep));
        rep.setEscrow(address(escrow));
        guard = new BudgetGuardHook(address(escrow));
        hashVerifier = new HashVerifier();
        signedVerifier = new SignedDataVerifier(address(escrow));

        _mint(client, 5_000_000);
        _mint(badAgent, 1_000_000);
        _mint(backup, 1_000_000);
        _mint(watcher, 1_000_000);
        _mint(dataAgent, 1_000_000);
        _mint(seedClient, 5_000_000);
        // coord deliberately starts with 0 tUSD8
    }

    // ------------------------------------------------------------ helpers

    function _mint(address to, uint256 amount) internal {
        IFiatTokenAdmin(address(token)).mint(to, amount);
    }

    function _terms(address provider, uint256 budget, uint64 window, address verifier, bytes32 spec, address hook)
        internal
        view
        returns (IChainworkEscrow.JobTerms memory t)
    {
        t.provider = provider;
        t.evaluator = evaluator;
        t.verifier = verifier;
        t.hook = hook;
        t.expiredAt = uint64(block.timestamp + 1 hours);
        t.challengeWindow = window;
        t.budget = budget;
        t.verifierSpec = spec;
        t.descriptionHash = keccak256(bytes("job"));
        t.salt = keccak256(abi.encode(provider, budget, block.timestamp, gasleft()));
    }

    function _receiveDigest(address from, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (bytes32)
    {
        bytes32 s = keccak256(abi.encode(RECEIVE_TYPEHASH, from, address(escrow), value, validAfter, validBefore, nonce));
        return keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), s));
    }

    function _signReceive(uint256 pk, IChainworkEscrow.JobTerms memory t) internal view returns (bytes memory) {
        address from = vm.addr(pk);
        bytes32 d = _receiveDigest(from, t.budget, 0, block.timestamp + 10 minutes, escrow.termsHash(from, t));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        return abi.encodePacked(r, s, v);
    }

    function _signPermit(uint256 pk, uint256 value, uint256 deadline) internal view returns (bytes memory) {
        address owner = vm.addr(pk);
        bytes32 s = keccak256(abi.encode(PERMIT_TYPEHASH, owner, address(escrow), value, token.nonces(owner), deadline));
        bytes32 d = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), s));
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(pk, d);
        return abi.encodePacked(r, ss, v);
    }

    /// Fund a root job from `clientPk` through the gasless path, sent by the relayer.
    function _fund(uint256 pk, IChainworkEscrow.JobTerms memory t) internal returns (uint256 id) {
        bytes memory sig = _signReceive(pk, t);
        vm.prank(relayer);
        id = escrow.fundWithAuthorization(vm.addr(pk), t, "job", 0, block.timestamp + 10 minutes, sig);
    }

    function _accept(uint256 pk, uint256 jobId) internal {
        address p = vm.addr(pk);
        uint256 bond = rep.requiredBond(p, escrow.getJob(jobId).budget);
        bytes memory sig = bond > 0 ? _signPermit(pk, bond, block.timestamp + 10 minutes) : bytes("");
        vm.prank(p);
        escrow.acceptJob(jobId, block.timestamp + 10 minutes, sig);
    }

    function _subTerms(address provider, uint256 budget, uint64 window)
        internal
        view
        returns (IChainworkEscrow.SubJobTerms memory t)
    {
        t.provider = provider;
        t.evaluator = evaluator;
        t.expiredAt = uint64(block.timestamp + 30 minutes);
        t.challengeWindow = window;
        t.budget = budget;
    }

    /// Give `pk` an earned reputation: `n` real jobs completed through the escrow with a hash verifier.
    /// The coordinator's earnings are swept away afterwards so it ends at 0 tUSD8.
    function _seedReputation(uint256 pk, uint256 n, uint256 budget) internal {
        address p = vm.addr(pk);
        // A brand-new agent must post 50% bonds on its first jobs; lend it that, sweep it back after.
        vm.prank(seedClient);
        token.transfer(p, budget);
        for (uint256 i = 0; i < n; i++) {
            bytes32 out = keccak256(abi.encode("seed", i));
            IChainworkEscrow.JobTerms memory t = _terms(p, budget, 0, address(hashVerifier), out, address(0));
            t.salt = keccak256(abi.encode("seed-salt", p, i));
            bytes memory sig;
            {
                uint256 seedPk = 0x5EED;
                vm.prank(seedClient);
                token.transfer(vm.addr(seedPk), budget);
                sig = _signReceive(seedPk, t);
                vm.prank(relayer);
                uint256 id = escrow.fundWithAuthorization(vm.addr(seedPk), t, "job", 0, block.timestamp + 10 minutes, sig);
                _accept(pk, id);
                vm.prank(p);
                escrow.submitWithProof(id, out, "");
            }
        }
        uint256 bal = token.balanceOf(p);
        if (bal > 0) {
            vm.prank(p);
            token.transfer(seedClient, bal);
        }
    }

    function _status(uint256 id) internal view returns (IERC8183.JobStatus) {
        return escrow.getJob(id).status;
    }
}
