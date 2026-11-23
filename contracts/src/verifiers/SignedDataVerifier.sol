// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IVerifier} from "@chainwork/interfaces/IVerifier.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title SignedDataVerifier
/// @notice Accepts a deliverable attested by a signer fixed in the job terms
///         (spec = bytes32(uint256(uint160(signer)))): an oracle, a data source, or a test runner.
///         The signer may be an EOA or an ERC-1271 contract.
/// @dev Signed message: EIP-191 personal_sign over keccak256(abi.encode(chainid, escrow, jobId, deliverable)).
contract SignedDataVerifier is IVerifier {
    address public immutable escrow;

    constructor(address escrow_) {
        escrow = escrow_;
    }

    function digest(uint256 jobId, bytes32 deliverable) public view returns (bytes32) {
        return MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encode(block.chainid, escrow, jobId, deliverable)));
    }

    function verify(uint256 jobId, bytes32 spec, bytes32 deliverable, bytes calldata proof)
        external
        view
        returns (bool)
    {
        address signer = address(uint160(uint256(spec)));
        if (signer == address(0)) return false;
        return SignatureChecker.isValidSignatureNow(signer, digest(jobId, deliverable), proof);
    }
}
