// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IAgentAccount} from "@chainwork/interfaces/IAgentAccount.sol";
import {IChainworkEscrow} from "@chainwork/interfaces/IChainworkEscrow.sol";
import {IBudgetGuardHook} from "@chainwork/interfaces/IBudgetGuardHook.sol";
import {IFiatTokenV2_2} from "@chainwork/interfaces/IFiatTokenV2_2.sol";

/// @title AgentAccount
/// @notice Minimal ERC-1271 smart account for a client agent with least-privilege session keys.
///         See IAgentAccount for the scope a session key is limited to.
contract AgentAccount is IAgentAccount {
    bytes4 private constant MAGIC = 0x1626ba7e;
    bytes4 private constant INVALID = 0xffffffff;
    bytes32 private constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    address public immutable owner;
    address public immutable escrow;
    address public immutable budgetGuard;
    address public immutable token;
    bool public frozen;

    mapping(address key => Session) private _sessions;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_, address escrow_, address budgetGuard_, address token_) {
        owner = owner_;
        escrow = escrow_;
        budgetGuard = budgetGuard_;
        token = token_;
    }

    receive() external payable {}

    function sessions(address key) external view returns (Session memory) {
        return _sessions[key];
    }

    function addSession(address key, uint64 validUntil, uint128 perJobCap, uint128 dailyCap) external onlyOwner {
        _sessions[key] = Session({validUntil: validUntil, perJobCap: perJobCap, dailyCap: dailyCap, active: true});
        emit SessionAdded(key, validUntil, perJobCap, dailyCap);
    }

    function revokeSession(address key) external onlyOwner {
        _sessions[key].active = false;
        emit SessionRevoked(key);
    }

    function setFrozen(bool frozen_) external onlyOwner {
        frozen = frozen_;
        emit FrozenSet(frozen_);
    }

    function execute(address to, uint256 value, bytes calldata data) external onlyOwner returns (bytes memory) {
        (bool ok, bytes memory ret) = to.call{value: value}(data);
        if (!ok) revert CallFailed(ret);
        emit Executed(to, value, data);
        return ret;
    }

    /// @inheritdoc IAgentAccount
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        if (frozen) return INVALID;
        if (signature.length == 65) {
            (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
            return (err == ECDSA.RecoverError.NoError && signer == owner) ? MAGIC : INVALID;
        }
        return _validSession(hash, signature) ? MAGIC : INVALID;
    }

    function _validSession(bytes32 hash, bytes calldata signature) private view returns (bool) {
        SessionAuth memory a = abi.decode(signature, (SessionAuth));
        Session memory s = _sessions[a.key];
        if (!s.active || block.timestamp >= s.validUntil || a.validBefore > s.validUntil) return false;
        if (a.value != a.terms.budget || a.value > s.perJobCap) return false;
        if (a.terms.hook != budgetGuard) return false;
        // The escrow runs the BudgetGuard `fund` hook (which adds this job to spentToday) before
        // tUSD8 asks us to validate the signature, and a session signature can only be spent through
        // that path (to == escrow, hook == budgetGuard). So spentToday already includes a.value here.
        if (IBudgetGuardHook(budgetGuard).spentToday(address(this)) > s.dailyCap) return false;

        bytes32 nonce = IChainworkEscrow(escrow).termsHash(address(this), a.terms);
        bytes32 structHash =
            keccak256(abi.encode(RECEIVE_TYPEHASH, address(this), escrow, a.value, a.validAfter, a.validBefore, nonce));
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", IFiatTokenV2_2(token).DOMAIN_SEPARATOR(), structHash));
        if (digest != hash) return false;

        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, a.keySignature);
        return err == ECDSA.RecoverError.NoError && signer == a.key;
    }
}
