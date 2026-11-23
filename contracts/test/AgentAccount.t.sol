// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {AgentAccount} from "../src/AgentAccount.sol";
import {BudgetGuardHook} from "../src/BudgetGuardHook.sol";
import {IAgentAccount} from "@chainwork/interfaces/IAgentAccount.sol";
import {IBudgetGuardHook} from "@chainwork/interfaces/IBudgetGuardHook.sol";
import {IChainworkEscrow} from "@chainwork/interfaces/IChainworkEscrow.sol";
import {IERC8183} from "@chainwork/interfaces/IERC8183.sol";

/// forge test --mc Guard
contract GuardTest is BaseTest {
    function test_perJobPerDayAndFreeze() public {
        vm.prank(client);
        guard.setLimits(uint128(10 * CENT), uint128(15 * CENT));

        IChainworkEscrow.JobTerms memory t = _terms(dataAgent, 11 * CENT, 0, address(0), 0, address(guard));
        bytes memory sig = _signReceive(clientPk, t);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(IBudgetGuardHook.OverPerJob.selector, 11 * CENT, 10 * CENT));
        escrow.fundWithAuthorization(client, t, "job", 0, block.timestamp + 10 minutes, sig);

        _fund(clientPk, _terms(dataAgent, 10 * CENT, 0, address(0), 0, address(guard)));
        assertEq(guard.spentToday(client), 10 * CENT);

        t = _terms(dataAgent, 6 * CENT, 0, address(0), 0, address(guard));
        sig = _signReceive(clientPk, t);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(IBudgetGuardHook.OverPerDay.selector, 10 * CENT, 6 * CENT, 15 * CENT));
        escrow.fundWithAuthorization(client, t, "job", 0, block.timestamp + 10 minutes, sig);

        vm.prank(client);
        guard.setFrozen(true);
        t = _terms(dataAgent, CENT, 0, address(0), 0, address(guard));
        sig = _signReceive(clientPk, t);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(IBudgetGuardHook.ClientFrozen.selector, client));
        escrow.fundWithAuthorization(client, t, "job", 0, block.timestamp + 10 minutes, sig);
    }

    function test_onlyEscrowCanCallHook() public {
        vm.expectRevert(IBudgetGuardHook.OnlyEscrow.selector);
        guard.beforeAction(1, IERC8183.fund.selector, "");
    }
}

