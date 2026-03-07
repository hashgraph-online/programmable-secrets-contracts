// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Log} from "forge-std/Vm.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {AccessReceipt} from "../src/AccessReceipt.sol";
import {
    AlreadyHasReceipt,
    BuyerNotAllowlisted,
    InvalidPrice,
    NotPolicyProvider,
    PolicyExpired,
    PolicyInactive,
    ReceiptNonTransferable
} from "../src/Errors.sol";
import {ProgrammableSecretsModularTestBase} from "./ProgrammableSecretsModularTestBase.sol";

contract ProgrammableSecretsModularTest is ProgrammableSecretsModularTestBase {
    bytes32 private constant DATASET_REGISTERED_SIG =
        keccak256("DatasetRegistered(uint256,address,bytes32,bytes32,bytes32,bytes32)");
    bytes32 private constant POLICY_CREATED_SIG =
        keccak256("PolicyCreated(uint256,uint256,address,address,address,bytes32,uint256,uint64,bool,bytes32,bytes32)");
    bytes32 private constant POLICY_UPDATED_SIG =
        keccak256("PolicyUpdated(uint256,uint256,uint256,uint64,bool,bool,bytes32)");
    bytes32 private constant ACCESS_GRANTED_SIG =
        keccak256("AccessGranted(uint256,uint256,uint256,address,address,address,uint256,uint64,bytes32,bytes32)");

    function testRegisterDatasetStoresFieldsAndEmitsEvent() public {
        vm.recordLogs();
        uint256 datasetId = _registerDataset();
        Log[] memory entries = vm.getRecordedLogs();

        PolicyVault.Dataset memory dataset = policyVault.getDataset(datasetId);

        assertEqAddress(dataset.provider, PROVIDER);
        assertEqBool(dataset.active, true);
        assertEqBytes32(dataset.ciphertextHash, CIPHERTEXT_HASH);
        assertEqBytes32(dataset.keyCommitment, KEY_COMMITMENT);
        assertEqBytes32(dataset.metadataHash, METADATA_HASH);
        assertEqBytes32(dataset.providerUaidHash, PROVIDER_UAID_HASH);
        assertEqUint(entries.length, uint256(1));
        assertEqBytes32(entries[0].topics[0], DATASET_REGISTERED_SIG);
        assertEqUint(uint256(entries[0].topics[1]), datasetId);
    }

    function testCreatePolicyStoresFieldsAndEmitsEvent() public {
        uint256 datasetId = _registerDataset();

        vm.recordLogs();
        uint256 policyId = _createTimeboundPolicyForDataset(datasetId, 1 ether, 0, false);
        Log[] memory entries = vm.getRecordedLogs();

        PolicyVault.Policy memory policy = policyVault.getPolicy(policyId);
        PolicyVault.Dataset memory dataset = policyVault.getDataset(datasetId);

        assertEqAddress(policy.provider, PROVIDER);
        assertEqAddress(policy.payout, PAYOUT);
        assertEqAddress(policy.paymentToken, address(0));
        assertEqUint(uint256(policy.price), uint256(1 ether));
        assertEqUint64(policy.expiresAt, uint64(0));
        assertEqBool(policy.active, true);
        assertEqBool(policy.allowlistEnabled, false);
        assertEqUint(policy.datasetId, datasetId);
        assertEqBytes32(policy.policyType, policyVault.POLICY_TYPE_TIMEBOUND());
        assertEqBytes32(policy.metadataHash, POLICY_METADATA_HASH);
        assertEqBytes32(dataset.ciphertextHash, CIPHERTEXT_HASH);
        assertEqBytes32(dataset.keyCommitment, KEY_COMMITMENT);
        assertEqUint(policyVault.getDatasetPolicyCount(datasetId), uint256(1));
        assertEqUint(policyVault.getDatasetPolicyIdAt(datasetId, 0), policyId);
        assertEqUint(entries.length, uint256(1));
        assertEqBytes32(entries[0].topics[0], POLICY_CREATED_SIG);
        assertEqUint(uint256(entries[0].topics[1]), policyId);
        assertEqUint(uint256(entries[0].topics[2]), datasetId);
    }

    function testUpdatePolicyOnlyProvider() public {
        uint256 policyId = _createDatasetPolicy(1 ether, 0, false);

        vm.prank(BUYER);
        vm.expectRevert(NotPolicyProvider.selector);
        policyVault.updatePolicy(policyId, 2 ether, 0, true, false, bytes32(uint256(2)));
    }

    function testUpdatePolicyWritesFieldsAndEmitsEvent() public {
        uint256 policyId = _createDatasetPolicy(1 ether, 0, false);
        bytes32 updatedMetadataHash = keccak256("updated");

        vm.recordLogs();
        vm.prank(PROVIDER);
        policyVault.updatePolicy(policyId, 2 ether, 777, false, true, updatedMetadataHash);
        Log[] memory entries = vm.getRecordedLogs();

        PolicyVault.Policy memory policy = policyVault.getPolicy(policyId);

        assertEqUint(uint256(policy.price), uint256(2 ether));
        assertEqUint64(policy.expiresAt, uint64(777));
        assertEqBool(policy.active, false);
        assertEqBool(policy.allowlistEnabled, true);
        assertEqBytes32(policy.metadataHash, updatedMetadataHash);
        assertEqUint(entries.length, uint256(1));
        assertEqBytes32(entries[0].topics[0], POLICY_UPDATED_SIG);
        assertEqUint(uint256(entries[0].topics[1]), policyId);
        assertEqUint(uint256(entries[0].topics[2]), policy.datasetId);
    }

    function testPurchaseMintsReceiptAndEmitsAccessGranted() public {
        uint256 policyId = _createDatasetPolicy(1 ether, 0, false);
        uint256 payoutBalanceBefore = PAYOUT.balance;

        vm.recordLogs();
        vm.prank(BUYER);
        uint256 receiptTokenId = paymentModule.purchase{value: 1 ether}(policyId, RECIPIENT, "");
        Log[] memory entries = vm.getRecordedLogs();

        AccessReceipt.Receipt memory receipt = accessReceipt.getReceipt(receiptTokenId);
        PolicyVault.Policy memory policy = policyVault.getPolicy(policyId);

        assertEqUint(PAYOUT.balance, payoutBalanceBefore + uint256(1 ether));
        assertEqUint(receipt.policyId, policyId);
        assertEqUint(receipt.datasetId, policy.datasetId);
        assertEqAddress(receipt.buyer, BUYER);
        assertEqAddress(receipt.recipient, RECIPIENT);
        assertEqUint(entries.length, uint256(3));
        assertEqBytes32(entries[2].topics[0], ACCESS_GRANTED_SIG);
        assertEqUint(uint256(entries[2].topics[1]), policyId);
        assertEqUint(uint256(entries[2].topics[2]), policy.datasetId);
        assertEqUint(uint256(entries[2].topics[3]), receiptTokenId);
        assertEqBool(paymentModule.hasAccess(policyId, BUYER), true);
        assertEqBool(paymentModule.hasDatasetAccess(policy.datasetId, BUYER), true);
        assertEqUint(accessReceipt.receiptOfPolicyAndBuyer(policyId, BUYER), receiptTokenId);
    }

    function testPurchaseRejectsInactivePolicy() public {
        uint256 policyId = _createDatasetPolicy(1 ether, 0, false);

        vm.prank(PROVIDER);
        policyVault.updatePolicy(policyId, 1 ether, 0, false, false, METADATA_HASH);

        vm.prank(BUYER);
        vm.expectRevert(PolicyInactive.selector);
        paymentModule.purchase{value: 1 ether}(policyId, BUYER, "");
    }

    function testPurchaseRejectsExpiredPolicy() public {
        uint256 policyId = _createDatasetPolicy(1 ether, uint64(block.timestamp + 1), false);

        vm.warp(block.timestamp + 2);
        vm.prank(BUYER);
        vm.expectRevert(PolicyExpired.selector);
        paymentModule.purchase{value: 1 ether}(policyId, BUYER, "");
    }

    function testPurchaseRequiresExactPrice() public {
        uint256 policyId = _createDatasetPolicy(1 ether, 0, false);

        vm.prank(BUYER);
        vm.expectRevert(InvalidPrice.selector);
        paymentModule.purchase{value: 2 ether}(policyId, BUYER, "");
    }

    function testPurchaseRequiresAllowlistWhenEnabled() public {
        uint256 policyId = _createAllowlistedDatasetPolicy(BUYER, 1 ether, 0);

        vm.prank(OTHER_BUYER);
        vm.expectRevert(BuyerNotAllowlisted.selector);
        paymentModule.purchase{value: 1 ether}(policyId, OTHER_BUYER, "");
    }

    function testPurchaseRejectsSecondReceiptForSameBuyer() public {
        uint256 policyId = _createDatasetPolicy(1 ether, 0, false);

        vm.prank(BUYER);
        paymentModule.purchase{value: 1 ether}(policyId, BUYER, "");

        vm.prank(BUYER);
        vm.expectRevert(AlreadyHasReceipt.selector);
        paymentModule.purchase{value: 1 ether}(policyId, BUYER, "");
    }

    function testPurchaseRejectsSecondReceiptForSameDatasetAcrossPolicies() public {
        uint256 datasetId = _registerDataset();
        uint256 firstPolicyId = _createTimeboundPolicyForDataset(datasetId, 1 ether, 0, false);
        uint256 secondPolicyId = _createTimeboundPolicyForDataset(datasetId, 2 ether, 0, false);

        vm.prank(BUYER);
        paymentModule.purchase{value: 1 ether}(firstPolicyId, BUYER, "");

        vm.prank(BUYER);
        vm.expectRevert(AlreadyHasReceipt.selector);
        paymentModule.purchase{value: 2 ether}(secondPolicyId, BUYER, "");
    }

    function testReceiptIsNonTransferable() public {
        uint256 policyId = _createDatasetPolicy(1 ether, 0, false);

        vm.prank(BUYER);
        uint256 receiptTokenId = paymentModule.purchase{value: 1 ether}(policyId, RECIPIENT, "");

        vm.prank(BUYER);
        vm.expectRevert(ReceiptNonTransferable.selector);
        accessReceipt.transferFrom(BUYER, OTHER_BUYER, receiptTokenId);
    }

    function testHasAccessExpiresAfterPolicyExpiry() public {
        uint256 policyId = _createDatasetPolicy(1 ether, uint64(block.timestamp + 1 days), false);
        PolicyVault.Policy memory policy = policyVault.getPolicy(policyId);

        vm.prank(BUYER);
        paymentModule.purchase{value: 1 ether}(policyId, BUYER, "");

        vm.warp(block.timestamp + 1 days + 1);

        assertEqBool(paymentModule.hasAccess(policyId, BUYER), false);
        assertEqBool(paymentModule.hasDatasetAccess(policy.datasetId, BUYER), false);
        assertTrue(accessReceipt.receiptOfPolicyAndBuyer(policyId, BUYER) != 0);
    }

    function testDatasetAndPolicyCountsTrackProxyState() public {
        assertEqUint(policyVault.datasetCount(), uint256(0));
        assertEqUint(policyVault.policyCount(), uint256(0));

        _createDatasetPolicy(1 ether, 0, false);
        _createDatasetPolicy(2 ether, uint64(block.timestamp + 1 days), true);

        assertEqUint(policyVault.datasetCount(), uint256(2));
        assertEqUint(policyVault.policyCount(), uint256(2));
    }

    function testCreateUaidBoundPolicyStoresRequirementFields() public {
        uint256 agentId = _registerBuyerAgent(BUYER, "volatility-agent");
        uint256 policyId = _createUaidBoundPolicy(1 ether, 0, REQUIRED_BUYER_UAID, agentId);

        PolicyVault.Policy memory policy = policyVault.getPolicy(policyId);

        assertEqBytes32(policy.policyType, policyVault.POLICY_TYPE_UAID_ERC8004());
        assertEqBytes32(policy.requiredBuyerUaidHash, keccak256(bytes(REQUIRED_BUYER_UAID)));
        assertEqAddress(policy.identityRegistry, address(agentIdentityRegistry));
        assertEqUint(policy.agentId, agentId);
    }

    function testPurchaseRequiresMatchingUaidAgentOwnership() public {
        uint256 agentId = _registerBuyerAgent(BUYER, "volatility-agent");
        uint256 policyId = _createUaidBoundPolicy(1 ether, 0, REQUIRED_BUYER_UAID, agentId);

        vm.prank(BUYER);
        uint256 receiptTokenId = paymentModule.purchase{value: 1 ether}(policyId, BUYER, REQUIRED_BUYER_UAID);

        AccessReceipt.Receipt memory receipt = accessReceipt.getReceipt(receiptTokenId);
        assertEqUint(receipt.policyId, policyId);
        assertEqAddress(receipt.buyer, BUYER);
        assertEqBool(paymentModule.hasAccess(policyId, BUYER), true);
    }
}
