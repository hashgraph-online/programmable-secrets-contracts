// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ProgrammableSecrets} from "../src/ProgrammableSecrets.sol";

contract Deploy is Script {
    function run() external returns (ProgrammableSecrets deployed, address implementation, address upgradeOwner) {
        uint256 deployerPrivateKey = vm.envUint("ETH_PK");
        upgradeOwner = address(uint160(vm.envUint("CONTRACT_OWNER")));

        vm.startBroadcast(deployerPrivateKey);
        implementation = address(new ProgrammableSecrets());
        deployed = ProgrammableSecrets(
            address(new ERC1967Proxy(implementation, abi.encodeCall(ProgrammableSecrets.initialize, (upgradeOwner))))
        );
        vm.stopBroadcast();
    }
}