/// forge test --mc AgentAccount
contract AgentAccountTest is BaseTest {
    AgentAccount internal acct;
    address internal owner = makeAddr("human-owner");
    uint256 internal sessionPk = 0x5E55;
    address internal sessionKey;

    function setUp() public override {
        super.setUp();
        sessionKey = vm.addr(sessionPk);
        acct = new AgentAccount(owner, address(escrow), address(guard), address(token));
        _mint(address(acct), 1_000_000);
        vm.startPrank(owner);
        acct.execute(address(guard), 0, abi.encodeCall(IBudgetGuardHook.setLimits, (uint128(50 * CENT), uint128(30 * CENT))));
        acct.addSession(sessionKey, uint64(block.timestamp + 1 days), uint128(10 * CENT), uint128(25 * CENT));
        vm.stopPrank();
    }

    function _sessionSig(IChainworkEscrow.JobTerms memory t, uint256 keyPk, uint256 validBefore)
        internal
        view
        returns (bytes memory)
    {
        bytes32 nonce = escrow.termsHash(address(acct), t);
        bytes32 d = _receiveDigest(address(acct), t.budget, 0, validBefore, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(keyPk, d);
        IAgentAccount.SessionAuth memory a = IAgentAccount.SessionAuth({
            key: vm.addr(keyPk),
            value: t.budget,
            validAfter: 0,
            validBefore: validBefore,
            terms: t,
            keySignature: abi.encodePacked(r, s, v)
        });
        return abi.encode(a);
    }

    function _fundAsAccount(IChainworkEscrow.JobTerms memory t, uint256 keyPk) internal returns (uint256) {
        uint256 vb = block.timestamp + 10 minutes;
        bytes memory sig = _sessionSig(t, keyPk, vb);
        vm.prank(relayer);
        return escrow.fundWithAuthorization(address(acct), t, "job", 0, vb, sig);
    }

    function test_sessionKeyFundsJobThroughErc1271() public {
        uint256 id = _fundAsAccount(_terms(dataAgent, 10 * CENT, 60, address(0), 0, address(guard)), sessionPk);
        assertEq(escrow.getJob(id).client, address(acct));
        assertEq(guard.spentToday(address(acct)), 10 * CENT);
    }

    function test_sessionOverPerJobCapRejected() public {
        IChainworkEscrow.JobTerms memory t = _terms(dataAgent, 11 * CENT, 60, address(0), 0, address(guard));
        bytes memory sig = _sessionSig(t, sessionPk, block.timestamp + 10 minutes);
        vm.prank(relayer);
        vm.expectRevert(); // tUSD8: invalid signature
        escrow.fundWithAuthorization(address(acct), t, "job", 0, block.timestamp + 10 minutes, sig);
    }

    function test_sessionDailyCapReadsGuard() public {
        _fundAsAccount(_terms(dataAgent, 10 * CENT, 60, address(0), 0, address(guard)), sessionPk);
        _fundAsAccount(_terms(dataAgent, 10 * CENT, 60, address(0), 0, address(guard)), sessionPk);
        IChainworkEscrow.JobTerms memory t = _terms(dataAgent, 6 * CENT, 60, address(0), 0, address(guard));
        bytes memory sig = _sessionSig(t, sessionPk, block.timestamp + 10 minutes);
        vm.prank(relayer);
        vm.expectRevert(); // 20 + 6 > 25 daily session cap
        escrow.fundWithAuthorization(address(acct), t, "job", 0, block.timestamp + 10 minutes, sig);
    }

    function test_sessionMustUseGuardHook() public {
        IChainworkEscrow.JobTerms memory t = _terms(dataAgent, CENT, 60, address(0), 0, address(0));
        bytes memory sig = _sessionSig(t, sessionPk, block.timestamp + 10 minutes);
        vm.prank(relayer);
        vm.expectRevert();
        escrow.fundWithAuthorization(address(acct), t, "job", 0, block.timestamp + 10 minutes, sig);
    }

    /// A prompt-injected agent signs a plain transfer to an attacker with its session key: refused,
    /// because a session key can only authorize funding the escrow with terms the account checks.
    function test_promptInjectedTransferToAttackerRefused() public {
        address attacker = makeAddr("attacker");
        bytes32 nonce = keccak256("anything");
        bytes32 typehash = keccak256(
            "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
        );
        bytes32 s = keccak256(abi.encode(typehash, address(acct), attacker, 5 * CENT, 0, block.timestamp + 1 hours, nonce));
        bytes32 d = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), s));
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(sessionPk, d);
        // Raw 65-byte session signature: only the owner may sign raw, so this is rejected.
        vm.expectRevert();
        token.transferWithAuthorization(address(acct), attacker, 5 * CENT, 0, block.timestamp + 1 hours, nonce, abi.encodePacked(r, ss, v));
        assertEq(token.balanceOf(attacker), 0);
    }

    function test_revokeAndFreeze() public {
        vm.prank(owner);
        acct.revokeSession(sessionKey);
        IChainworkEscrow.JobTerms memory t = _terms(dataAgent, CENT, 60, address(0), 0, address(guard));
        bytes memory sig = _sessionSig(t, sessionPk, block.timestamp + 10 minutes);
        vm.prank(relayer);
        vm.expectRevert();
        escrow.fundWithAuthorization(address(acct), t, "job", 0, block.timestamp + 10 minutes, sig);

        vm.startPrank(owner);
        acct.addSession(sessionKey, uint64(block.timestamp + 1 days), uint128(10 * CENT), uint128(25 * CENT));
        acct.setFrozen(true);
        vm.stopPrank();
        sig = _sessionSig(t, sessionPk, block.timestamp + 10 minutes);
        vm.prank(relayer);
        vm.expectRevert();
        escrow.fundWithAuthorization(address(acct), t, "job", 0, block.timestamp + 10 minutes, sig);
    }

    function test_expiredSessionRejected() public {
        vm.warp(block.timestamp + 2 days);
        IChainworkEscrow.JobTerms memory t = _terms(dataAgent, CENT, 60, address(0), 0, address(guard));
        bytes memory sig = _sessionSig(t, sessionPk, block.timestamp + 10 minutes);
        vm.prank(relayer);
        vm.expectRevert();
        escrow.fundWithAuthorization(address(acct), t, "job", 0, block.timestamp + 10 minutes, sig);
    }

    function test_onlyOwnerManagesSessions() public {
        vm.prank(sessionKey);
        vm.expectRevert(IAgentAccount.NotOwner.selector);
        acct.addSession(sessionKey, type(uint64).max, type(uint128).max, type(uint128).max);
    }
}
