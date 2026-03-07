// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Log} from "forge-std/Vm.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {AccessReceipt} from "../src/AccessReceipt.sol";
import {TimeRangeCondition} from "../src/TimeRangeCondition.sol";
import {UaidOwnershipCondition} from "../src/UaidOwnershipCondition.sol";
import {
    AlreadyHasReceipt,
    EvaluatorAlreadyRegistered,
    EvaluatorNotRegistered,
    InvalidConditionInputCount,
    InvalidPrice,
    NotPolicyProvider,
    PolicyInactive,
    ReceiptNonTransferable
} from "../src/Errors.sol";
import {ProgrammableSecretsModularTestBase} from "./ProgrammableSecretsModularTestBase.sol";

contract ProgrammableSecretsModularTest is ProgrammableSecretsModularTestBase {
    bytes32 private constant POLICY_EVALUATOR_REGISTERED_SIG =
        keccak256("PolicyEvaluatorRegistered(address,address,bytes32,uint256,bool)");
    bytes32 private constant DATASET_REGISTERED_SIG =
        keccak256("DatasetRegistered(uint256,address,bytes32,bytes32,bytes32,bytes32)");
    bytes32 private constant POLICY_CREATED_SIG =
        keccak256("PolicyCreated(uint256,uint256,address,address,address,uint256,bytes32,uint32,bytes32,bytes32)");
    bytes32 private constant POLICY_UPDATED_SIG = keccak256("PolicyUpdated(uint256,uint256,uint256,bool,bytes32)");
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

    function testRegisterPolicyEvaluatorChargesFeeAndStoresRegistration() public {
        TimeRangeCondition customEvaluator = new TimeRangeCondition();
        bytes32 metadataHash = keccak256("custom-evaluator");
        uint256 ownerBalanceBefore = UPGRADE_OWNER.balance;
        uint256 evaluatorCountBefore = policyVault.getPolicyEvaluatorCount();

        vm.deal(PROVIDER, 1 ether);
        vm.recordLogs();
        vm.prank(PROVIDER);
        policyVault.registerPolicyEvaluator{value: 0.05 ether}(address(customEvaluator), metadataHash);
        Log[] memory entries = vm.getRecordedLogs();

        PolicyVault.PolicyEvaluatorRegistration memory registration =
            policyVault.getPolicyEvaluator(address(customEvaluator));

        assertEqAddress(registration.registrant, PROVIDER);
        assertEqBytes32(registration.metadataHash, metadataHash);
        assertEqBool(registration.active, true);
        assertEqBool(registration.builtIn, false);
        assertEqUint(UPGRADE_OWNER.balance, ownerBalanceBefore + 0.05 ether);
        assertEqUint(policyVault.getPolicyEvaluatorCount(), evaluatorCountBefore + 1);
        assertEqAddress(policyVault.getPolicyEvaluatorAt(evaluatorCountBefore), address(customEvaluator));
        assertEqUint(entries.length, uint256(1));
        assertEqBytes32(entries[0].topics[0], POLICY_EVALUATOR_REGISTERED_SIG);
    }

    function testBuiltInEvaluatorsAreIndexed() public view {
        uint256 evaluatorCount = policyVault.getPolicyEvaluatorCount();
        assertEqUint(evaluatorCount, uint256(3));
        assertEqAddress(policyVault.getPolicyEvaluatorAt(0), address(timeRangeCondition));
        assertEqAddress(policyVault.getPolicyEvaluatorAt(1), address(uaidOwnershipCondition));
        assertEqAddress(policyVault.getPolicyEvaluatorAt(2), address(addressAllowlistCondition));
    }

    function testRegisterPolicyEvaluatorRejectsWrongFee() public {
        TimeRangeCondition customEvaluator = new TimeRangeCondition();

        vm.deal(PROVIDER, 1 ether);
        vm.prank(PROVIDER);
        (bool success,) = address(policyVault).call{value: 0.04 ether}(
            abi.encodeCall(
                PolicyVault.registerPolicyEvaluator, (address(customEvaluator), keccak256("custom-evaluator"))
            )
        );
        assertTrue(!success);
    }

    function testRegisterPolicyEvaluatorRejectsDuplicateRegistration() public {
        TimeRangeCondition customEvaluator = new TimeRangeCondition();
        bytes32 metadataHash = keccak256("custom-evaluator");

        vm.deal(PROVIDER, 1 ether);
        vm.prank(PROVIDER);
        policyVault.registerPolicyEvaluator{value: 0.05 ether}(address(customEvaluator), metadataHash);

        vm.deal(BUYER, 1 ether);
        vm.prank(BUYER);
        vm.expectRevert(EvaluatorAlreadyRegistered.selector);
        policyVault.registerPolicyEvaluator{value: 0.05 ether}(address(customEvaluator), metadataHash);
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
        assertEqBool(policy.active, true);
        assertEqUint(policy.datasetId, datasetId);
        assertEqUint(uint256(policy.conditionCount), uint256(0));
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

    function testCreatePolicyRejectsUnregisteredEvaluator() public {
        uint256 datasetId = _registerDataset();
        TimeRangeCondition customEvaluator = new TimeRangeCondition();
        PolicyVault.PolicyConditionInput[] memory conditions = new PolicyVault.PolicyConditionInput[](1);
        conditions[0] = PolicyVault.PolicyConditionInput({
            evaluator: address(customEvaluator), configData: abi.encode(uint64(0), uint64(0))
        });

        vm.prank(PROVIDER);
        vm.expectRevert(EvaluatorNotRegistered.selector);
        policyVault.createPolicyForDataset(datasetId, PAYOUT, address(0), 1 ether, POLICY_METADATA_HASH, conditions);
    }

    function testUpdatePolicyOnlyProvider() public {
        uint256 policyId = _createDatasetPolicy(1 ether, 0, false);

        vm.prank(BUYER);
        vm.expectRevert(NotPolicyProvider.selector);
        policyVault.updatePolicy(policyId, 2 ether, true, bytes32(uint256(2)));
    }

    function testUpdatePolicyWritesFieldsAndEmitsEvent() public {
        uint256 policyId = _createDatasetPolicy(1 ether, 0, false);
        bytes32 updatedMetadataHash = keccak256("updated");

        vm.recordLogs();
        vm.prank(PROVIDER);
        policyVault.updatePolicy(policyId, 2 ether, false, updatedMetadataHash);
        Log[] memory entries = vm.getRecordedLogs();

        PolicyVault.Policy memory policy = policyVault.getPolicy(policyId);

        assertEqUint(uint256(policy.price), uint256(2 ether));
        assertEqBool(policy.active, false);
        assertEqBytes32(policy.metadataHash, updatedMetadataHash);
        assertEqUint(entries.length, uint256(1));
        assertEqBytes32(entries[0].topics[0], POLICY_UPDATED_SIG);
        assertEqUint(uint256(entries[0].topics[1]), policyId);
        assertEqUint(uint256(entries[0].topics[2]), policy.datasetId);
    }

    function testPurchaseMintsReceiptAndEmitsAccessGranted() public {
        uint256 policyId = _createDatasetPolicy(1 ether, 0, false);
        uint256 payoutBalanceBefore = PAYOUT.balance;
        bytes[] memory runtimeInputs = _emptyRuntimeInputs(0);

        vm.recordLogs();
        vm.prank(BUYER);
        uint256 receiptTokenId = paymentModule.purchase{value: 1 ether}(policyId, RECIPIENT, runtimeInputs);
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
        bytes[] memory runtimeInputs = _emptyRuntimeInputs(0);

        vm.prank(PROVIDER);
        policyVault.updatePolicy(policyId, 1 ether, false, METADATA_HASH);

        vm.prank(BUYER);
        vm.expectRevert(PolicyInactive.selector);
        paymentModule.purchase{value: 1 ether}(policyId, BUYER, runtimeInputs);
    }

    function testPurchaseRejectsExpiredPolicy() public {
        uint256 policyId = _createDatasetPolicy(1 ether, uint64(block.timestamp + 1), false);
        bytes[] memory runtimeInputs = _emptyRuntimeInputs(1);

        vm.warp(block.timestamp + 2);
        _assertPolicyConditionFailure(BUYER, policyId, BUYER, runtimeInputs, 1 ether, 0);
    }

    function testPurchaseRequiresExactPrice() public {
        uint256 policyId = _createDatasetPolicy(1 ether, 0, false);
        bytes[] memory runtimeInputs = _emptyRuntimeInputs(0);

        vm.prank(BUYER);
        vm.expectRevert(InvalidPrice.selector);
        paymentModule.purchase{value: 2 ether}(policyId, BUYER, runtimeInputs);
    }

    function testPurchaseRejectsConditionRuntimeInputCountMismatch() public {
        uint256 policyId = _createDatasetPolicy(1 ether, uint64(block.timestamp + 1 days), false);

        vm.prank(BUYER);
        vm.expectRevert(InvalidConditionInputCount.selector);
        paymentModule.purchase{value: 1 ether}(policyId, BUYER, _emptyRuntimeInputs(0));
    }

    function testPurchaseRequiresAllowlistWhenEnabled() public {
        uint256 policyId = _createAllowlistedDatasetPolicy(BUYER, 1 ether, 0);
        bytes[] memory runtimeInputs = _emptyRuntimeInputs(1);

        _assertPolicyConditionFailure(OTHER_BUYER, policyId, OTHER_BUYER, runtimeInputs, 1 ether, 0);
    }

    function testPurchaseAllowsAllowlistAndTimeboundComposition() public {
        uint256 policyId = _createAllowlistedDatasetPolicy(BUYER, 1 ether, uint64(block.timestamp + 1 days));

        vm.prank(BUYER);
        uint256 receiptTokenId = paymentModule.purchase{value: 1 ether}(policyId, BUYER, _emptyRuntimeInputs(2));

        assertEqUint(receiptTokenId, accessReceipt.receiptOfPolicyAndBuyer(policyId, BUYER));
        assertEqBool(paymentModule.hasAccess(policyId, BUYER), true);
    }

    function testPurchaseRejectsSecondReceiptForSameBuyer() public {
        uint256 policyId = _createDatasetPolicy(1 ether, 0, false);
        bytes[] memory runtimeInputs = _emptyRuntimeInputs(0);

        vm.prank(BUYER);
        paymentModule.purchase{value: 1 ether}(policyId, BUYER, runtimeInputs);

        vm.prank(BUYER);
        vm.expectRevert(AlreadyHasReceipt.selector);
        paymentModule.purchase{value: 1 ether}(policyId, BUYER, runtimeInputs);
    }

    function testPurchaseRejectsSecondReceiptForSameDatasetAcrossPolicies() public {
        uint256 datasetId = _registerDataset();
        uint256 firstPolicyId = _createTimeboundPolicyForDataset(datasetId, 1 ether, 0, false);
        uint256 secondPolicyId = _createTimeboundPolicyForDataset(datasetId, 2 ether, 0, false);
        bytes[] memory runtimeInputs = _emptyRuntimeInputs(0);

        vm.prank(BUYER);
        paymentModule.purchase{value: 1 ether}(firstPolicyId, BUYER, runtimeInputs);

        vm.prank(BUYER);
        vm.expectRevert(AlreadyHasReceipt.selector);
        paymentModule.purchase{value: 2 ether}(secondPolicyId, BUYER, runtimeInputs);
    }

    function testReceiptIsNonTransferable() public {
        uint256 policyId = _createDatasetPolicy(1 ether, 0, false);
        bytes[] memory runtimeInputs = _emptyRuntimeInputs(0);

        vm.prank(BUYER);
        uint256 receiptTokenId = paymentModule.purchase{value: 1 ether}(policyId, RECIPIENT, runtimeInputs);

        vm.prank(BUYER);
        vm.expectRevert(ReceiptNonTransferable.selector);
        accessReceipt.transferFrom(BUYER, OTHER_BUYER, receiptTokenId);
    }

    function testHasAccessPersistsAfterPurchaseTimeConditionExpires() public {
        uint256 policyId = _createDatasetPolicy(1 ether, uint64(block.timestamp + 1 days), false);
        PolicyVault.Policy memory policy = policyVault.getPolicy(policyId);
        bytes[] memory runtimeInputs = _emptyRuntimeInputs(1);

        vm.prank(BUYER);
        paymentModule.purchase{value: 1 ether}(policyId, BUYER, runtimeInputs);

        vm.warp(block.timestamp + 1 days + 1);

        assertEqBool(paymentModule.hasAccess(policyId, BUYER), true);
        assertEqBool(paymentModule.hasDatasetAccess(policy.datasetId, BUYER), true);
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
        (address evaluator, bytes memory configData, bytes32 configHash) = policyVault.getPolicyCondition(policyId, 0);
        UaidOwnershipCondition.UaidOwnershipConfig memory config =
            abi.decode(configData, (UaidOwnershipCondition.UaidOwnershipConfig));

        assertEqUint(uint256(policy.conditionCount), uint256(1));
        assertEqAddress(evaluator, address(uaidOwnershipCondition));
        assertEqBytes32(config.requiredBuyerUaidHash, keccak256(bytes(REQUIRED_BUYER_UAID)));
        assertEqAddress(config.identityRegistry, address(agentIdentityRegistry));
        assertEqUint(config.agentId, agentId);
        assertEqBytes32(configHash, keccak256(configData));
    }

    function testPurchaseRequiresMatchingUaidAgentOwnership() public {
        uint256 agentId = _registerBuyerAgent(BUYER, "volatility-agent");
        uint256 policyId = _createUaidBoundPolicy(1 ether, 0, REQUIRED_BUYER_UAID, agentId);
        bytes[] memory runtimeInputs = _runtimeInputsForUaid(1, 0, REQUIRED_BUYER_UAID);

        vm.prank(BUYER);
        uint256 receiptTokenId = paymentModule.purchase{value: 1 ether}(policyId, BUYER, runtimeInputs);

        AccessReceipt.Receipt memory receipt = accessReceipt.getReceipt(receiptTokenId);
        assertEqUint(receipt.policyId, policyId);
        assertEqAddress(receipt.buyer, BUYER);
        assertEqBool(paymentModule.hasAccess(policyId, BUYER), true);
    }

    function testPurchaseAllowsUaidAndTimeboundComposition() public {
        uint256 agentId = _registerBuyerAgent(BUYER, "volatility-agent");
        uint256 policyId =
            _createUaidBoundPolicy(1 ether, uint64(block.timestamp + 1 days), REQUIRED_BUYER_UAID, agentId);
        bytes[] memory runtimeInputs = _runtimeInputsForUaid(2, 1, REQUIRED_BUYER_UAID);

        vm.prank(BUYER);
        uint256 receiptTokenId = paymentModule.purchase{value: 1 ether}(policyId, BUYER, runtimeInputs);

        assertEqUint(receiptTokenId, accessReceipt.receiptOfPolicyAndBuyer(policyId, BUYER));
        assertEqBool(paymentModule.hasAccess(policyId, BUYER), true);
    }
}
