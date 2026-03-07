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
    struct DeploymentContext {
        address policyVaultImplementation;
        PolicyVault policyVault;
        AccessReceipt accessReceipt;
        AddressAllowlistCondition addressAllowlistCondition;
        address paymentModuleImplementation;
        PaymentModule paymentModule;
        TimeRangeCondition timeRangeCondition;
        UaidOwnershipCondition uaidOwnershipCondition;
    }

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
        DeploymentContext memory deployed = useCreate2
            ? _deployCreate2Stack(
                deployer,
                policyVaultImplementationSalt,
                policyVaultProxySalt,
                paymentModuleImplementationSalt,
                paymentModuleProxySalt,
                accessReceiptSalt
            )
            : _deployStandardStack(deployer);

        _configureDeployment(deployed, deployer, requestedOwner);
        identityRegistryAddress;
        vm.stopBroadcast();
    }

    function _deployCreate2Stack(
        address deployer,
        bytes32 policyVaultImplementationSalt,
        bytes32 policyVaultProxySalt,
        bytes32 paymentModuleImplementationSalt,
        bytes32 paymentModuleProxySalt,
        bytes32 accessReceiptSalt
    ) internal returns (DeploymentContext memory deployed) {
        deployed.policyVaultImplementation = address(new PolicyVault{salt: policyVaultImplementationSalt}());
        deployed.policyVault = PolicyVault(
            address(
                new ERC1967Proxy{salt: policyVaultProxySalt}(
                    deployed.policyVaultImplementation, abi.encodeCall(PolicyVault.initialize, (deployer))
                )
            )
        );
        deployed.accessReceipt = new AccessReceipt{salt: accessReceiptSalt}(deployer);
        deployed.timeRangeCondition = new TimeRangeCondition();
        deployed.uaidOwnershipCondition = new UaidOwnershipCondition();
        deployed.addressAllowlistCondition = new AddressAllowlistCondition();
        deployed.paymentModuleImplementation = address(new PaymentModule{salt: paymentModuleImplementationSalt}());
        deployed.paymentModule = PaymentModule(
            address(
                new ERC1967Proxy{salt: paymentModuleProxySalt}(
                    deployed.paymentModuleImplementation,
                    abi.encodeCall(
                        PaymentModule.initialize,
                        (deployer, address(deployed.policyVault), address(deployed.accessReceipt))
                    )
                )
            )
        );
    }

    function _deployStandardStack(address deployer) internal returns (DeploymentContext memory deployed) {
        deployed.policyVaultImplementation = address(new PolicyVault());
        deployed.policyVault = PolicyVault(
            address(
                new ERC1967Proxy(deployed.policyVaultImplementation, abi.encodeCall(PolicyVault.initialize, (deployer)))
            )
        );
        deployed.accessReceipt = new AccessReceipt(deployer);
        deployed.timeRangeCondition = new TimeRangeCondition();
        deployed.uaidOwnershipCondition = new UaidOwnershipCondition();
        deployed.addressAllowlistCondition = new AddressAllowlistCondition();
        deployed.paymentModuleImplementation = address(new PaymentModule());
        deployed.paymentModule = PaymentModule(
            address(
                new ERC1967Proxy(
                    deployed.paymentModuleImplementation,
                    abi.encodeCall(
                        PaymentModule.initialize,
                        (deployer, address(deployed.policyVault), address(deployed.accessReceipt))
                    )
                )
            )
        );
    }

    function _configureDeployment(DeploymentContext memory deployed, address deployer, address requestedOwner)
        internal
    {
        deployed.accessReceipt.setPaymentModule(address(deployed.paymentModule));
        deployed.policyVault
            .registerBuiltInEvaluator(address(deployed.timeRangeCondition), keccak256("builtin:time-range"));
        deployed.policyVault
            .registerBuiltInEvaluator(address(deployed.uaidOwnershipCondition), keccak256("builtin:uaid-ownership"));
        deployed.policyVault
            .registerBuiltInEvaluator(
                address(deployed.addressAllowlistCondition), keccak256("builtin:address-allowlist")
            );

        if (requestedOwner != deployer) {
            deployed.policyVault.transferOwnership(requestedOwner);
            deployed.paymentModule.transferOwnership(requestedOwner);
            deployed.accessReceipt.transferOwnership(requestedOwner);
        }
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
