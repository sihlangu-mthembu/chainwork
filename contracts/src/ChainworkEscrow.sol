// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Hashes} from "@openzeppelin/contracts/utils/cryptography/Hashes.sol";

import {IERC8183} from "@chainwork/interfaces/IERC8183.sol";
import {IACPHook} from "@chainwork/interfaces/IACPHook.sol";
import {IChainworkEscrow} from "@chainwork/interfaces/IChainworkEscrow.sol";
import {IVerifier} from "@chainwork/interfaces/IVerifier.sol";
import {IReputationRegistry} from "@chainwork/interfaces/IReputationRegistry.sol";
import {IFiatTokenV2_2} from "@chainwork/interfaces/IFiatTokenV2_2.sol";

/// @title ChainworkEscrow
/// @notice ERC-8183 job escrow with zero-capital subcontract trees, reputation-priced bonds,
///         optimistic challenge windows and gasless EIP-3009 funding. See IChainworkEscrow for
///         the money rules and invariants I1–I7.
/// @dev Trees are one level deep (MAX_DEPTH = 1): a root job and up to MAX_CHILDREN open children.
///      Children are funded from the root's budget, so the escrow's balance only ever comes from
///      root budgets, bonds and challenge bonds.
contract ChainworkEscrow is IChainworkEscrow, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------ constants

    uint8 public constant MAX_DEPTH = 1;
    uint8 public constant MAX_CHILDREN = 4; // open at once
    uint8 public constant MAX_TOTAL_CHILDREN = 8; // ever, so settleTree stays bounded
    uint64 public constant MIN_CHALLENGE_WINDOW = 30;
    uint64 public constant MAX_CHALLENGE_WINDOW = 600;
    uint256 public constant CHALLENGE_BOND_BPS = 1000; // 10% of the job budget
    uint256 public constant MAX_PAGE = 100;

    bytes32 public constant TERMS_TYPEHASH = keccak256(
        "ChainworkJobTerms(address provider,address evaluator,address verifier,address hook,uint64 expiredAt,uint64 challengeWindow,uint256 budget,bytes32 verifierSpec,bytes32 descriptionHash,bytes32 salt)"
    );
    bytes32 private constant REASON_VERIFIER = keccak256("chainwork.verifier");
    bytes32 private constant REASON_WINDOW = keccak256("chainwork.window");

    // ---------------------------------------------------------------- state

    IFiatTokenV2_2 private immutable _token;
    IReputationRegistry private immutable _rep;

    uint256 public jobCount;
    mapping(uint256 => Job) private _jobs;
    mapping(uint256 => JobExt) private _ext;
    mapping(uint256 => uint256[]) private _children;

    // Implementation-only errors (not part of the frozen interface)
    error SubmitTooLate(); // the challenge window would end after expiredAt
    error ZeroAddress();
    error BadWindow();
    error ProviderNotSet();
    error NotRoot();

    constructor(address token_, address reputation_) {
        if (token_ == address(0) || reputation_ == address(0)) revert ZeroAddress();
        _token = IFiatTokenV2_2(token_);
        _rep = IReputationRegistry(reputation_);
    }

    // ------------------------------------------------------- configuration

    /// @inheritdoc IChainworkEscrow
    function paymentToken() external view returns (address) {
        return address(_token);
    }

    /// @inheritdoc IChainworkEscrow
    function reputation() external view returns (address) {
        return address(_rep);
    }

    /// @inheritdoc IChainworkEscrow
    function challengeBondFor(uint256 budget) public pure returns (uint256) {
        return budget * CHALLENGE_BOND_BPS / 10_000;
    }

    // ------------------------------------------------------ ERC-8183 core

    /// @inheritdoc IERC8183
    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) external returns (uint256 jobId) {
        if (evaluator == address(0)) revert ZeroAddress();
        if (expiredAt <= block.timestamp) revert Expired();
        jobId = ++jobCount;
        _jobs[jobId] = Job({
            id: jobId,
            client: msg.sender,
            provider: provider,
            evaluator: evaluator,
            description: description,
            budget: 0,
            expiredAt: expiredAt,
            status: JobStatus.Open,
            hook: hook
        });
        emit JobCreated(jobId, msg.sender, provider, evaluator, expiredAt, hook);
    }

    /// @inheritdoc IERC8183
    function setProvider(uint256 jobId, address provider, bytes calldata optParams) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (msg.sender != j.client) revert NotClient();
        if (j.status != JobStatus.Open) revert WrongStatus(j.status);
        if (provider == address(0)) revert ZeroAddress();
        bytes memory data = abi.encode(provider, optParams);
        _before(j, this.setProvider.selector, data);
        j.provider = provider;
        emit ProviderSet(jobId, provider);
        _after(j, this.setProvider.selector, data);
    }

    /// @inheritdoc IERC8183
    function setBudget(uint256 jobId, uint256 amount, bytes calldata optParams) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (msg.sender != j.client) revert NotClient();
        if (j.status != JobStatus.Open) revert WrongStatus(j.status);
        bytes memory data = abi.encode(amount, optParams);
        _before(j, this.setBudget.selector, data);
        j.budget = amount;
        emit BudgetSet(jobId, amount);
        _after(j, this.setBudget.selector, data);
    }

    /// @inheritdoc IERC8183
    function fund(uint256 jobId, uint256 expectedBudget, bytes calldata optParams) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (msg.sender != j.client) revert NotClient();
        if (j.status != JobStatus.Open) revert WrongStatus(j.status);
        if (j.budget != expectedBudget || j.budget == 0) revert BudgetMismatch(expectedBudget, j.budget);
        if (j.provider == address(0)) revert ProviderNotSet();
        if (block.timestamp >= j.expiredAt) revert Expired();
        _before(j, this.fund.selector, optParams);
        j.status = JobStatus.Funded;
        IERC20(address(_token)).safeTransferFrom(msg.sender, address(this), j.budget);
        emit JobFunded(jobId, msg.sender, j.budget);
        _after(j, this.fund.selector, optParams);
    }

    /// @inheritdoc IERC8183
    function submit(uint256 jobId, bytes32 deliverable, bytes calldata optParams) external nonReentrant {
        Job storage j = _jobs[jobId];
        JobExt storage e = _ext[jobId];
        _checkSubmittable(j, e);
        bytes memory data = abi.encode(deliverable, optParams);
        _before(j, this.submit.selector, data);
        _markSubmitted(j, e, deliverable);
        _after(j, this.submit.selector, data);
    }

    /// @inheritdoc IERC8183
    function complete(uint256 jobId, bytes32 reason, bytes calldata optParams) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (msg.sender != j.evaluator) revert NotEvaluator();
        if (j.status != JobStatus.Submitted) revert WrongStatus(j.status);
        bytes memory data = abi.encode(reason, optParams);
        _before(j, this.complete.selector, data);
        _complete(jobId, msg.sender, reason);
        _after(j, this.complete.selector, data);
    }

    /// @inheritdoc IERC8183
    function reject(uint256 jobId, bytes32 reason, bytes calldata optParams) external nonReentrant {
        Job storage j = _jobs[jobId];
        bytes memory data = abi.encode(reason, optParams);
        if (j.status == JobStatus.Open) {
            if (msg.sender != j.client) revert NotClient();
            _before(j, this.reject.selector, data);
            j.status = JobStatus.Rejected;
            emit JobRejected(jobId, msg.sender, reason);
            _after(j, this.reject.selector, data);
            return;
        }
        if (j.status != JobStatus.Funded && j.status != JobStatus.Submitted) revert WrongStatus(j.status);
        if (msg.sender != j.evaluator) revert NotEvaluator();
        JobExt storage e = _ext[jobId];
        if (e.openChildren != 0) revert ChildrenOpen(e.openChildren);
        _before(j, this.reject.selector, data);
        // A provider who accepted and then gets rejected loses its bond to the payer.
        _fail(jobId, JobStatus.Rejected, e.accepted);
        emit JobRejected(jobId, msg.sender, reason);
        _after(j, this.reject.selector, data);
    }

    /// @inheritdoc IERC8183
    /// @dev Not hookable. A Submitted job whose unchallenged window has passed is completed
    ///      (finalized) instead of refunded, so an honest provider can't be robbed at expiry.
    function claimRefund(uint256 jobId) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (j.status != JobStatus.Funded && j.status != JobStatus.Submitted) revert WrongStatus(j.status);
        JobExt storage e = _ext[jobId];
        if (_finalizable(j, e)) {
            _finalize(jobId);
            return;
        }
        if (block.timestamp < j.expiredAt) revert NotExpired();
        if (e.openChildren != 0) revert ChildrenOpen(e.openChildren);
        _expire(jobId);
    }

    /// @inheritdoc IERC8183
    function getJob(uint256 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    // ------------------------------------------------------ gasless funding

    /// @inheritdoc IChainworkEscrow
    function termsHash(address client, JobTerms calldata terms) public view returns (bytes32) {
        return keccak256(abi.encode(TERMS_TYPEHASH, block.chainid, address(this), client, terms));
    }

    /// @inheritdoc IChainworkEscrow
    function fundWithAuthorization(
        address client,
        JobTerms calldata terms,
        string calldata description,
        uint256 validAfter,
        uint256 validBefore,
        bytes calldata signature
    ) external nonReentrant returns (uint256 jobId) {
        if (client == address(0) || terms.provider == address(0) || terms.evaluator == address(0)) {
            revert ZeroAddress();
        }
        if (terms.budget == 0) revert BadTerms();
        if (terms.expiredAt <= block.timestamp) revert Expired();
        if (keccak256(bytes(description)) != terms.descriptionHash) revert BadTerms();
        _checkWindow(terms.challengeWindow);

        jobId = _createFromTerms(client, terms, description);
        Job storage j = _jobs[jobId];
        bytes memory data = abi.encode(client, terms.budget);
        _before(j, this.fund.selector, data);
        j.status = JobStatus.Funded;
        _receive(client, terms, validAfter, validBefore, signature);
        emit JobFunded(jobId, client, terms.budget);
        _after(j, this.fund.selector, data);
    }

    function _createFromTerms(address client, JobTerms calldata terms, string calldata description)
        private
        returns (uint256 jobId)
    {
        jobId = ++jobCount;
        Job storage j = _jobs[jobId];
        j.id = jobId;
        j.client = client;
        j.provider = terms.provider;
        j.evaluator = terms.evaluator;
        j.description = description;
        j.budget = terms.budget;
        j.expiredAt = terms.expiredAt;
        j.status = JobStatus.Open;
        j.hook = terms.hook;
        JobExt storage e = _ext[jobId];
        e.verifier = terms.verifier;
        e.verifierSpec = terms.verifierSpec;
        e.challengeWindow = terms.challengeWindow;
        emit JobCreated(jobId, client, terms.provider, terms.evaluator, terms.expiredAt, terms.hook);
    }

    /// @dev The nonce binds every term: a relayer cannot change provider, evaluator, verifier,
    ///      hook, deadline, window, budget or description without invalidating the signature.
    ///      receiveWithAuthorization requires msg.sender == to, so it cannot be front-run.
    function _receive(
        address client,
        JobTerms calldata terms,
        uint256 validAfter,
        uint256 validBefore,
        bytes calldata signature
    ) private {
        bytes32 nonce = termsHash(client, terms);
        _token.receiveWithAuthorization(client, address(this), terms.budget, validAfter, validBefore, nonce, signature);
    }

    // ------------------------------------------------------ provider actions

    /// @inheritdoc IChainworkEscrow
    function acceptJob(uint256 jobId, uint256 permitDeadline, bytes calldata permitSignature)
        external
        nonReentrant
    {
        Job storage j = _jobs[jobId];
        JobExt storage e = _ext[jobId];
        if (j.status != JobStatus.Funded) revert WrongStatus(j.status);
        if (msg.sender != j.provider) revert NotProvider();
        if (e.accepted) revert AlreadyAccepted();
        if (block.timestamp >= j.expiredAt) revert Expired();
        uint256 bond = _rep.requiredBond(msg.sender, j.budget);
        e.accepted = true;
        e.bond = bond;
        if (bond > 0) _pull(msg.sender, bond, permitDeadline, permitSignature);
        emit JobAccepted(jobId, msg.sender, bond);
    }

    /// @inheritdoc IChainworkEscrow
    function createSubJob(uint256 parentId, SubJobTerms calldata t, string calldata description)
        external
        nonReentrant
        returns (uint256 childId)
    {
        Job storage p = _jobs[parentId];
        JobExt storage pe = _ext[parentId];
        if (p.status != JobStatus.Funded) revert WrongStatus(p.status);
        if (msg.sender != p.provider) revert NotProvider();
        if (!pe.accepted) revert NotAccepted();
        if (pe.depth >= MAX_DEPTH) revert DepthExceeded();
        if (block.timestamp >= p.expiredAt) revert Expired();
        if (pe.openChildren >= MAX_CHILDREN || _children[parentId].length >= MAX_TOTAL_CHILDREN) {
            revert TooManyChildren();
        }
        if (t.provider == address(0) || t.evaluator == address(0)) revert ZeroAddress();
        if (t.budget == 0) revert BadTerms();
        if (t.expiredAt >= p.expiredAt || t.expiredAt <= block.timestamp) revert ChildDeadlineTooLate();
        _checkWindow(t.challengeWindow);

        uint256 available = p.budget - pe.allocated;
        if (t.budget > available) revert ChildBudgetTooHigh(t.budget, available);
        uint256 limit = pe.bond + _rep.creditLimit(msg.sender);
        uint256 allocatedAfter = pe.allocated + t.budget;
        if (allocatedAfter > limit) revert CreditExceeded(allocatedAfter, limit);

        pe.allocated = allocatedAfter;
        pe.openChildren += 1;

        childId = ++jobCount;
        _children[parentId].push(childId);
        _jobs[childId] = Job({
            id: childId,
            client: msg.sender,
            provider: t.provider,
            evaluator: t.evaluator,
            description: description,
            budget: t.budget,
            expiredAt: t.expiredAt,
            status: JobStatus.Funded,
            hook: address(0)
        });
        JobExt storage ce = _ext[childId];
        ce.parentId = parentId;
        ce.depth = pe.depth + 1;
        ce.verifier = t.verifier;
        ce.verifierSpec = t.verifierSpec;
        ce.challengeWindow = t.challengeWindow;

        emit JobCreated(childId, msg.sender, t.provider, t.evaluator, t.expiredAt, address(0));
        emit SubJobCreated(parentId, childId, t.provider, t.budget);
        emit JobFunded(childId, msg.sender, t.budget);
    }

    /// @inheritdoc IChainworkEscrow
    function submitWithProof(uint256 jobId, bytes32 deliverable, bytes calldata proof) external nonReentrant {
        Job storage j = _jobs[jobId];
        JobExt storage e = _ext[jobId];
        if (e.verifier == address(0)) revert NoVerifier();
        _checkSubmittable(j, e);
        if (!IVerifier(e.verifier).verify(jobId, e.verifierSpec, deliverable, proof)) revert VerifierRejected();
        _markSubmitted(j, e, deliverable);
        _complete(jobId, e.verifier, REASON_VERIFIER);
    }

    // ------------------------------------------------- optimistic challenges

    /// @inheritdoc IChainworkEscrow
    function challenge(uint256 jobId, bytes32 reason, uint256 permitDeadline, bytes calldata permitSignature)
        external
        nonReentrant
    {
        Job storage j = _jobs[jobId];
        JobExt storage e = _ext[jobId];
        if (j.status != JobStatus.Submitted) revert WrongStatus(j.status);
        if (e.challengeWindow == 0) revert NoWindow();
        if (e.challenged) revert AlreadyChallenged();
        if (block.timestamp >= uint256(e.submittedAt) + e.challengeWindow) revert WindowClosed();
        if (msg.sender == j.provider) revert NotClient();
        uint256 bond = challengeBondFor(j.budget);
        e.challenged = true;
        e.challenger = msg.sender;
        e.challengeBond = bond;
        if (bond > 0) _pull(msg.sender, bond, permitDeadline, permitSignature);
        emit Challenged(jobId, msg.sender, bond, reason);
    }

    /// @inheritdoc IChainworkEscrow
    function finalize(uint256 jobId) external nonReentrant {
        Job storage j = _jobs[jobId];
        JobExt storage e = _ext[jobId];
        if (j.status != JobStatus.Submitted) revert WrongStatus(j.status);
        if (e.challengeWindow == 0) revert NoWindow();
        if (e.challenged) revert AlreadyChallenged();
        if (!_finalizable(j, e)) revert WindowOpen();
        _finalize(jobId);
    }

    /// @inheritdoc IChainworkEscrow
    function settleTree(uint256 rootId) external nonReentrant returns (uint256 nodesClosed) {
        JobExt storage re = _ext[rootId];
        if (rootId == 0 || rootId > jobCount || re.depth != 0) revert NotRoot();
        uint256[] storage kids = _children[rootId];
        for (uint256 i = 0; i < kids.length; i++) {
            if (_tryClose(kids[i])) nodesClosed++;
        }
        if (re.openChildren == 0 && _tryClose(rootId)) nodesClosed++;
        emit TreeSettled(rootId, nodesClosed);
    }

    // --------------------------------------------------------------- views

    /// @inheritdoc IChainworkEscrow
    function getJobExt(uint256 jobId) external view returns (JobExt memory) {
        return _ext[jobId];
    }

    /// @inheritdoc IChainworkEscrow
    function getChildren(uint256 parentId) external view returns (uint256[] memory) {
        return _children[parentId];
    }

    /// @inheritdoc IChainworkEscrow
    function getJobsPage(uint256 cursor, uint256 limit)
        external
        view
        returns (Job[] memory jobs, JobExt[] memory exts, uint256 nextCursor)
    {
        if (cursor == 0) cursor = 1;
        if (limit > MAX_PAGE) limit = MAX_PAGE;
        uint256 count = jobCount;
        if (cursor > count || limit == 0) return (new Job[](0), new JobExt[](0), 0);
        uint256 end = cursor + limit - 1;
        if (end > count) end = count;
        uint256 n = end - cursor + 1;
        jobs = new Job[](n);
        exts = new JobExt[](n);
        for (uint256 i = 0; i < n; i++) {
            jobs[i] = _jobs[cursor + i];
            exts[i] = _ext[cursor + i];
        }
        nextCursor = end < count ? end + 1 : 0;
    }

    /// @inheritdoc IChainworkEscrow
    function childrenRoot(uint256 parentId) external view returns (bytes32) {
        uint256[] storage kids = _children[parentId];
        bytes32[] memory layer = new bytes32[](kids.length);
        uint256 n;
        for (uint256 i = 0; i < kids.length; i++) {
            if (_jobs[kids[i]].status == JobStatus.Completed) layer[n++] = _ext[kids[i]].deliverable;
        }
        if (n == 0) return bytes32(0);
        while (n > 1) {
            uint256 m;
            for (uint256 i = 0; i < n; i += 2) {
                layer[m++] = i + 1 < n ? Hashes.commutativeKeccak256(layer[i], layer[i + 1]) : layer[i];
            }
            n = m;
        }
        return layer[0];
    }

    /// @inheritdoc IChainworkEscrow
    function maxSubcontract(uint256 parentId) external view returns (uint256) {
        Job storage p = _jobs[parentId];
        JobExt storage pe = _ext[parentId];
        if (p.status != JobStatus.Funded || !pe.accepted || pe.depth >= MAX_DEPTH) return 0;
        uint256 byBudget = p.budget - pe.allocated;
        uint256 limit = pe.bond + _rep.creditLimit(p.provider);
        uint256 byCredit = limit > pe.allocated ? limit - pe.allocated : 0;
        return byBudget < byCredit ? byBudget : byCredit;
    }

    // ------------------------------------------------------------ internal

    function _checkWindow(uint64 w) private pure {
        if (w != 0 && (w < MIN_CHALLENGE_WINDOW || w > MAX_CHALLENGE_WINDOW)) revert BadWindow();
    }

    function _checkSubmittable(Job storage j, JobExt storage e) private view {
        if (j.status != JobStatus.Funded) revert WrongStatus(j.status);
        if (msg.sender != j.provider) revert NotProvider();
        if (!e.accepted) revert NotAccepted();
        if (e.openChildren != 0) revert ChildrenOpen(e.openChildren);
        if (block.timestamp >= j.expiredAt) revert Expired();
        if (block.timestamp + e.challengeWindow >= j.expiredAt) revert SubmitTooLate();
    }

    function _markSubmitted(Job storage j, JobExt storage e, bytes32 deliverable) private {
        e.deliverable = deliverable;
        e.submittedAt = uint64(block.timestamp);
        j.status = JobStatus.Submitted;
        emit JobSubmitted(j.id, j.provider, deliverable);
    }

    function _finalizable(Job storage j, JobExt storage e) private view returns (bool) {
        return j.status == JobStatus.Submitted && e.challengeWindow != 0 && !e.challenged
            && block.timestamp >= uint256(e.submittedAt) + e.challengeWindow;
    }

    function _finalize(uint256 jobId) private {
        emit Finalized(jobId);
        _complete(jobId, address(0), REASON_WINDOW);
    }

    /// @dev Closes a node if anything can close it now; never reverts. Used by settleTree.
    function _tryClose(uint256 jobId) private returns (bool) {
        Job storage j = _jobs[jobId];
        JobExt storage e = _ext[jobId];
        if (j.status != JobStatus.Funded && j.status != JobStatus.Submitted) return false;
        if (_finalizable(j, e)) {
            _finalize(jobId);
            return true;
        }
        if (block.timestamp >= j.expiredAt && e.openChildren == 0) {
            _expire(jobId);
            return true;
        }
        return false;
    }

    /// @dev Pays the provider (budget for a child; budget minus paid-to-children for a root),
    ///      returns its bond, routes any challenge bond to the provider, records reputation.
    function _complete(uint256 jobId, address by, bytes32 reason) private {
        Job storage j = _jobs[jobId];
        JobExt storage e = _ext[jobId];
        j.status = JobStatus.Completed;

        uint256 pay;
        if (e.depth == 0) {
            pay = j.budget - e.paidToChildren;
        } else {
            pay = j.budget;
            JobExt storage pe = _ext[e.parentId];
            pe.paidToChildren += j.budget;
            pe.openChildren -= 1;
        }
        uint256 bond = e.bond;
        uint256 cBond = e.challengeBond;
        e.bond = 0;
        e.challengeBond = 0;

        _rep.recordOutcome(j.provider, jobId, true, e.submittedAt < j.expiredAt, j.budget, 0);
        emit JobCompleted(jobId, by, reason);

        IERC20 t = IERC20(address(_token));
        if (pay > 0) {
            t.safeTransfer(j.provider, pay);
            emit PaymentReleased(jobId, j.provider, pay);
        }
        if (bond > 0) {
            t.safeTransfer(j.provider, bond);
            emit BondReturned(jobId, j.provider, bond);
        }
        if (cBond > 0) {
            // The challenge failed: the challenger's bond compensates the provider for the delay.
            t.safeTransfer(j.provider, cBond);
            emit ChallengeBondSettled(jobId, j.provider, cBond);
        }
    }

    function _expire(uint256 jobId) private {
        Job storage j = _jobs[jobId];
        JobExt storage e = _ext[jobId];
        // Slash only a provider that accepted and never delivered. If it delivered and the
        // evaluator stayed silent past expiry, the provider keeps its bond.
        bool slash = e.accepted && j.status == JobStatus.Funded;
        _fail(jobId, JobStatus.Expired, slash);
        emit JobExpired(jobId);
    }

    /// @dev Rejected or Expired. Root: refund the client what children did not consume.
    ///      Child: return its budget to the parent pool. Bond goes to the payer if slashed,
    ///      otherwise back to the provider. A pending challenge bond returns to the challenger.
    function _fail(uint256 jobId, JobStatus status, bool slash) private {
        Job storage j = _jobs[jobId];
        JobExt storage e = _ext[jobId];
        j.status = status;

        address payer;
        uint256 refund;
        if (e.depth == 0) {
            payer = j.client;
            refund = j.budget - e.paidToChildren;
        } else {
            payer = j.client; // the parent's provider
            JobExt storage pe = _ext[e.parentId];
            pe.allocated -= j.budget;
            pe.openChildren -= 1;
            emit ChildBudgetReturned(e.parentId, jobId, j.budget);
        }
        uint256 bond = e.bond;
        uint256 cBond = e.challengeBond;
        address challenger = e.challenger;
        e.bond = 0;
        e.challengeBond = 0;

        if (slash) _rep.recordOutcome(j.provider, jobId, false, false, 0, bond);

        IERC20 t = IERC20(address(_token));
        if (refund > 0) {
            t.safeTransfer(payer, refund);
            emit Refunded(jobId, payer, refund);
        }
        if (bond > 0) {
            if (slash) {
                t.safeTransfer(payer, bond);
                emit BondSlashed(jobId, j.provider, payer, bond);
            } else {
                t.safeTransfer(j.provider, bond);
                emit BondReturned(jobId, j.provider, bond);
            }
        }
        if (cBond > 0) {
            t.safeTransfer(challenger, cBond);
            emit ChallengeBondSettled(jobId, challenger, cBond);
        }
    }

    /// @dev Pulls `amount` from `from`, using an EIP-2612 permit (EOA or ERC-1271) when given.
    ///      A permit that was already used (e.g. front-run) falls back to the existing allowance.
    function _pull(address from, uint256 amount, uint256 deadline, bytes calldata sig) private {
        if (sig.length != 0) {
            try _token.permit(from, address(this), amount, deadline, sig) {} catch {}
        }
        IERC20(address(_token)).safeTransferFrom(from, address(this), amount);
    }

    function _before(Job storage j, bytes4 selector, bytes memory data) private {
        if (j.hook != address(0)) IACPHook(j.hook).beforeAction(j.id, selector, data);
    }

    function _after(Job storage j, bytes4 selector, bytes memory data) private {
        if (j.hook != address(0)) IACPHook(j.hook).afterAction(j.id, selector, data);
    }
}
