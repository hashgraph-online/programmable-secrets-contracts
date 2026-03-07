// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {PaymentModule} from "../src/PaymentModule.sol";
import {ProgrammableSecretsModularTestBase} from "./ProgrammableSecretsModularTestBase.sol";

contract PolicyVaultV2 is PolicyVault {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract PaymentModuleV2 is PaymentModule {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract ProgrammableSecretsModularUpgradeTest is ProgrammableSecretsModularTestBase {
    function testPolicyVaultImplementationInitializerIsLocked() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        policyVaultImplementation.initialize(UPGRADE_OWNER);
    }

    function testPaymentModuleImplementationInitializerIsLocked() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        paymentModuleImplementation.initialize(UPGRADE_OWNER, address(policyVault), address(accessReceipt));
    }

    function testOnlyOwnerCanUpgradePolicyVault() public {
        PolicyVaultV2 v2Implementation = new PolicyVaultV2();

        vm.prank(BUYER);
        (bool success,) = address(policyVault)
            .call(abi.encodeCall(policyVault.upgradeToAndCall, (address(v2Implementation), bytes(""))));

        assertTrue(!success);
    }

    function testOnlyOwnerCanUpgradePaymentModule() public {
        PaymentModuleV2 v2Implementation = new PaymentModuleV2();

        vm.prank(BUYER);
        (bool success,) = address(paymentModule)
            .call(abi.encodeCall(paymentModule.upgradeToAndCall, (address(v2Implementation), bytes(""))));

        assertTrue(!success);
    }

    function testOwnerCanUpgradeBothModulesAndStatePersists() public {
        uint256 policyId = _createDatasetPolicy(1 ether, uint64(block.timestamp + 1 days), false);
        uint256 datasetId = policyVault.getPolicy(policyId).datasetId;

        vm.prank(BUYER);
        uint256 receiptTokenId = paymentModule.purchase{value: 1 ether}(policyId, RECIPIENT, "");

        PolicyVaultV2 newPolicyVaultImplementation = new PolicyVaultV2();
        PaymentModuleV2 newPaymentModuleImplementation = new PaymentModuleV2();

        vm.prank(UPGRADE_OWNER);
        policyVault.upgradeToAndCall(address(newPolicyVaultImplementation), bytes(""));
        vm.prank(UPGRADE_OWNER);
        paymentModule.upgradeToAndCall(address(newPaymentModuleImplementation), bytes(""));

        PolicyVaultV2 upgradedPolicyVault = PolicyVaultV2(address(policyVault));
        PaymentModuleV2 upgradedPaymentModule = PaymentModuleV2(address(paymentModule));
        PolicyVault.Policy memory policy = upgradedPolicyVault.getPolicy(policyId);
        PolicyVault.Dataset memory dataset = upgradedPolicyVault.getDataset(datasetId);

        assertEqUint(upgradedPolicyVault.version(), uint256(2));
        assertEqUint(upgradedPaymentModule.version(), uint256(2));
        assertEqAddress(upgradedPolicyVault.owner(), UPGRADE_OWNER);
        assertEqAddress(upgradedPaymentModule.owner(), UPGRADE_OWNER);
        assertEqUint(upgradedPolicyVault.datasetCount(), uint256(1));
        assertEqUint(upgradedPolicyVault.policyCount(), uint256(1));
        assertEqBool(upgradedPaymentModule.hasAccess(policyId, BUYER), true);
        assertEqBool(upgradedPaymentModule.hasDatasetAccess(datasetId, BUYER), true);
        assertEqUint(upgradedPaymentModule.receiptOfPolicyAndBuyer(policyId, BUYER), receiptTokenId);
        assertEqAddress(policy.provider, PROVIDER);
        assertEqAddress(policy.payout, PAYOUT);
        assertEqUint(uint256(policy.price), uint256(1 ether));
        assertEqUint(policy.datasetId, datasetId);
        assertEqBytes32(policy.policyType, upgradedPolicyVault.POLICY_TYPE_TIMEBOUND());
        assertEqBytes32(policy.ciphertextHash, CIPHERTEXT_HASH);
        assertEqBytes32(policy.keyCommitment, KEY_COMMITMENT);
        assertEqBytes32(policy.metadataHash, POLICY_METADATA_HASH);
        assertEqBytes32(policy.providerUaidHash, PROVIDER_UAID_HASH);
        assertEqAddress(dataset.provider, PROVIDER);
        assertEqBytes32(dataset.ciphertextHash, CIPHERTEXT_HASH);
        assertEqBytes32(dataset.keyCommitment, KEY_COMMITMENT);
        assertEqBytes32(dataset.metadataHash, METADATA_HASH);
        assertEqBytes32(dataset.providerUaidHash, PROVIDER_UAID_HASH);
    }
}
