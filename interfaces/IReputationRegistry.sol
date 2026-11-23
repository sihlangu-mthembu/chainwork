// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Outcome-based reputation: prices bonds and sets subcontract credit
/// @notice FROZEN (L0). Only the escrow may write. Everything is derived from
///         settled on-chain outcomes; there are no ratings to fake.
interface IReputationRegistry {
    struct Stats {
        uint64 completed; // jobs completed as provider
        uint64 failed; // jobs rejected or expired as provider
        uint64 onTime; // completed jobs submitted before expiredAt
        uint128 valueCompleted; // tUSD8 base units earned on completed jobs
        uint128 valueSlashed; // tUSD8 base units of bond lost
    }

    event OutcomeRecorded(
        address indexed agent, uint256 indexed jobId, bool success, bool onTime, uint256 value, uint256 slashed
    );

    /// @dev onlyEscrow.
    function recordOutcome(address agent, uint256 jobId, bool success, bool onTime, uint256 value, uint256 slashed)
        external;

    function escrow() external view returns (address);

    function stats(address agent) external view returns (Stats memory);

    /// @return 0..10000 (basis points). New agents start at 0.
    function score(address agent) external view returns (uint256);

    /// @return bond rate in basis points of the job budget (e.g. 5000 for a new agent, 0 for a proven one).
    function bondBps(address agent) external view returns (uint256);

    /// @return bond in tUSD8 base units = budget * bondBps(agent) / 10000.
    function requiredBond(address agent, uint256 budget) external view returns (uint256);

    /// @return how much of a parent budget the agent may pass to children beyond its own bond (base units).
    function creditLimit(address agent) external view returns (uint256);

    /// @notice ERC-8004-shaped summary for UIs and future registry bridging (not the full ERC-8004 API).
    /// @return count settled jobs
    /// @return averageScore 0..100
    function getSummary(address agent) external view returns (uint64 count, uint8 averageScore);
}
