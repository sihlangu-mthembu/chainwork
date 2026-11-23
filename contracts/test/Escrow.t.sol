// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {ChainworkEscrow} from "../src/ChainworkEscrow.sol";
import {IChainworkEscrow} from "@chainwork/interfaces/IChainworkEscrow.sol";
import {IERC8183} from "@chainwork/interfaces/IERC8183.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// forge test --mc Funding
contract FundingTest is BaseTest {
    function test_fundWithAuthorization_relayerFundsGaslessly() public {
        IChainworkEscrow.JobTerms memory t = _terms(dataAgent, 10 * CENT, 60, address(0), 0, address(0));
        uint256 before = token.balanceOf(client);
        uint256 id = _fund(clientPk, t);
        assertEq(uint8(_status(id)), uint8(IERC8183.JobStatus.Funded));
        assertEq(escrow.getJob(id).client, client);
        assertEq(token.balanceOf(client), before - 10 * CENT);
        assertEq(token.balanceOf(address(escrow)), 10 * CENT);
        assertEq(token.balanceOf(relayer), 0); // relayer never touches funds
    }

    function test_tamperedTerms_reverts() public {
        IChainworkEscrow.JobTerms memory t = _terms(dataAgent, 10 * CENT, 60, address(0), 0, address(0));
        bytes memory sig = _signReceive(clientPk, t);
        t.provider = badAgent; // relayer tries to redirect the job
        vm.prank(relayer);
        vm.expectRevert();
        escrow.fundWithAuthorization(client, t, "job", 0, block.timestamp + 10 minutes, sig);
    }

    function test_tamperedBudget_reverts() public {
        IChainworkEscrow.JobTerms memory t = _terms(dataAgent, 10 * CENT, 60, address(0), 0, address(0));
        bytes memory sig = _signReceive(clientPk, t);
        t.budget = 50 * CENT;
        vm.prank(relayer);
        vm.expectRevert();
        escrow.fundWithAuthorization(client, t, "job", 0, block.timestamp + 10 minutes, sig);
    }

    function test_replay_reverts() public {
        IChainworkEscrow.JobTerms memory t = _terms(dataAgent, 10 * CENT, 60, address(0), 0, address(0));
        bytes memory sig = _signReceive(clientPk, t);
        vm.prank(relayer);
        escrow.fundWithAuthorization(client, t, "job", 0, block.timestamp + 10 minutes, sig);
        vm.prank(relayer);
        vm.expectRevert();
        escrow.fundWithAuthorization(client, t, "job", 0, block.timestamp + 10 minutes, sig);
    }

    function test_wrongDescription_reverts() public {
        IChainworkEscrow.JobTerms memory t = _terms(dataAgent, 10 * CENT, 60, address(0), 0, address(0));
        bytes memory sig = _signReceive(clientPk, t);
        vm.prank(relayer);
        vm.expectRevert(IChainworkEscrow.BadTerms.selector);
        escrow.fundWithAuthorization(client, t, "different", 0, block.timestamp + 10 minutes, sig);
    }

    function test_standardErc8183Flow() public {
        vm.startPrank(client);
        uint256 id = escrow.createJob(dataAgent, evaluator, block.timestamp + 1 hours, "job", address(0));
        escrow.setBudget(id, 5 * CENT, "");
        token.approve(address(escrow), 5 * CENT);
        vm.expectRevert(abi.encodeWithSelector(IChainworkEscrow.BudgetMismatch.selector, 4 * CENT, 5 * CENT));
        escrow.fund(id, 4 * CENT, "");
        escrow.fund(id, 5 * CENT, "");
        vm.stopPrank();
        assertEq(uint8(_status(id)), uint8(IERC8183.JobStatus.Funded));
    }
}

