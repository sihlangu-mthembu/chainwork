// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IReputationRegistry} from "@chainwork/interfaces/IReputationRegistry.sol";

/// @title ReputationRegistry
/// @notice Reputation computed only from settled on-chain outcomes reported by the escrow.
///         It prices two things: the bond an agent posts to accept a job, and the credit it may
///         use to subcontract beyond that bond. No ratings, no self-reporting.
/// @dev Curve (all integer math, basis points):
///        successBps  = completed / (completed + failed)
///        onTimeBps   = onTime / completed
///        confidence  = min(completed, CONFIDENCE_JOBS) / CONFIDENCE_JOBS
///        score       = (7 * successBps + 3 * onTimeBps) / 10 * confidence
///        bondBps     = NEW_AGENT_BOND_BPS * (10000 - score) / 10000      (5000 new -> 0 proven)
///        credit      = valueCompleted * score / 10000 * CREDIT_MULTIPLIER_BPS / 10000
///                      - SLASH_PENALTY_MULTIPLIER * valueSlashed   (floored at 0, capped at MAX_CREDIT)
contract ReputationRegistry is IReputationRegistry {
    uint256 public constant NEW_AGENT_BOND_BPS = 5000;
    uint256 public constant CONFIDENCE_JOBS = 5;
    uint256 public constant CREDIT_MULTIPLIER_BPS = 20000; // 2x of reputation-weighted value delivered
    uint256 public constant SLASH_PENALTY_MULTIPLIER = 2;
    uint256 public constant MAX_CREDIT = 1_000_000; // 1.00 tUSD8 (6 decimals)

    address public immutable deployer;
    address public escrow;

    mapping(address agent => Stats) private _stats;

    error OnlyEscrow();
    error OnlyDeployer();
    error EscrowAlreadySet();

    constructor() {
        deployer = msg.sender;
    }

    /// @notice One-time wiring, done in the deploy script right after the escrow is deployed.
    function setEscrow(address escrow_) external {
        if (msg.sender != deployer) revert OnlyDeployer();
        if (escrow != address(0)) revert EscrowAlreadySet();
        escrow = escrow_;
    }

    /// @inheritdoc IReputationRegistry
    function recordOutcome(address agent, uint256 jobId, bool success, bool onTime, uint256 value, uint256 slashed)
        external
    {
        if (msg.sender != escrow) revert OnlyEscrow();
        Stats storage s = _stats[agent];
        if (success) {
            s.completed += 1;
            if (onTime) s.onTime += 1;
            s.valueCompleted += uint128(value);
        } else {
            s.failed += 1;
            s.valueSlashed += uint128(slashed);
        }
        emit OutcomeRecorded(agent, jobId, success, onTime, value, slashed);
    }

    /// @inheritdoc IReputationRegistry
    function stats(address agent) external view returns (Stats memory) {
        return _stats[agent];
    }

    /// @inheritdoc IReputationRegistry
    function score(address agent) public view returns (uint256) {
        Stats memory s = _stats[agent];
        uint256 total = uint256(s.completed) + uint256(s.failed);
        if (total == 0 || s.completed == 0) return 0;
        uint256 successBps = uint256(s.completed) * 10_000 / total;
        uint256 onTimeBps = uint256(s.onTime) * 10_000 / uint256(s.completed);
        uint256 jobs = s.completed < CONFIDENCE_JOBS ? s.completed : CONFIDENCE_JOBS;
        uint256 raw = (7 * successBps + 3 * onTimeBps) / 10;
        return raw * jobs / CONFIDENCE_JOBS;
    }

    /// @inheritdoc IReputationRegistry
    function bondBps(address agent) public view returns (uint256) {
        return NEW_AGENT_BOND_BPS * (10_000 - score(agent)) / 10_000;
    }

    /// @inheritdoc IReputationRegistry
    function requiredBond(address agent, uint256 budget) external view returns (uint256) {
        return budget * bondBps(agent) / 10_000;
    }

    /// @inheritdoc IReputationRegistry
    function creditLimit(address agent) external view returns (uint256) {
        Stats memory s = _stats[agent];
        uint256 earned = uint256(s.valueCompleted) * score(agent) / 10_000 * CREDIT_MULTIPLIER_BPS / 10_000;
        uint256 penalty = SLASH_PENALTY_MULTIPLIER * uint256(s.valueSlashed);
        if (penalty >= earned) return 0;
        uint256 credit = earned - penalty;
        return credit > MAX_CREDIT ? MAX_CREDIT : credit;
    }

    /// @inheritdoc IReputationRegistry
    function getSummary(address agent) external view returns (uint64 count, uint8 averageScore) {
        Stats memory s = _stats[agent];
        count = s.completed + s.failed;
        averageScore = uint8(score(agent) / 100);
    }
}
