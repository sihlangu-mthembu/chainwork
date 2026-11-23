// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IBudgetGuardHook} from "@chainwork/interfaces/IBudgetGuardHook.sol";
import {IACPHook} from "@chainwork/interfaces/IACPHook.sol";
import {IERC8183} from "@chainwork/interfaces/IERC8183.sol";

/// @title BudgetGuardHook
/// @notice Per-client budget caps and kill switch, enforced as an ERC-8183 hook on `fund`.
///         Works for any wallet type. Each client sets its own limits; nobody else can.
/// @dev Stateful half of the AgentAccount session model: AgentAccount reads spentToday() to
///      enforce a session's daily cap, and this hook increments it when the job is funded.
contract BudgetGuardHook is IBudgetGuardHook {
    address public immutable escrow;

    mapping(address client => Limits) private _limits;
    mapping(address client => mapping(uint256 day => uint256)) private _spent;

    constructor(address escrow_) {
        escrow = escrow_;
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IACPHook).interfaceId || id == 0x01ffc9a7; // IERC165
    }

    /// @inheritdoc IBudgetGuardHook
    function setLimits(uint128 perJob, uint128 perDay) external {
        Limits storage l = _limits[msg.sender];
        l.perJob = perJob;
        l.perDay = perDay;
        emit LimitsSet(msg.sender, perJob, perDay);
    }

    /// @inheritdoc IBudgetGuardHook
    function setFrozen(bool frozen_) external {
        _limits[msg.sender].frozen = frozen_;
        emit Frozen(msg.sender, frozen_);
    }

    /// @inheritdoc IBudgetGuardHook
    function limits(address client) external view returns (Limits memory) {
        return _limits[client];
    }

    /// @inheritdoc IBudgetGuardHook
    function spentToday(address client) external view returns (uint256) {
        return _spent[client][block.timestamp / 1 days];
    }

    /// @inheritdoc IACPHook
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata) external {
        if (msg.sender != escrow) revert OnlyEscrow();
        if (selector != IERC8183.fund.selector) return;
        IERC8183.Job memory j = IERC8183(escrow).getJob(jobId);
        Limits memory l = _limits[j.client];
        if (l.frozen) revert ClientFrozen(j.client);
        if (l.perJob != 0 && j.budget > l.perJob) revert OverPerJob(j.budget, l.perJob);
        uint256 day = block.timestamp / 1 days;
        uint256 spent = _spent[j.client][day];
        if (l.perDay != 0 && spent + j.budget > l.perDay) revert OverPerDay(spent, j.budget, l.perDay);
        _spent[j.client][day] = spent + j.budget;
    }

    /// @inheritdoc IACPHook
    function afterAction(uint256, bytes4, bytes calldata) external view {
        if (msg.sender != escrow) revert OnlyEscrow();
    }
}
