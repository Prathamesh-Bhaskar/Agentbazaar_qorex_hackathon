// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {QuantumReadyRegistry, IQorePqcKeyStatus} from "../src/QuantumReadyRegistry.sol";

/// @dev The precompile exists only on QoreChain, so these tests mock its answers.
contract QuantumReadyRegistryTest is Test {
    address constant PRECOMPILE = 0x0000000000000000000000000000000000000a02;
    address ready = makeAddr("ready");
    address classical = makeAddr("classical");

    function _answer(address account, bool registered, uint8 algorithmId, bytes memory key) internal {
        vm.mockCall(
            PRECOMPILE,
            abi.encodeCall(IQorePqcKeyStatus.pqcKeyStatus, (account)),
            abi.encode(registered, algorithmId, key)
        );
    }

    function _deploy() internal returns (QuantumReadyRegistry registry) {
        _answer(address(this), true, 1, hex"aa");
        registry = new QuantumReadyRegistry();
    }

    function test_deployerIsFirstEntry() public {
        QuantumReadyRegistry registry = _deploy();
        (uint64 at, uint8 algorithmId, bytes32 keyHash) = registry.entries(address(this));
        assertEq(at, block.timestamp);
        assertEq(algorithmId, 1);
        assertEq(keyHash, keccak256(hex"aa"));
    }

    function test_deployRevertsWithoutPqcKey() public {
        _answer(address(this), false, 0, "");
        vm.expectRevert(abi.encodeWithSelector(QuantumReadyRegistry.NotQuantumReady.selector, address(this)));
        new QuantumReadyRegistry();
    }

    function test_registerAndRefresh() public {
        QuantumReadyRegistry registry = _deploy();
        _answer(ready, true, 1, hex"bb");
        vm.expectEmit(address(registry));
        emit QuantumReadyRegistry.Registered(ready, 1, keccak256(hex"bb"));
        vm.prank(ready);
        registry.register();
        assertTrue(registry.isQuantumReady(ready));

        _answer(ready, true, 1, hex"cc");
        vm.prank(ready);
        registry.register();
        (,, bytes32 keyHash) = registry.entries(ready);
        assertEq(keyHash, keccak256(hex"cc"));
    }

    function test_classicalAccountCannotRegister() public {
        QuantumReadyRegistry registry = _deploy();
        _answer(classical, false, 0, "");
        assertFalse(registry.isQuantumReady(classical));
        vm.expectRevert(abi.encodeWithSelector(QuantumReadyRegistry.NotQuantumReady.selector, classical));
        vm.prank(classical);
        registry.register();
        (uint64 at,,) = registry.entries(classical);
        assertEq(at, 0);
    }
}
