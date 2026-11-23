// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {BaseTest} from "../Base.t.sol";
import {ChainworkEscrow} from "../../src/ChainworkEscrow.sol";
import {ReputationRegistry} from "../../src/ReputationRegistry.sol";
import {IChainworkEscrow} from "@chainwork/interfaces/IChainworkEscrow.sol";
import {IERC8183} from "@chainwork/interfaces/IERC8183.sol";
import {IFiatTokenV2_2} from "@chainwork/interfaces/IFiatTokenV2_2.sol";

/// @notice Drives the escrow with random but mostly-valid actions from a fixed cast of actors.
contract EscrowHandler is Test {
    ChainworkEscrow internal escrow;
    ReputationRegistry internal rep;
    IFiatTokenV2_2 internal token;
    address[] internal actors;
    uint256[] internal pks;
    address internal evaluator;
    bytes32 internal constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    uint256 public calls;
    mapping(bytes32 => uint256) public ok;

    constructor(ChainworkEscrow e, ReputationRegistry r, IFiatTokenV2_2 t, uint256[] memory k, address ev) {
        escrow = e;
        rep = r;
        token = t;
        pks = k;
        address[] memory a = new address[](k.length);
        for (uint256 i = 0; i < k.length; i++) a[i] = vm.addr(k[i]);
        actors = a;
        evaluator = ev;
        for (uint256 i = 0; i < a.length; i++) {
            vm.prank(a[i]);
            token.approve(address(e), type(uint256).max);
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    /// Bias toward the most recent jobs, where live state transitions happen.
    function _job(uint256 seed) internal view returns (uint256) {
        uint256 n = escrow.jobCount();
        if (n == 0) return 0;
        if (n <= 6) return 1 + (seed % n);
        return n - 5 + (seed % 6);
    }

    function fundRoot(uint256 cSeed, uint256 pSeed, uint256 budget, uint256 window) external {
        calls++;
        uint256 ci = cSeed % actors.length;
        address c = actors[ci];
        address p = _actor(pSeed);
        if (c == p) return;
        IChainworkEscrow.JobTerms memory t;
        t.provider = p;
        t.evaluator = evaluator;
        t.expiredAt = uint64(block.timestamp + 2 hours);
        t.challengeWindow = window % 3 == 0 ? 0 : uint64(bound(window, 30, 120));
        t.budget = bound(budget, 1, 200_000);
        t.descriptionHash = keccak256("j");
        t.salt = keccak256(abi.encode(calls, cSeed, pSeed));
        uint256 vb = block.timestamp + 10 minutes;
        bytes32 st = keccak256(abi.encode(RECEIVE_TYPEHASH, c, address(escrow), t.budget, 0, vb, escrow.termsHash(c, t)));
        (uint8 v, bytes32 r, bytes32 ss) =
            vm.sign(pks[ci], keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), st)));
        try escrow.fundWithAuthorization(c, t, "j", 0, vb, abi.encodePacked(r, ss, v)) { ok["fund"]++; } catch {}
    }

    function accept(uint256 jSeed) external {
        calls++;
        uint256 id = _job(jSeed);
        if (id == 0) return;
        vm.prank(escrow.getJob(id).provider);
        try escrow.acceptJob(id, 0, "") { ok["accept"]++; } catch {}
    }

    function subcontract(uint256 jSeed, uint256 pSeed, uint256 budget, uint256 window) external {
        calls++;
        uint256 id = _job(jSeed);
        if (id == 0) return;
        IERC8183.Job memory j = escrow.getJob(id);
        IChainworkEscrow.SubJobTerms memory t;
        t.provider = _actor(pSeed);
        t.evaluator = evaluator;
        t.expiredAt = uint64(j.expiredAt > block.timestamp + 10 minutes ? j.expiredAt - 10 minutes : block.timestamp + 1);
        t.challengeWindow = window % 2 == 0 ? 0 : uint64(bound(window, 30, 120));
        t.budget = bound(budget, 1, 100_000);
        vm.prank(j.provider);
        try escrow.createSubJob(id, t, "c") { ok["sub"]++; } catch {}
    }

    function submit(uint256 jSeed, bytes32 d) external {
        calls++;
        uint256 id = jSeed % 2 == 0 ? _recent(IERC8183.JobStatus.Funded) : _job(jSeed);
        if (id == 0) return;
        vm.prank(escrow.getJob(id).provider);
        try escrow.submit(id, d, "") { ok["submit"]++; } catch {}
    }

    /// Most recent job in `status` among the last 6 (0 if none), so rare states still get exercised.
    function _recent(IERC8183.JobStatus status) internal view returns (uint256) {
        uint256 n = escrow.jobCount();
        uint256 lo = n > 6 ? n - 5 : 1;
        for (uint256 id = n; id >= lo && id > 0; id--) {
            if (escrow.getJob(id).status == status) return id;
        }
        return 0;
    }

    function challenge(uint256 jSeed, uint256 aSeed) external {
        calls++;
        uint256 id = jSeed % 2 == 0 ? _recent(IERC8183.JobStatus.Submitted) : _job(jSeed);
        if (id == 0) return;
        vm.prank(_actor(aSeed));
        try escrow.challenge(id, bytes32("x"), 0, "") { ok["challenge"]++; } catch {}
    }

    function decide(uint256 jSeed, bool pass) external {
        calls++;
        uint256 id = _job(jSeed);
        if (id == 0) return;
        vm.prank(evaluator);
        if (pass) {
            try escrow.complete(id, 0, "") { ok["complete"]++; } catch {}
        } else {
            try escrow.reject(id, 0, "") { ok["reject"]++; } catch {}
        }
    }

    function finalize(uint256 jSeed) external {
        calls++;
        uint256 id = _job(jSeed);
        if (id == 0) return;
        try escrow.finalize(id) { ok["finalize"]++; } catch {}
    }

    uint256 internal scanFrom = 1;

    /// Oldest job still open past its deadline; scans at most 10 jobs from a moving cursor.
    function _oldestExpiredOpen() internal returns (uint256) {
        uint256 n = escrow.jobCount();
        for (uint256 i = 0; i < 10 && scanFrom <= n; i++) {
            IERC8183.JobStatus st = escrow.getJob(scanFrom).status;
            if (st != IERC8183.JobStatus.Funded && st != IERC8183.JobStatus.Submitted) {
                scanFrom++;
                continue;
            }
            if (block.timestamp < escrow.getJob(scanFrom).expiredAt) return 0;
            // A root with open children can't be refunded yet: return its first open child instead.
            uint256[] memory kids = escrow.getChildren(scanFrom);
            for (uint256 k = 0; k < kids.length; k++) {
                IERC8183.JobStatus cs = escrow.getJob(kids[k]).status;
                if (cs == IERC8183.JobStatus.Funded || cs == IERC8183.JobStatus.Submitted) return kids[k];
            }
            return scanFrom;
        }
        return 0;
    }

    function refund(uint256 jSeed) external {
        calls++;
        uint256 id = jSeed % 2 == 0 ? _oldestExpiredOpen() : _job(jSeed);
        if (id == 0) return;
        try escrow.claimRefund(id) { ok["refund"]++; } catch {}
    }

    function settle(uint256 jSeed) external {
        calls++;
        uint256 id = _job(jSeed);
        if (id == 0) return;
        try escrow.settleTree(id) returns (uint256 c) { ok["settled"] += c; } catch {}
    }

    function warp(uint256 secs) external {
        calls++;
        vm.warp(block.timestamp + bound(secs, 1, 150));
    }
}

