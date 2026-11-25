// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC8183} from "./IERC8183.sol";

/// @title Chainwork escrow: ERC-8183 + zero-capital subcontract trees + reputation-priced bonds
///        + optimistic challenges + gasless funding
/// @notice FROZEN (L0). Changes need a PR reviewed by both lanes.
///
/// Money rules (each is an invariant test in contracts/test/invariant):
///  I1  tUSD8.balanceOf(escrow) == sum(unsettled root budgets) + sum(posted bonds) + sum(challenge bonds)
///  I2  for every parent: sum(child budgets still allocated) <= parent.budget
///  I3  at subcontract time: parent.allocated <= parent.bond + reputation.creditLimit(provider)
///  I4  a parent cannot submit, complete or finalize while openChildren > 0
///  I5  claimRefund cannot be blocked by any hook or role (children expire before parents)
///  I6  a slashed bond goes only to the payer of the failed job (root: client; child: parent provider),
///      and a rejection slashes only when the evaluator is not that payer
///  I7  funds are released only by: evaluator decision, verifier proof, or an unchallenged window
///
/// Settlement rules:
///  - Child Completed: child.provider gets child.budget + its bond back; parent.paidToChildren += child.budget.
///  - Child Rejected/Expired: child.budget returns to the parent pool (parent.allocated -= child.budget);
///    child bond goes to parent.provider (the child's client).
///  - Root Completed: provider gets budget - paidToChildren, plus its bond back.
///  - Root Rejected/Expired: client gets budget - paidToChildren; provider bond goes to client.
///  - Children are paid on their OWN verification, never held hostage by the parent's outcome.
///
/// Gasless funding: the EIP-3009 nonce IS termsHash(client, terms). Anyone (the x402 facilitator)
/// may submit the client's signature, but changing any term breaks the signature.
interface IChainworkEscrow is IERC8183 {
    // ---------------------------------------------------------------- types

    struct JobTerms {
        address provider;
        address evaluator;
        address verifier; // optional IVerifier; address(0) = none
        address hook; // optional IACPHook (e.g. BudgetGuardHook); address(0) = none
        uint64 expiredAt; // unix seconds
        uint64 challengeWindow; // seconds; 0 = evaluator must decide
        uint256 budget; // tUSD8 base units (6 decimals)
        bytes32 verifierSpec; // passed to IVerifier.verify
        bytes32 descriptionHash; // keccak256(bytes(description))
        bytes32 salt; // client-chosen, makes every terms hash unique
    }

    struct SubJobTerms {
        address provider;
        address evaluator;
        address verifier;
        uint64 expiredAt; // must be < parent.expiredAt
        uint64 challengeWindow;
        uint256 budget; // carved from the parent budget
        bytes32 verifierSpec;
    }

    struct JobExt {
        uint256 parentId; // 0 for root jobs
        uint8 depth; // 0 root, 1 child (MAX_DEPTH = 1)
        uint8 openChildren; // children not yet Completed/Rejected/Expired
        bool accepted; // provider called acceptJob
        bool challenged;
        address verifier;
        uint64 challengeWindow;
        uint64 submittedAt;
        uint256 bond; // posted by provider at acceptJob
        uint256 allocated; // budget currently allocated to children (live + completed)
        uint256 paidToChildren; // paid out to completed children
        bytes32 verifierSpec;
        bytes32 deliverable;
        address challenger;
        uint256 challengeBond;
    }

    // --------------------------------------------------------------- events

    event JobAccepted(uint256 indexed jobId, address indexed provider, uint256 bond);
    event SubJobCreated(uint256 indexed parentId, uint256 indexed childId, address indexed provider, uint256 budget);
    event ChildBudgetReturned(uint256 indexed parentId, uint256 indexed childId, uint256 amount);
    event Challenged(uint256 indexed jobId, address indexed challenger, uint256 bond, bytes32 reason);
    event ChallengeBondSettled(uint256 indexed jobId, address indexed to, uint256 amount);
    event BondReturned(uint256 indexed jobId, address indexed provider, uint256 amount);
    event BondSlashed(uint256 indexed jobId, address indexed provider, address indexed to, uint256 amount);
    event Finalized(uint256 indexed jobId); // completed by an unchallenged window
    event TreeSettled(uint256 indexed rootId, uint256 nodesClosed);

    // --------------------------------------------------------------- errors

    error NotClient();
    error NotProvider();
    error NotEvaluator();
    error WrongStatus(IERC8183.JobStatus status);
    error BudgetMismatch(uint256 expected, uint256 actual);
    error AlreadyAccepted();
    error NotAccepted();
    error Expired();
    error NotExpired();
    error DepthExceeded();
    error TooManyChildren();
    error ChildBudgetTooHigh(uint256 requested, uint256 available);
    error CreditExceeded(uint256 allocatedAfter, uint256 limit);
    error ChildDeadlineTooLate();
    error ChildrenOpen(uint8 openChildren);
    error WindowOpen();
    error WindowClosed();
    error NoWindow();
    error AlreadyChallenged();
    error VerifierRejected();
    error NoVerifier();
    error BadTerms();

    // ------------------------------------------------------- configuration

