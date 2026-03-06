// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

struct Log {
    bytes32[] topics;
    bytes data;
    address emitter;
}

interface Vm {
    function expectRevert(bytes4 revertData) external;
    function prank(address caller) external;
    function deal(address who, uint256 newBalance) external;
    function warp(uint256 newTimestamp) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory entries);
    function envUint(string calldata name) external returns (uint256 value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

