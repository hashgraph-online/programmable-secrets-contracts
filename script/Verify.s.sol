// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";

contract Verify is Script {
    function run() external returns (uint256 deployerPrivateKey) {
        deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
    }
}

