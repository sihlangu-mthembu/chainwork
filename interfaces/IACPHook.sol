// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ERC-8183 hook interface
/// @notice FROZEN (L0).
/// @dev Hookable selectors: setProvider, setBudget, fund, submit, complete, reject.
///      claimRefund is never hooked. `data` encoding per selector (from the spec):
///        setProvider: abi.encode(address provider, bytes optParams)
///        setBudget:   abi.encode(uint256 amount, bytes optParams)
///        fund:        optParams (raw bytes)
///        submit:      abi.encode(bytes32 deliverable, bytes optParams)
///        complete:    abi.encode(bytes32 reason, bytes optParams)
///        reject:      abi.encode(bytes32 reason, bytes optParams)
///      Chainwork's gasless path (fundWithAuthorization) calls the `fund` hooks with
///      optParams = abi.encode(address client, uint256 amount).
interface IACPHook {
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external;

    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
}
