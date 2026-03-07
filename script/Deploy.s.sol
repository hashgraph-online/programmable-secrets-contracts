// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AccessReceipt} from "../src/AccessReceipt.sol";
import {PaymentModule} from "../src/PaymentModule.sol";
import {PolicyVault} from "../src/PolicyVault.sol";

contract Deploy is Script {
    function run()
        external
        returns (
            PolicyVault deployedPolicyVault,
            PaymentModule deployedPaymentModule,
            AccessReceipt deployedAccessReceipt,
            address policyVaultImplementation,
            address paymentModuleImplementation,
            address deployer,
            address requestedOwner
        )
    {
        uint256 deployerPrivateKey = vm.envUint("ETH_PK");
        deployer = address(uint160(vm.envUint("DEPLOYER_ADDRESS")));
        requestedOwner = address(uint160(vm.envUint("CONTRACT_OWNER")));

        vm.startBroadcast(deployerPrivateKey);
        policyVaultImplementation = address(new PolicyVault());
        deployedPolicyVault = PolicyVault(
            address(new ERC1967Proxy(policyVaultImplementation, abi.encodeCall(PolicyVault.initialize, (deployer))))
        );
        deployedAccessReceipt = new AccessReceipt(deployer);

        paymentModuleImplementation = address(new PaymentModule());
        deployedPaymentModule = PaymentModule(
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
        vm.stopBroadcast();
    }
}
