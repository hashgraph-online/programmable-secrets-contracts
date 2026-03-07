// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AccessReceipt} from "../src/AccessReceipt.sol";
import {PaymentModule} from "../src/PaymentModule.sol";
import {PolicyVault} from "../src/PolicyVault.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("ETH_PK");
        address deployer = address(uint160(vm.envUint("DEPLOYER_ADDRESS")));
        address requestedOwner = address(uint160(vm.envUint("CONTRACT_OWNER")));
        address identityRegistryAddress = address(uint160(vm.envUint("IDENTITY_REGISTRY_ADDRESS")));

        vm.startBroadcast(deployerPrivateKey);
        address policyVaultImplementation = address(new PolicyVault());
        PolicyVault deployedPolicyVault = PolicyVault(
            address(new ERC1967Proxy(policyVaultImplementation, abi.encodeCall(PolicyVault.initialize, (deployer))))
        );
        AccessReceipt deployedAccessReceipt = new AccessReceipt(deployer);

        address paymentModuleImplementation = address(new PaymentModule());
        PaymentModule deployedPaymentModule = PaymentModule(
            address(
                new ERC1967Proxy(
                    paymentModuleImplementation,
                    abi.encodeCall(
                        PaymentModule.initialize,
                        (deployer, address(deployedPolicyVault), address(deployedAccessReceipt))
                    )
                )
            )
        );
        deployedAccessReceipt.setPaymentModule(address(deployedPaymentModule));

        if (requestedOwner != deployer) {
            deployedPolicyVault.transferOwnership(requestedOwner);
            deployedPaymentModule.transferOwnership(requestedOwner);
            deployedAccessReceipt.transferOwnership(requestedOwner);
        }
        identityRegistryAddress;
        vm.stopBroadcast();
    }
}
