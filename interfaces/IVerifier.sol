// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title On-chain verifier plug-in
/// @notice FROZEN (L0). A job whose `verifier` is set can be completed instantly by
///         submitWithProof when verify() returns true. No evaluator involved.
/// @dev `spec` is the job's verifierSpec, fixed in the signed job terms. Examples:
///      - HashVerifier: spec = expected keccak256 of the output; proof unused.
///      - SignedDataVerifier: spec = bytes32(uint256(uint160(requiredSigner)));
///        proof = signature by that signer over keccak256(abi.encode(chainid, escrow, jobId, deliverable)).
///      Must be view and must not depend on msg.sender.
interface IVerifier {
    function verify(uint256 jobId, bytes32 spec, bytes32 deliverable, bytes calldata proof)
        external
        view
        returns (bool ok);
}
