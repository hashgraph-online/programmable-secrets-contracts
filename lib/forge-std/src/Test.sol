// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "./Vm.sol";

abstract contract Test {
    Vm internal constant vm =
        Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertTrue(bool condition) internal pure {
        require(condition, "assertTrue failed");
    }

    function assertEqUint(uint256 left, uint256 right) internal pure {
        require(left == right, "assertEqUint failed");
    }

    function assertEqUint64(uint64 left, uint64 right) internal pure {
        require(left == right, "assertEqUint64 failed");
    }

    function assertEqAddress(address left, address right) internal pure {
        require(left == right, "assertEqAddress failed");
    }

    function assertEqBool(bool left, bool right) internal pure {
        require(left == right, "assertEqBool failed");
    }

    function assertEqBytes32(bytes32 left, bytes32 right) internal pure {
        require(left == right, "assertEqBytes32 failed");
    }
}
