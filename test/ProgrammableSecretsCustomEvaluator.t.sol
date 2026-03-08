// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PolicyVault} from "../src/PolicyVault.sol";
import {PaymentModule} from "../src/PaymentModule.sol";
import {EthBalanceCondition, InvalidMinimumBalance} from "../src/EthBalanceCondition.sol";
import {EvaluatorNotRegistered, PolicyConditionFailed} from "../src/Errors.sol";
import {ProgrammableSecretsModularTestBase} from "./ProgrammableSecretsModularTestBase.sol";

contract ProgrammableSecretsCustomEvaluatorTest is ProgrammableSecretsModularTestBase {
    bytes32 private constant CUSTOM_METADATA_HASH = keccak256("eth-balance-threshold-v1");
    uint256 private constant MINIMUM_BALANCE_WEI = 0.1 ether;
    uint96 private constant POLICY_PRICE = 0.01 ether;

    EthBalanceCondition internal ethBalanceCondition;

    function setUp() public override {
        super.setUp();
        ethBalanceCondition = new EthBalanceCondition();
    }

    function testCustomEvaluatorRegistrationAndPurchaseFlowWorks() public {
        vm.deal(PROVIDER, 1 ether);
        vm.prank(PROVIDER);
        policyVault.registerPolicyEvaluator{value: 0.05 ether}(address(ethBalanceCondition), CUSTOM_METADATA_HASH);

        uint256 datasetId = _registerDataset();
        PolicyVault.PolicyConditionInput[] memory conditions = new PolicyVault.PolicyConditionInput[](1);
        conditions[0] = PolicyVault.PolicyConditionInput({
            evaluator: address(ethBalanceCondition), configData: abi.encode(MINIMUM_BALANCE_WEI)
        });

        vm.prank(PROVIDER);
        uint256 policyId = policyVault.createPolicyForDataset(
            datasetId, PAYOUT, address(0), POLICY_PRICE, false, POLICY_METADATA_HASH, conditions
        );

        bytes[] memory runtimeInputs = _emptyRuntimeInputs(1);

        vm.prank(BUYER);
        uint256 receiptTokenId = paymentModule.purchase{value: POLICY_PRICE}(policyId, RECIPIENT, runtimeInputs);

        assertEqUint(receiptTokenId, uint256(1));
        assertEqBool(paymentModule.hasAccess(policyId, BUYER), true);
    }

    function testCustomEvaluatorRejectsBuyerBelowThreshold() public {
        vm.deal(PROVIDER, 1 ether);
        vm.prank(PROVIDER);
        policyVault.registerPolicyEvaluator{value: 0.05 ether}(address(ethBalanceCondition), CUSTOM_METADATA_HASH);

        uint256 datasetId = _registerDataset();
        PolicyVault.PolicyConditionInput[] memory conditions = new PolicyVault.PolicyConditionInput[](1);
        conditions[0] = PolicyVault.PolicyConditionInput({
            evaluator: address(ethBalanceCondition), configData: abi.encode(50 ether)
        });

        vm.prank(PROVIDER);
        uint256 policyId = policyVault.createPolicyForDataset(
            datasetId, PAYOUT, address(0), POLICY_PRICE, false, POLICY_METADATA_HASH, conditions
        );

        bytes[] memory runtimeInputs = _emptyRuntimeInputs(1);
        vm.deal(BUYER, 0.05 ether);

        vm.prank(BUYER);
        (bool success, bytes memory revertData) = address(paymentModule).call{value: POLICY_PRICE}(
            abi.encodeCall(PaymentModule.purchase, (policyId, RECIPIENT, runtimeInputs))
        );

        assertTrue(!success);
        assertTrue(revertData.length >= 4);
        bytes4 selector;
        assembly {
            selector := mload(add(revertData, 32))
        }
        assertTrue(selector == PolicyConditionFailed.selector);
    }

    function testCustomEvaluatorRequiresRegistration() public {
        uint256 datasetId = _registerDataset();
        PolicyVault.PolicyConditionInput[] memory conditions = new PolicyVault.PolicyConditionInput[](1);
        conditions[0] = PolicyVault.PolicyConditionInput({
            evaluator: address(ethBalanceCondition), configData: abi.encode(MINIMUM_BALANCE_WEI)
        });

        vm.prank(PROVIDER);
        vm.expectRevert(EvaluatorNotRegistered.selector);
        policyVault.createPolicyForDataset(
            datasetId, PAYOUT, address(0), POLICY_PRICE, false, POLICY_METADATA_HASH, conditions
        );
    }

    function testCustomEvaluatorRejectsZeroThreshold() public {
        vm.deal(PROVIDER, 1 ether);
        vm.prank(PROVIDER);
        policyVault.registerPolicyEvaluator{value: 0.05 ether}(address(ethBalanceCondition), CUSTOM_METADATA_HASH);

        uint256 datasetId = _registerDataset();
        PolicyVault.PolicyConditionInput[] memory conditions = new PolicyVault.PolicyConditionInput[](1);
        conditions[0] = PolicyVault.PolicyConditionInput({
            evaluator: address(ethBalanceCondition), configData: abi.encode(uint256(0))
        });

        vm.prank(PROVIDER);
        vm.expectRevert(InvalidMinimumBalance.selector);
        policyVault.createPolicyForDataset(
            datasetId, PAYOUT, address(0), POLICY_PRICE, false, POLICY_METADATA_HASH, conditions
        );
    }
}
