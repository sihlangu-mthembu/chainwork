// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IACPHook} from "./IACPHook.sol";

/// @title Client-side budget caps and kill switch, as an ERC-8183 hook
/// @notice FROZEN (L0). Enforced on `fund` for any wallet type (EOA or smart account).
///         Each client sets its own limits; nobody else can change them.
interface IBudgetGuardHook is IACPHook {
    struct Limits {
        uint128 perJob; // max budget per job, base units (0 = no limit)
        uint128 perDay; // max total funded per UTC day, base units (0 = no limit)
        bool frozen; // kill switch: when true every fund reverts
    }

    event LimitsSet(address indexed client, uint128 perJob, uint128 perDay);
    event Frozen(address indexed client, bool frozen);

    error OnlyEscrow();
    error ClientFrozen(address client);
    error OverPerJob(uint256 amount, uint256 limit);
    error OverPerDay(uint256 spentToday, uint256 amount, uint256 limit);

    function setLimits(uint128 perJob, uint128 perDay) external;

    function setFrozen(bool frozen) external;

    function limits(address client) external view returns (Limits memory);

    function spentToday(address client) external view returns (uint256);
}
