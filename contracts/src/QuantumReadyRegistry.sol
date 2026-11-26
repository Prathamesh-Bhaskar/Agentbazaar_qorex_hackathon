// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev QoreChain precompile that reports the post-quantum key an account has registered.
interface IQorePqcKeyStatus {
    function pqcKeyStatus(address account)
        external
        view
        returns (bool registered, uint8 algorithmId, bytes memory pubkey);
}

/// @title QuantumReadyRegistry
/// @notice A list that only accounts with a registered post-quantum key can join, checked on chain.
/// @dev Standalone: the job escrow does not read it. Joining records the key the account had at that moment;
///      `isQuantumReady` asks the chain again.
contract QuantumReadyRegistry {
    IQorePqcKeyStatus public constant PQC = IQorePqcKeyStatus(0x0000000000000000000000000000000000000a02);

    struct Entry {
        uint64 registeredAt;
        uint8 algorithmId;
        bytes32 keyHash;
    }

    mapping(address => Entry) public entries;

    error NotQuantumReady(address account);

    event Registered(address indexed account, uint8 algorithmId, bytes32 keyHash);

    /// @notice The deployer must pass the same check, and is the first entry.
    constructor() {
        _register(msg.sender);
    }

    /// @notice Join, or refresh the recorded key after rotating it.
    function register() external {
        _register(msg.sender);
    }

    function isQuantumReady(address account) external view returns (bool registered) {
        (registered,,) = PQC.pqcKeyStatus(account);
    }

    function _register(address account) private {
        (bool registered, uint8 algorithmId, bytes memory pubkey) = PQC.pqcKeyStatus(account);
        if (!registered) revert NotQuantumReady(account);
        bytes32 keyHash = keccak256(pubkey);
        entries[account] = Entry(uint64(block.timestamp), algorithmId, keyHash);
        emit Registered(account, algorithmId, keyHash);
    }
}
