// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "../Base.t.sol";
import {IChainworkEscrow} from "@chainwork/interfaces/IChainworkEscrow.sol";
import {IERC8183} from "@chainwork/interfaces/IERC8183.sol";
import {IACPHook} from "@chainwork/interfaces/IACPHook.sol";

/// A client's hook that lets the money in, then vetoes delivery.
contract BlockingHook is IACPHook {
    bytes4 internal constant FUND = IERC8183.fund.selector;

    function beforeAction(uint256, bytes4 selector, bytes calldata) external pure {
        if (selector != FUND && selector != IChainworkEscrow.fundWithAuthorization.selector) revert("blocked");
    }

    function afterAction(uint256, bytes4, bytes calldata) external pure {}
}

/// T7.1 red team on the escrow. Each test is an attack; it passes when the attack fails.
/// R1 and R2 were real findings: these tests failed before their fixes in ChainworkEscrow.
contract RedTeamTest is BaseTest {
    // ------------------------------------------------------------ R1 bond theft by self-judging

    /// R1. A coordinator hires a bonded worker, names ITSELF evaluator of the child, and rejects good
    /// work to pocket the worker's bond. Fixed: a payer who is also the judge cannot slash.
    function test_R1_selfJudgingPayerCannotTakeTheBond() public {
        _seedReputation(coordPk, 8, 5 * CENT);
        uint256 root = _fund(clientPk, _terms(coord, 10 * CENT, 0, address(0), bytes32(0), address(0)));
        _accept(coordPk, root);
        IChainworkEscrow.SubJobTerms memory t = _subTerms(badAgent, 4 * CENT, 0);
        t.evaluator = coord; // the payer judges its own hire
        vm.prank(coord);
        uint256 child = escrow.createSubJob(root, t, "metrics");
        _accept(badPk, child); // a new agent posts a bond
        uint256 bond = escrow.getJobExt(child).bond;
        assertGt(bond, 0, "worker posted a bond");
        uint256 workerBefore = token.balanceOf(badAgent);
        vm.prank(badAgent);
        escrow.submit(child, keccak256("good work"), "");
        vm.prank(coord);
        escrow.reject(child, bytes32("I just want the bond"), "");
        assertEq(token.balanceOf(badAgent), workerBefore + bond, "bond returned, not stolen");
        assertEq(token.balanceOf(coord), 0, "coordinator gained nothing");
    }

    /// R1 (control). With an independent evaluator, a rejection still slashes to the payer.
    function test_R1_independentEvaluatorStillSlashes() public {
        _seedReputation(coordPk, 8, 5 * CENT);
        uint256 root = _fund(clientPk, _terms(coord, 10 * CENT, 0, address(0), bytes32(0), address(0)));
        _accept(coordPk, root);
        vm.prank(coord);
        uint256 child = escrow.createSubJob(root, _subTerms(badAgent, 4 * CENT, 0), "metrics");
        _accept(badPk, child);
        uint256 bond = escrow.getJobExt(child).bond;
        vm.prank(badAgent);
        escrow.submit(child, keccak256("bad work"), "");
        vm.prank(evaluator);
        escrow.reject(child, bytes32("wrong"), "");
        assertEq(token.balanceOf(coord), bond, "slashed bond goes to the payer");
    }

    // ------------------------------------------------------------ R2 free challenges

    /// R2. On a tiny job the 10% challenge bond rounded down to zero, so anyone could freeze a
    /// worker's payment for free. Fixed: the bond rounds up (at least 1 base unit).
    function test_R2_noFreeChallenges() public {
        for (uint256 b = 1; b < 30; b++) {
            assertGt(escrow.challengeBondFor(b), 0, "every challenge costs something");
        }
        assertEq(escrow.challengeBondFor(10 * CENT), CENT, "10% exactly when it divides");
    }

    // ------------------------------------------------------------ attacks that fail

    /// Relayer swaps the provider (or the budget) in signed terms: the authorization no longer matches.
    function test_relayerCannotTamperWithSignedTerms() public {
        IChainworkEscrow.JobTerms memory t = _terms(coord, 10 * CENT, 0, address(0), bytes32(0), address(0));
        bytes memory sig = _signReceive(clientPk, t);
        IChainworkEscrow.JobTerms memory evil = t;
        evil.provider = badAgent;
        vm.prank(relayer);
        vm.expectRevert();
        escrow.fundWithAuthorization(client, evil, "job", 0, block.timestamp + 10 minutes, sig);
        evil = t;
        evil.budget = 11 * CENT;
        vm.prank(relayer);
        vm.expectRevert();
        escrow.fundWithAuthorization(client, evil, "job", 0, block.timestamp + 10 minutes, sig);
    }

    /// The same signed payment cannot fund two jobs.
    function test_signedPaymentCannotBeReplayed() public {
        IChainworkEscrow.JobTerms memory t = _terms(coord, 10 * CENT, 0, address(0), bytes32(0), address(0));
        bytes memory sig = _signReceive(clientPk, t);
        vm.prank(relayer);
        escrow.fundWithAuthorization(client, t, "job", 0, block.timestamp + 10 minutes, sig);
        vm.prank(relayer);
        vm.expectRevert();
        escrow.fundWithAuthorization(client, t, "job", 0, block.timestamp + 10 minutes, sig);
    }

    /// A coordinator with no record and no bond cannot hire beyond bond + credit (credit bypass).
    function test_noHiringBeyondCredit() public {
        uint256 root = _fund(clientPk, _terms(coord, 10 * CENT, 0, address(0), bytes32(0), address(0)));
        vm.prank(seedClient);
        token.transfer(coord, 5 * CENT); // enough for a new agent's 50% bond
        _accept(coordPk, root);
        uint256 limit = escrow.getJobExt(root).bond + rep.creditLimit(coord);
        vm.prank(coord);
        vm.expectRevert();
        escrow.createSubJob(root, _subTerms(dataAgent, limit + 1, 0), "too much");
    }

    /// Children cannot outlive their parent, and expiry closes the whole tree: a coordinator who
    /// hires and walks away cannot keep the client's refund locked.
    function test_refundCannotBeBlockedByOpenChildren() public {
        _seedReputation(coordPk, 8, 5 * CENT);
        uint256 before = token.balanceOf(client);
        uint256 root = _fund(clientPk, _terms(coord, 10 * CENT, 0, address(0), bytes32(0), address(0)));
        _accept(coordPk, root);
        IChainworkEscrow.SubJobTerms memory late = _subTerms(dataAgent, 3 * CENT, 0);
        late.expiredAt = uint64(escrow.getJob(root).expiredAt);
        vm.prank(coord);
        vm.expectRevert();
        escrow.createSubJob(root, late, "outlives parent");
        vm.prank(coord);
        escrow.createSubJob(root, _subTerms(dataAgent, 3 * CENT, 0), "abandoned");
        vm.warp(block.timestamp + 2 hours);
        vm.prank(makeAddr("anyone"));
        escrow.settleTree(root);
        assertEq(uint8(_status(root)), uint8(IERC8183.JobStatus.Expired));
        assertEq(token.balanceOf(client), before, "client got every cent back");
    }

    /// R3 (accepted, mitigated off chain). ERC-8183 lets a job's hook veto actions, so a client's
    /// hook can stop delivery. It can never stop the refund (I5). Workers defend themselves by
    /// accepting only jobs with no hook or a known one (worker-kit allowedHooks), because a provider
    /// that accepted and could not deliver would lose its bond at expiry.
    function test_hookCannotBlockRefund() public {
        BlockingHook hook = new BlockingHook();
        _seedReputation(dataPk, 8, CENT);
        uint256 a = _fund(clientPk, _terms(dataAgent, 3 * CENT, 60, address(0), bytes32(0), address(hook)));
        _accept(dataPk, a);
        vm.prank(dataAgent);
        vm.expectRevert();
        escrow.submit(a, keccak256("x"), ""); // the hook vetoes submit itself
        vm.warp(block.timestamp + 2 hours);
        escrow.claimRefund(a); // ...but cannot stop the refund
        assertEq(uint8(_status(a)), uint8(IERC8183.JobStatus.Expired));
    }

    /// Nobody but the named evaluator can complete or reject; the provider cannot challenge itself.
    function test_rolesCannotBeSpoofed() public {
        _seedReputation(dataPk, 8, CENT);
        uint256 id = _fund(clientPk, _terms(dataAgent, 3 * CENT, 60, address(0), bytes32(0), address(0)));
        _accept(dataPk, id);
        vm.prank(dataAgent);
        escrow.submit(id, keccak256("x"), "");
        vm.prank(client);
        vm.expectRevert();
        escrow.complete(id, bytes32(0), "");
        vm.prank(dataAgent);
        vm.expectRevert();
        escrow.reject(id, bytes32(0), "");
        vm.prank(dataAgent);
        vm.expectRevert();
        escrow.challenge(id, bytes32(0), 0, "");
    }

    /// Challenge windows are exact: no finalizing early, no challenging late, no double payout.
    function test_windowEdgesAndNoDoublePayout() public {
        _seedReputation(dataPk, 8, CENT);
        uint256 id = _fund(clientPk, _terms(dataAgent, 3 * CENT, 60, address(0), bytes32(0), address(0)));
        _accept(dataPk, id);
        vm.prank(dataAgent);
        escrow.submit(id, keccak256("x"), "");
        vm.expectRevert();
        escrow.finalize(id);
        vm.warp(block.timestamp + 60);
        vm.prank(watcher);
        vm.expectRevert();
        escrow.challenge(id, bytes32(0), 0, "");
        uint256 before = token.balanceOf(dataAgent);
        escrow.finalize(id);
        assertEq(token.balanceOf(dataAgent), before + 3 * CENT);
        vm.expectRevert();
        escrow.finalize(id);
        vm.expectRevert();
        escrow.claimRefund(id);
        escrow.settleTree(id);
        assertEq(token.balanceOf(dataAgent), before + 3 * CENT, "paid exactly once");
    }
}
