// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ERC-8183 Agentic Commerce (draft) — core interface, prose-spec form
/// @notice FROZEN (L0). Changes need a PR reviewed by both lanes.
/// @dev Source: https://eips.ethereum.org/EIPS/eip-8183 . Where the prose spec and the
///      reference code differ we follow the prose spec (see docs/ERC8183.md):
///      - setProvider takes optParams
///      - fund takes expectedBudget (front-running protection)
interface IERC8183 {
    enum JobStatus {
        Open,
        Funded,
        Submitted,
        Completed,
        Rejected,
        Expired
    }

    struct Job {
        uint256 id;
        address client;
        address provider;
        address evaluator;
        string description;
        uint256 budget;
        uint256 expiredAt;
        JobStatus status;
        address hook;
    }

    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed provider,
        address evaluator,
        uint256 expiredAt,
        address hook
    );
    event ProviderSet(uint256 indexed jobId, address indexed provider);
    event BudgetSet(uint256 indexed jobId, uint256 amount);
    event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount);
    event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable);
    event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason);
    event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason);
    event JobExpired(uint256 indexed jobId);
    event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount);
    event Refunded(uint256 indexed jobId, address indexed client, uint256 amount);

    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) external returns (uint256 jobId);

    function setProvider(uint256 jobId, address provider, bytes calldata optParams) external;

    function setBudget(uint256 jobId, uint256 amount, bytes calldata optParams) external;

    /// @dev Reverts unless job.budget == expectedBudget.
    function fund(uint256 jobId, uint256 expectedBudget, bytes calldata optParams) external;

    function submit(uint256 jobId, bytes32 deliverable, bytes calldata optParams) external;

    function complete(uint256 jobId, bytes32 reason, bytes calldata optParams) external;

    function reject(uint256 jobId, bytes32 reason, bytes calldata optParams) external;

    /// @dev Valid when status is Funded or Submitted and block.timestamp >= expiredAt.
    ///      Callable by anyone. NOT hookable, so no hook can block a refund.
    function claimRefund(uint256 jobId) external;

    function getJob(uint256 jobId) external view returns (Job memory);
}