/// forge test --mc Bonds
contract BondsTest is BaseTest {
    function test_newAgentPostsHalfBondViaPermit() public {
        uint256 id = _fund(clientPk, _terms(badAgent, 10 * CENT, 60, address(0), 0, address(0)));
        uint256 before = token.balanceOf(badAgent);
        _accept(badPk, id);
        assertEq(escrow.getJobExt(id).bond, 5 * CENT);
        assertEq(token.balanceOf(badAgent), before - 5 * CENT);
    }

    function test_windowFinalizePaysProviderAndReturnsBond() public {
        uint256 id = _fund(clientPk, _terms(dataAgent, 10 * CENT, 60, address(0), 0, address(0)));
        uint256 before = token.balanceOf(dataAgent);
        _accept(dataPk, id);
        vm.prank(dataAgent);
        escrow.submit(id, keccak256("out"), "");
        vm.expectRevert(IChainworkEscrow.WindowOpen.selector);
        escrow.finalize(id);
        vm.warp(block.timestamp + 61);
        escrow.finalize(id); // anyone
        assertEq(uint8(_status(id)), uint8(IERC8183.JobStatus.Completed));
        assertEq(token.balanceOf(dataAgent), before + 10 * CENT);
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(rep.stats(dataAgent).completed, 1);
    }

    function test_rejectSlashesBondToClient() public {
        uint256 id = _fund(clientPk, _terms(badAgent, 10 * CENT, 0, address(0), 0, address(0)));
        _accept(badPk, id);
        vm.prank(badAgent);
        escrow.submit(id, keccak256("garbage"), "");
        uint256 clientBefore = token.balanceOf(client);
        vm.prank(evaluator);
        escrow.reject(id, keccak256("invalid schema"), "");
        assertEq(token.balanceOf(client), clientBefore + 10 * CENT + 5 * CENT); // refund + bond
        assertEq(rep.stats(badAgent).failed, 1);
        assertEq(rep.stats(badAgent).valueSlashed, 5 * CENT);
    }

    function test_expiryWithoutAcceptRefundsWithoutSlash() public {
        uint256 id = _fund(clientPk, _terms(dataAgent, 10 * CENT, 0, address(0), 0, address(0)));
        vm.expectRevert(IChainworkEscrow.NotExpired.selector);
        escrow.claimRefund(id);
        vm.warp(block.timestamp + 2 hours);
        uint256 before = token.balanceOf(client);
        vm.prank(makeAddr("anyone"));
        escrow.claimRefund(id);
        assertEq(token.balanceOf(client), before + 10 * CENT);
        assertEq(rep.stats(dataAgent).failed, 0);
    }

    function test_ghostingProviderIsSlashedAtExpiry() public {
        uint256 id = _fund(clientPk, _terms(badAgent, 10 * CENT, 0, address(0), 0, address(0)));
        _accept(badPk, id);
        vm.warp(block.timestamp + 2 hours);
        uint256 before = token.balanceOf(client);
        escrow.claimRefund(id);
        assertEq(token.balanceOf(client), before + 15 * CENT);
        assertEq(uint8(_status(id)), uint8(IERC8183.JobStatus.Expired));
    }

    function test_honestProviderNotRobbedAtExpiry() public {
        IChainworkEscrow.JobTerms memory t = _terms(dataAgent, 10 * CENT, 60, address(0), 0, address(0));
        uint256 id = _fund(clientPk, t);
        _accept(dataPk, id);
        vm.prank(dataAgent);
        escrow.submit(id, keccak256("out"), "");
        vm.warp(block.timestamp + 2 hours); // window passed, nobody finalized, now expired
        uint256 before = token.balanceOf(dataAgent);
        escrow.claimRefund(id); // finalizes instead of refunding
        assertEq(uint8(_status(id)), uint8(IERC8183.JobStatus.Completed));
        assertEq(token.balanceOf(dataAgent), before + 10 * CENT + 5 * CENT); // pay + bond back
    }

    function test_submitTooLateForWindowReverts() public {
        IChainworkEscrow.JobTerms memory t = _terms(dataAgent, 10 * CENT, 600, address(0), 0, address(0));
        uint256 id = _fund(clientPk, t);
        _accept(dataPk, id);
        vm.warp(t.expiredAt - 300);
        vm.prank(dataAgent);
        vm.expectRevert(ChainworkEscrow.SubmitTooLate.selector);
        escrow.submit(id, keccak256("out"), "");
    }
}

