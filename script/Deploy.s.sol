// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {ProgrammableSecrets} from "../src/ProgrammableSecrets.sol";

contract Deploy is Script {
    function run() external returns (ProgrammableSecrets deployed) {
        vm.startBroadcast(vm.envUint("ETH_PK"));
        deployed = new ProgrammableSecrets();
        vm.stopBroadcast();
    }
}