/// forge test --mc Invariant
contract InvariantTest is BaseTest {
    EscrowHandler internal handler;

    function setUp() public override {
        super.setUp();
        uint256[] memory k = new uint256[](5);
        k[0] = clientPk;
        k[1] = dataPk;
        k[2] = badPk;
        k[3] = backupPk;
        k[4] = watcherPk;
        handler = new EscrowHandler(escrow, rep, token, k, evaluator);
        targetContract(address(handler));
    }

    function _terminal(IERC8183.JobStatus s) internal pure returns (bool) {
        return s == IERC8183.JobStatus.Completed || s == IERC8183.JobStatus.Rejected
            || s == IERC8183.JobStatus.Expired;
    }

    /// I1: every token the escrow holds is accounted for by an open root budget, a bond or a challenge bond.
    function invariant_I1_moneyConserved() public view {
        uint256 expected;
        uint256 n = escrow.jobCount();
        for (uint256 id = 1; id <= n; id++) {
            IERC8183.Job memory j = escrow.getJob(id);
            IChainworkEscrow.JobExt memory e = escrow.getJobExt(id);
            if (e.depth == 0 && (j.status == IERC8183.JobStatus.Funded || j.status == IERC8183.JobStatus.Submitted)) {
                expected += j.budget - e.paidToChildren;
            }
            expected += e.bond + e.challengeBond;
        }
        assertEq(token.balanceOf(address(escrow)), expected, "I1");
    }

    /// I2 + tree bookkeeping: allocations never exceed the parent budget, and openChildren matches reality.
    function invariant_I2_treeBookkeeping() public view {
        uint256 n = escrow.jobCount();
        for (uint256 id = 1; id <= n; id++) {
            IChainworkEscrow.JobExt memory e = escrow.getJobExt(id);
            if (e.depth != 0) continue;
            IERC8183.Job memory j = escrow.getJob(id);
            assertLe(e.allocated, j.budget, "I2 allocated <= budget");
            assertLe(e.paidToChildren, e.allocated, "paid <= allocated");
            uint256[] memory kids = escrow.getChildren(id);
            uint256 open;
            uint256 live;
            for (uint256 k = 0; k < kids.length; k++) {
                IERC8183.Job memory c = escrow.getJob(kids[k]);
                if (!_terminal(c.status)) open++;
                if (c.status != IERC8183.JobStatus.Rejected && c.status != IERC8183.JobStatus.Expired) {
                    live += c.budget;
                }
            }
            assertEq(open, e.openChildren, "openChildren");
            assertEq(live, e.allocated, "allocated == live + completed child budgets");
        }
    }

    /// I4: no root is Submitted or Completed while it has open children.
    function invariant_I4_parentWaitsForChildren() public view {
        uint256 n = escrow.jobCount();
        for (uint256 id = 1; id <= n; id++) {
            IChainworkEscrow.JobExt memory e = escrow.getJobExt(id);
            IERC8183.JobStatus s = escrow.getJob(id).status;
            if (s == IERC8183.JobStatus.Submitted || _terminal(s)) assertEq(e.openChildren, 0, "I4");
        }
    }

    /// Terminal jobs hold nothing.
    function invariant_terminalJobsHoldNoBonds() public view {
        uint256 n = escrow.jobCount();
        for (uint256 id = 1; id <= n; id++) {
            if (!_terminal(escrow.getJob(id).status)) continue;
            IChainworkEscrow.JobExt memory e = escrow.getJobExt(id);
            assertEq(e.bond + e.challengeBond, 0, "terminal holds funds");
        }
    }

    function invariant_callSummary() public view {
        assertGe(handler.calls(), 0);
    }

    /// Coverage check: one long random run must reach every state transition.
    function test_handlerReachesDeepStates() public {
        for (uint256 i = 0; i < 2000; i++) {
            uint256 r = uint256(keccak256(abi.encode(i, "cov")));
            uint256 k = r % 10;
            if (k == 0) handler.fundRoot(r >> 8, r >> 16, r >> 24, r >> 32);
            else if (k == 1) handler.accept(r >> 8);
            else if (k == 2) handler.subcontract(r >> 8, r >> 16, r >> 24, r >> 32);
            else if (k == 3) handler.submit(r >> 8, bytes32(r));
            else if (k == 4) handler.challenge(r >> 8, r >> 16);
            else if (k == 5) handler.decide(r >> 8, (r >> 40) % 2 == 0);
            else if (k == 6) handler.finalize(r >> 8);
            else if (k == 7) handler.refund(r >> 8);
            else if (k == 8) handler.settle(r >> 8);
            else handler.warp(r >> 8);
            if (i % 50 == 0) {
                invariant_I1_moneyConserved();
                invariant_I2_treeBookkeeping();
            }
        }
        invariant_I1_moneyConserved();
        invariant_I2_treeBookkeeping();
        string[10] memory names = ["fund", "accept", "sub", "submit", "challenge", "complete", "reject", "finalize", "refund", "settled"];
        for (uint256 i = 0; i < names.length; i++) {
            uint256 c = handler.ok(bytes32(bytes(names[i])));
            console2.log(names[i], c);
            assertGt(c, 0, names[i]);
        }
    }
}
