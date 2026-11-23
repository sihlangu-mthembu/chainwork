// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IChainworkEscrow} from "./IChainworkEscrow.sol";

/// @title Minimal ERC-1271 smart account for client agents, with scoped session keys
/// @notice FROZEN (L0, added 2026-11-24 after the official judging criteria named
///         "smart accounts, scoped sessions, budgets, and expiry").
///
/// A session key can authorize exactly one kind of signature: tUSD8 ReceiveWithAuthorization
/// from this account TO the Chainwork escrow, for job terms the account re-derives and checks:
///   - session active, not expired, account not frozen
///   - value == terms.budget <= session.perJobCap
///   - terms.hook == budgetGuard (so every spend is counted on-chain)
///   - budgetGuard.spentToday(this) <= session.dailyCap (the escrow's fund hook has already
///     added this job's value when tUSD8 calls isValidSignature)
///   - validBefore <= session.validUntil
/// Stateless checks live here (ERC-1271 is view); stateful accounting lives in BudgetGuardHook.
/// A prompt-injected agent holding a session key cannot pay anyone but the escrow, cannot exceed
/// its caps, and cannot outlive its expiry. The owner can revoke a key or freeze everything at once.
///
/// Post-quantum note: signature checking is isolated in isValidSignature, so a PQ validator can
/// replace ECDSA here without changing the escrow, the x402 scheme or tUSD8.
interface IAgentAccount {
    struct Session {
        uint64 validUntil; // unix seconds
        uint128 perJobCap; // base units
        uint128 dailyCap; // base units, checked against budgetGuard.spentToday(this)
        bool active;
    }

    /// @notice Encoding of a session-key signature passed to tUSD8 as `signature`.
    struct SessionAuth {
        address key;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        IChainworkEscrow.JobTerms terms;
        bytes keySignature; // 65-byte ECDSA by `key` over the EIP-712 digest tUSD8 asks about
    }

    event SessionAdded(address indexed key, uint64 validUntil, uint128 perJobCap, uint128 dailyCap);
    event SessionRevoked(address indexed key);
    event FrozenSet(bool frozen);
    event Executed(address indexed to, uint256 value, bytes data);

    error NotOwner();
    error CallFailed(bytes reason);

    function owner() external view returns (address);

    function escrow() external view returns (address);

    function budgetGuard() external view returns (address);

    function token() external view returns (address);

    function frozen() external view returns (bool);

    function sessions(address key) external view returns (Session memory);

    function addSession(address key, uint64 validUntil, uint128 perJobCap, uint128 dailyCap) external;

    function revokeSession(address key) external;

    function setFrozen(bool frozen) external;

    /// @notice Owner-only arbitrary call (withdraw, set BudgetGuard limits, etc.).
    function execute(address to, uint256 value, bytes calldata data) external returns (bytes memory);

    /// @notice ERC-1271. 65-byte signatures must come from the owner (and the account must not be
    ///         frozen); anything else is decoded as abi.encode(SessionAuth) and scope-checked.
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4);
}