/// forge test --mc SubJobs
contract SubJobsTest is BaseTest {
    function setUp() public override {
        super.setUp();
        _seedReputation(coordPk, 5, CENT); // 5 real jobs of 0.01 -> score 100%, bond 0, credit 0.10
    }

    function test_seededCoordinatorIsProvenAndBroke() public view {
        assertEq(rep.bondBps(coord), 0);
        assertEq(rep.creditLimit(coord), 10 * CENT);
        assertEq(token.balanceOf(coord), 0);
    }

    function test_zeroCapitalTreeSettlesInOneTransaction() public {
        uint256 root = _fund(clientPk, _terms(coord, 10 * CENT, 60, address(0), 0, address(0)));
        _accept(coordPk, root); // bond 0

        vm.startPrank(coord);
        uint256 a = escrow.createSubJob(root, _subTerms(dataAgent, 3 * CENT, 60), "fx data");
        uint256 b = escrow.createSubJob(root, _subTerms(backup, 4 * CENT, 60), "analysis");
        vm.stopPrank();
        assertEq(token.balanceOf(coord), 0);
        assertEq(escrow.getJobExt(root).allocated, 7 * CENT);
        assertEq(escrow.maxSubcontract(root), 3 * CENT);

        _accept(dataPk, a);
        _accept(backupPk, b);
        vm.prank(dataAgent);
        escrow.submit(a, keccak256("fx"), "");
        vm.prank(backup);
        escrow.submit(b, keccak256("analysis"), "");

        // parent can't submit while children are open
        vm.prank(coord);
        vm.expectRevert(abi.encodeWithSelector(IChainworkEscrow.ChildrenOpen.selector, uint8(2)));
        escrow.submit(root, bytes32("x"), "");

        vm.warp(block.timestamp + 61);
        assertEq(escrow.settleTree(root), 2); // both children finalized

        bytes32 childRoot = escrow.childrenRoot(root);
        vm.prank(coord);
        escrow.submit(root, childRoot, "");
        vm.warp(block.timestamp + 61);

        uint256 dataBefore = token.balanceOf(dataAgent);
        uint256 n = escrow.settleTree(root);
        assertEq(n, 1);
        assertEq(token.balanceOf(coord), 3 * CENT); // margin, from a wallet that started at 0
        assertEq(token.balanceOf(dataAgent), dataBefore); // already paid at its own verification
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_childFailurePaysBondToCoordinatorAndAllowsRehire() public {
        uint256 root = _fund(clientPk, _terms(coord, 10 * CENT, 60, address(0), 0, address(0)));
        _accept(coordPk, root);
        vm.prank(coord);
        uint256 bad = escrow.createSubJob(root, _subTerms(badAgent, 4 * CENT, 60), "analysis");
        _accept(badPk, bad); // new agent: 50% bond = 0.02
        vm.prank(badAgent);
        escrow.submit(bad, keccak256("garbage"), "");

        // watcher challenges inside the window, evaluator rejects
        uint256 cb = escrow.challengeBondFor(4 * CENT);
        bytes memory psig = _signPermit(watcherPk, cb, block.timestamp + 10 minutes);
        uint256 watcherBefore = token.balanceOf(watcher);
        vm.prank(watcher);
        escrow.challenge(bad, keccak256("schema mismatch"), block.timestamp + 10 minutes, psig);
        vm.prank(evaluator);
        escrow.reject(bad, keccak256("schema mismatch"), "");

        assertEq(token.balanceOf(coord), 2 * CENT); // bad agent's bond, paid to the victim
        assertEq(token.balanceOf(watcher), watcherBefore); // challenge bond returned
        assertEq(escrow.getJobExt(root).allocated, 0); // budget back in the parent pool

        vm.prank(coord);
        uint256 again = escrow.createSubJob(root, _subTerms(backup, 4 * CENT, 60), "analysis (backup)");
        assertGt(again, bad);
        assertLt(rep.creditLimit(badAgent), 1);
    }

    function test_newAgentCannotSubcontractBeyondBondPlusCredit() public {
        uint256 root = _fund(clientPk, _terms(badAgent, 10 * CENT, 60, address(0), 0, address(0)));
        _accept(badPk, root); // bond 0.05, credit 0
        vm.startPrank(badAgent);
        escrow.createSubJob(root, _subTerms(dataAgent, 5 * CENT, 60), "ok");
        vm.expectRevert(abi.encodeWithSelector(IChainworkEscrow.CreditExceeded.selector, 6 * CENT, 5 * CENT));
        escrow.createSubJob(root, _subTerms(backup, CENT, 60), "too much");
        vm.stopPrank();
    }

    function test_childDeadlineMustPrecedeParent() public {
        uint256 root = _fund(clientPk, _terms(coord, 10 * CENT, 60, address(0), 0, address(0)));
        _accept(coordPk, root);
        IChainworkEscrow.SubJobTerms memory t = _subTerms(dataAgent, 3 * CENT, 60);
        t.expiredAt = uint64(escrow.getJob(root).expiredAt);
        vm.prank(coord);
        vm.expectRevert(IChainworkEscrow.ChildDeadlineTooLate.selector);
        escrow.createSubJob(root, t, "late");
    }

    function test_noGrandchildren() public {
        uint256 root = _fund(clientPk, _terms(coord, 10 * CENT, 60, address(0), 0, address(0)));
        _accept(coordPk, root);
        vm.prank(coord);
        uint256 a = escrow.createSubJob(root, _subTerms(dataAgent, 3 * CENT, 60), "a");
        _accept(dataPk, a);
        vm.prank(dataAgent);
        vm.expectRevert(IChainworkEscrow.DepthExceeded.selector);
        escrow.createSubJob(a, _subTerms(backup, CENT, 60), "grandchild");
    }

    function test_parentExpiryWaitsForChildrenThenRefunds() public {
        uint256 root = _fund(clientPk, _terms(coord, 10 * CENT, 60, address(0), 0, address(0)));
        _accept(coordPk, root);
        vm.prank(coord);
        escrow.createSubJob(root, _subTerms(dataAgent, 3 * CENT, 60), "a");
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(abi.encodeWithSelector(IChainworkEscrow.ChildrenOpen.selector, uint8(1)));
        escrow.claimRefund(root);
        uint256 before = token.balanceOf(client);
        assertEq(escrow.settleTree(root), 2); // child expires, then root
        assertEq(token.balanceOf(client), before + 10 * CENT);
        assertEq(token.balanceOf(address(escrow)), 0);
    }
}

/// forge test --mc Challenge
contract ChallengeTest is BaseTest {
    function test_failedChallengePaysProvider() public {
        uint256 id = _fund(clientPk, _terms(dataAgent, 10 * CENT, 60, address(0), 0, address(0)));
        _accept(dataPk, id);
        vm.prank(dataAgent);
        escrow.submit(id, keccak256("good"), "");
        bytes memory psig = _signPermit(watcherPk, CENT, block.timestamp + 10 minutes);
        vm.prank(watcher);
        escrow.challenge(id, keccak256("wrong"), block.timestamp + 10 minutes, psig);
        vm.expectRevert(IChainworkEscrow.AlreadyChallenged.selector);
        escrow.finalize(id);
        uint256 before = token.balanceOf(dataAgent);
        vm.prank(evaluator);
        escrow.complete(id, keccak256("ok"), "");
        assertEq(token.balanceOf(dataAgent), before + 10 * CENT + 5 * CENT + CENT); // pay + bond + challenge bond
    }

    function test_challengeAfterWindowReverts() public {
        uint256 id = _fund(clientPk, _terms(dataAgent, 10 * CENT, 60, address(0), 0, address(0)));
        _accept(dataPk, id);
        vm.prank(dataAgent);
        escrow.submit(id, keccak256("good"), "");
        vm.warp(block.timestamp + 61);
        vm.prank(watcher);
        vm.expectRevert(IChainworkEscrow.WindowClosed.selector);
        escrow.challenge(id, keccak256("late"), 0, "");
    }

    function test_onlyEvaluatorDecides() public {
        uint256 id = _fund(clientPk, _terms(dataAgent, 10 * CENT, 0, address(0), 0, address(0)));
        _accept(dataPk, id);
        vm.prank(dataAgent);
        escrow.submit(id, keccak256("good"), "");
        vm.prank(client);
        vm.expectRevert(IChainworkEscrow.NotEvaluator.selector);
        escrow.complete(id, 0, "");
    }
}

/// forge test --mc Verifier
contract VerifierTest is BaseTest {
    function test_hashVerifierCompletesInstantly() public {
        bytes32 expected = keccak256("reproducible build");
        uint256 id = _fund(clientPk, _terms(dataAgent, 10 * CENT, 0, address(hashVerifier), expected, address(0)));
        _accept(dataPk, id);
        vm.prank(dataAgent);
        vm.expectRevert(IChainworkEscrow.VerifierRejected.selector);
        escrow.submitWithProof(id, keccak256("wrong"), "");
        vm.prank(dataAgent);
        escrow.submitWithProof(id, expected, "");
        assertEq(uint8(_status(id)), uint8(IERC8183.JobStatus.Completed));
    }

    function test_signedDataVerifierNeedsOracleSignature() public {
        bytes32 spec = bytes32(uint256(uint160(oracle)));
        uint256 id = _fund(clientPk, _terms(dataAgent, 10 * CENT, 0, address(signedVerifier), spec, address(0)));
        _accept(dataPk, id);
        bytes32 out = keccak256("price=1.0842");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePk, signedVerifier.digest(id, out));
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(badPk, signedVerifier.digest(id, out));
        vm.prank(dataAgent);
        vm.expectRevert(IChainworkEscrow.VerifierRejected.selector);
        escrow.submitWithProof(id, out, abi.encodePacked(r2, s2, v2));
        vm.prank(dataAgent);
        escrow.submitWithProof(id, out, abi.encodePacked(r, s, v));
        assertEq(uint8(_status(id)), uint8(IERC8183.JobStatus.Completed));
    }
}

/// forge test --mc Views
contract ViewsTest is BaseTest {
    function test_pagination() public {
        for (uint256 i = 0; i < 5; i++) {
            IChainworkEscrow.JobTerms memory t = _terms(dataAgent, CENT, 0, address(0), 0, address(0));
            t.salt = bytes32(i);
            _fund(clientPk, t);
        }
        (IERC8183.Job[] memory jobs,, uint256 next) = escrow.getJobsPage(1, 2);
        assertEq(jobs.length, 2);
        assertEq(next, 3);
        (jobs,, next) = escrow.getJobsPage(5, 10);
        assertEq(jobs.length, 1);
        assertEq(next, 0);
    }
}