    function paymentToken() external view returns (address); // tUSD8

    function reputation() external view returns (address); // IReputationRegistry

    function MAX_DEPTH() external view returns (uint8); // 1 (root + one level of children)

    function MAX_CHILDREN() external view returns (uint8); // 4

    function MIN_CHALLENGE_WINDOW() external view returns (uint64); // 30 s

    function MAX_CHALLENGE_WINDOW() external view returns (uint64); // 600 s

    /// @return bond a challenger must post, in base units, for a job of this budget (10%, rounded up).
    function challengeBondFor(uint256 budget) external view returns (uint256);

    // ------------------------------------------------------ gasless funding

    /// @notice EIP-3009 nonce the client must sign for these terms.
    /// @dev keccak256(abi.encode(TERMS_TYPEHASH, block.chainid, address(this), client, terms)) where
    ///      TERMS_TYPEHASH = keccak256("ChainworkJobTerms(address provider,address evaluator,address verifier,
    ///      address hook,uint64 expiredAt,uint64 challengeWindow,uint256 budget,bytes32 verifierSpec,
    ///      bytes32 descriptionHash,bytes32 salt)") (one line, no spaces after commas).
    function termsHash(address client, JobTerms calldata terms) external view returns (bytes32);

    /// @notice Create and fund a root job in one call from the client's EIP-3009 signature.
    /// @dev Calls tUSD8.receiveWithAuthorization(client, address(this), terms.budget, validAfter,
    ///      validBefore, termsHash(client, terms), signature). Callable by anyone (the facilitator).
    ///      Runs the terms.hook `fund` hooks with optParams = abi.encode(client, terms.budget).
    ///      Job starts in Funded. keccak256(bytes(description)) must equal terms.descriptionHash.
    function fundWithAuthorization(
        address client,
        JobTerms calldata terms,
        string calldata description,
        uint256 validAfter,
        uint256 validBefore,
        bytes calldata signature
    ) external returns (uint256 jobId);

    // ------------------------------------------------------ provider actions

    /// @notice Provider accepts a Funded job and posts reputation.requiredBond(provider, budget).
    /// @dev If permitSignature is non-empty, calls tUSD8.permit(provider, escrow, bond, permitDeadline, sig)
    ///      first; otherwise relies on an existing allowance. Bond 0 needs no permit.
    function acceptJob(uint256 jobId, uint256 permitDeadline, bytes calldata permitSignature) external;

    /// @notice Carve a child job out of the parent's locked budget. No new money.
    /// @dev msg.sender == parent.provider; parent Funded and accepted; parent.depth < MAX_DEPTH;
    ///      terms.expiredAt < parent.expiredAt; budget <= parent.budget - parent.allocated;
    ///      parent.allocated + budget <= parent.bond + reputation.creditLimit(provider).
    ///      Child: client = parent.provider, status Funded, hook = address(0).
    function createSubJob(uint256 parentId, SubJobTerms calldata terms, string calldata description)
        external
        returns (uint256 childId);

    /// @notice Submit and complete instantly when the job's verifier accepts the proof.
    function submitWithProof(uint256 jobId, bytes32 deliverable, bytes calldata proof) external;

    // ------------------------------------------------- optimistic challenges

    /// @notice Dispute a Submitted job inside its window. Posts challengeBondFor(budget).
    /// @dev permit semantics as in acceptJob. After a challenge only the evaluator (or expiry) can close the job.
    ///      Evaluator complete => challenge bond to provider. Evaluator reject => challenge bond returned.
    function challenge(uint256 jobId, bytes32 reason, uint256 permitDeadline, bytes calldata permitSignature)
        external;

    /// @notice Complete a Submitted job whose window has passed with no challenge. Callable by anyone.
    function finalize(uint256 jobId) external;

    /// @notice Close every node of a tree that can be closed now, children first, in one transaction:
    ///         finalize unchallenged windows, claimRefund expired jobs, then the root if possible.
    /// @return nodesClosed number of jobs that changed to a terminal status
    function settleTree(uint256 rootId) external returns (uint256 nodesClosed);

    // --------------------------------------------------------------- views

    function jobCount() external view returns (uint256);

    function getJobExt(uint256 jobId) external view returns (JobExt memory);

    function getChildren(uint256 parentId) external view returns (uint256[] memory);

    /// @notice Paginated read so UIs never need eth_getLogs (Aevum caps it at 1,000 blocks).
    /// @param cursor first job id to return (job ids start at 1)
    /// @return jobs the jobs on this page
    /// @return exts their Chainwork extension data, same order
    /// @return nextCursor id to pass next time (0 when done)
    function getJobsPage(uint256 cursor, uint256 limit)
        external
        view
        returns (Job[] memory jobs, JobExt[] memory exts, uint256 nextCursor);

    /// @notice Merkle root (sorted-pair keccak256) of the children's deliverables, in child order.
    ///         A coordinator's parent deliverable should commit to this.
    function childrenRoot(uint256 parentId) external view returns (bytes32);

    /// @notice What a provider may still pass to children of this job right now.
    function maxSubcontract(uint256 parentId) external view returns (uint256);
}
