// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IVerifier} from "@chainwork/interfaces/IVerifier.sol";

/// @title HashVerifier
/// @notice Accepts a deliverable that equals the expected hash fixed in the job terms.
///         Use when the correct output is known in advance (e.g. a reproducible build artifact).
contract HashVerifier is IVerifier {
    function verify(uint256, bytes32 spec, bytes32 deliverable, bytes calldata) external pure returns (bool) {
        return spec != bytes32(0) && deliverable == spec;
    }
}
