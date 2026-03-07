// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AccessReceipt} from "../src/AccessReceipt.sol";
import {AddressAllowlistCondition} from "../src/AddressAllowlistCondition.sol";
import {PaymentModule} from "../src/PaymentModule.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {TimeRangeCondition} from "../src/TimeRangeCondition.sol";
import {UaidOwnershipCondition} from "../src/UaidOwnershipCondition.sol";

contract Deploy is Script {
    bytes32 internal constant DEFAULT_POLICY_VAULT_IMPLEMENTATION_SALT =
        keccak256("programmable-secrets-policy-vault-implementation-v1");
    bytes32 internal constant DEFAULT_POLICY_VAULT_PROXY_SALT = keccak256("programmable-secrets-policy-vault-proxy-v1");
    bytes32 internal constant DEFAULT_PAYMENT_MODULE_IMPLEMENTATION_SALT =
        keccak256("programmable-secrets-payment-module-implementation-v1");
    bytes32 internal constant DEFAULT_PAYMENT_MODULE_PROXY_SALT =
        keccak256("programmable-secrets-payment-module-proxy-v1");
    bytes32 internal constant DEFAULT_ACCESS_RECEIPT_SALT = keccak256("programmable-secrets-access-receipt-v1");
    bytes32 internal constant DEFAULT_ACCESS_RECEIPT_V2_SALT = keccak256("programmable-secrets-access-receipt-v2");

    function run() external virtual {
        uint256 deployerPrivateKey = vm.envUint("ETH_PK");
        address deployer = address(uint160(vm.envUint("DEPLOYER_ADDRESS")));
        address requestedOwner = address(uint160(vm.envUint("CONTRACT_OWNER")));
        address identityRegistryAddress = address(uint160(vm.envUint("IDENTITY_REGISTRY_ADDRESS")));
        _deploy(deployerPrivateKey, deployer, requestedOwner, identityRegistryAddress, false);
    }

    function _deploy(
        uint256 deployerPrivateKey,
        address deployer,
        address requestedOwner,
        address identityRegistryAddress,
        bool useCreate2
    ) internal {
        bytes32 policyVaultImplementationSalt = DEFAULT_POLICY_VAULT_IMPLEMENTATION_SALT;
        bytes32 policyVaultProxySalt = DEFAULT_POLICY_VAULT_PROXY_SALT;
        bytes32 paymentModuleImplementationSalt = DEFAULT_PAYMENT_MODULE_IMPLEMENTATION_SALT;
        bytes32 paymentModuleProxySalt = DEFAULT_PAYMENT_MODULE_PROXY_SALT;
        bytes32 accessReceiptSalt = DEFAULT_ACCESS_RECEIPT_SALT;

        vm.startBroadcast(deployerPrivateKey);
        address policyVaultImplementation;
        PolicyVault deployedPolicyVault;
        AccessReceipt deployedAccessReceipt;
        AddressAllowlistCondition deployedAddressAllowlistCondition;
        address paymentModuleImplementation;
        PaymentModule deployedPaymentModule;
        TimeRangeCondition deployedTimeRangeCondition;
        UaidOwnershipCondition deployedUaidOwnershipCondition;

        if (useCreate2) {
            policyVaultImplementation = address(new PolicyVault{salt: policyVaultImplementationSalt}());
            deployedPolicyVault = PolicyVault(
                address(
                    new ERC1967Proxy{salt: policyVaultProxySalt}(
                        policyVaultImplementation, abi.encodeCall(PolicyVault.initialize, (deployer))
                    )
                )
            );
            deployedAccessReceipt = new AccessReceipt{salt: accessReceiptSalt}(deployer);
            deployedTimeRangeCondition = new TimeRangeCondition();
            deployedUaidOwnershipCondition = new UaidOwnershipCondition();
            deployedAddressAllowlistCondition = new AddressAllowlistCondition();
            paymentModuleImplementation = address(new PaymentModule{salt: paymentModuleImplementationSalt}());
            deployedPaymentModule = PaymentModule(
                address(
                    new ERC1967Proxy{salt: paymentModuleProxySalt}(
                        paymentModuleImplementation,
                        abi.encodeCall(
                            PaymentModule.initialize,
                            (deployer, address(deployedPolicyVault), address(deployedAccessReceipt))
                        )
                    )
                )
            );
        } else {
            policyVaultImplementation = address(new PolicyVault());
            deployedPolicyVault = PolicyVault(
                address(new ERC1967Proxy(policyVaultImplementation, abi.encodeCall(PolicyVault.initialize, (deployer))))
            );
            deployedAccessReceipt = new AccessReceipt(deployer);
            deployedTimeRangeCondition = new TimeRangeCondition();
            deployedUaidOwnershipCondition = new UaidOwnershipCondition();
            deployedAddressAllowlistCondition = new AddressAllowlistCondition();
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
        }
        deployedAccessReceipt.setPaymentModule(address(deployedPaymentModule));
        deployedPolicyVault.registerBuiltInEvaluator(
            address(deployedTimeRangeCondition), keccak256("builtin:time-range")
        );
        deployedPolicyVault.registerBuiltInEvaluator(
            address(deployedUaidOwnershipCondition), keccak256("builtin:uaid-ownership")
        );
        deployedPolicyVault.registerBuiltInEvaluator(
            address(deployedAddressAllowlistCondition), keccak256("builtin:address-allowlist")
        );

        if (requestedOwner != deployer) {
            deployedPolicyVault.transferOwnership(requestedOwner);
            deployedPaymentModule.transferOwnership(requestedOwner);
            deployedAccessReceipt.transferOwnership(requestedOwner);
        }
        identityRegistryAddress;
        vm.stopBroadcast();
    }
}

contract DeployCreate2 is Deploy {
    function run() external override {
        uint256 deployerPrivateKey = vm.envUint("ETH_PK");
        address deployer = address(uint160(vm.envUint("DEPLOYER_ADDRESS")));
        address requestedOwner = address(uint160(vm.envUint("CONTRACT_OWNER")));
        address identityRegistryAddress = address(uint160(vm.envUint("IDENTITY_REGISTRY_ADDRESS")));
        _deploy(deployerPrivateKey, deployer, requestedOwner, identityRegistryAddress, true);
    }
}

contract RotateAccessReceiptCreate2 is Deploy {
    function run() external override {
        uint256 deployerPrivateKey = vm.envUint("ETH_PK");
        address deployer = address(uint160(vm.envUint("DEPLOYER_ADDRESS")));
        address paymentModuleAddress = address(uint160(vm.envUint("PAYMENT_MODULE_ADDRESS")));

        vm.startBroadcast(deployerPrivateKey);
        AccessReceipt deployedAccessReceipt = new AccessReceipt{salt: DEFAULT_ACCESS_RECEIPT_V2_SALT}(deployer);
        deployedAccessReceipt.setPaymentModule(paymentModuleAddress);
        PaymentModule(paymentModuleAddress).setAccessReceipt(address(deployedAccessReceipt));
        vm.stopBroadcast();
    }
}
