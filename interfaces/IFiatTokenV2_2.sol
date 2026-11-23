// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Minimal tUSD8 (Circle FiatTokenV2_2 clone) surface used by Chainwork
/// @notice FROZEN (L0). Selectors verified live on Aevum on 2026-11-24 (see docs/CONTEXT.md).
///         The bytes-signature overloads accept EOA (65-byte) or ERC-1271 smart-wallet signatures.
interface IFiatTokenV2_2 {
    function balanceOf(address account) external view returns (uint256);

    function allowance(address owner, address spender) external view returns (uint256);

    function transfer(address to, uint256 value) external returns (bool);

    function transferFrom(address from, address to, uint256 value) external returns (bool);

    function approve(address spender, uint256 value) external returns (bool);

    /// @dev selector 0x88b7ab63. msg.sender must equal `to`.
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external;

    /// @dev selector 0xcf092995.
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) external;

    /// @dev selector 0x9fd5a6cf.
    function permit(address owner, address spender, uint256 value, uint256 deadline, bytes memory signature)
        external;

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);

    function nonces(address owner) external view returns (uint256);

    function DOMAIN_SEPARATOR() external view returns (bytes32);

    function isBlacklisted(address account) external view returns (bool);
}
