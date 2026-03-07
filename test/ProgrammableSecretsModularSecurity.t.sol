// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {AccessReceipt} from "../src/AccessReceipt.sol";
import {PaymentModule} from "../src/PaymentModule.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {TimeRangeCondition} from "../src/TimeRangeCondition.sol";
import {
    AgentIdentityNotFound,
    DatasetInactive,
    InvalidAgentId,
    InvalidDatasetHashes,
    InvalidExpiry,
    InvalidIdentityRegistry,
    InvalidRequiredBuyerUaid,
    PaymentFailed
} from "../src/Errors.sol";
import {UaidOwnershipCondition} from "../src/UaidOwnershipCondition.sol";
import {ProgrammableSecretsModularTestBase} from "./ProgrammableSecretsModularTestBase.sol";

contract RejectingPayoutV2 {
    receive() external payable {
        revert();
    }
}

contract ReenteringPayoutV2 {
    PaymentModule private immutable TARGET;
    uint256 private reenterPolicyId;
    uint256 private reenterPrice;

    bool public attempted;
    bool public succeeded;

    constructor(PaymentModule target_) {
        TARGET = target_;
    }

    function configure(uint256 policyId, uint256 price) external {
        reenterPolicyId = policyId;
        reenterPrice = price;
        attempted = false;
        succeeded = false;
    }

    receive() external payable {
        if (attempted) {
            return;
        }

        attempted = true;
        bytes[] memory runtimeInputs = new bytes[](0);
        (succeeded,) = address(TARGET).call{value: reenterPrice}(
            abi.encodeCall(PaymentModule.purchase, (reenterPolicyId, address(this), runtimeInputs))
        );
    }
}

contract ReceiptObserverV2 is IERC721Receiver {
    AccessReceipt private immutable RECEIPT;
    PaymentModule private immutable PAYMENT_MODULE;

    bool public observed;

    constructor(AccessReceipt receipt_, PaymentModule paymentModule_) {
        RECEIPT = receipt_;
        PAYMENT_MODULE = paymentModule_;
    }

    function purchase(uint256 policyId, uint256 price) external {
        bytes[] memory runtimeInputs = new bytes[](0);
        PAYMENT_MODULE.purchase{value: price}(policyId, address(this), runtimeInputs);
    }

    function onERC721Received(address, address, uint256 tokenId, bytes calldata) external returns (bytes4) {
        uint256 policyId = RECEIPT.getReceipt(tokenId).policyId;
        uint256 observedReceiptId = RECEIPT.receiptOfPolicyAndBuyer(policyId, address(this));

        require(policyId != 0, "receipt not stored");
        require(observedReceiptId == tokenId, "receipt lookup missing");

        observed = true;
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract ZeroPayoutPolicyVaultV2 {
    uint96 private immutable PRICE;

    constructor(uint96 price_) {
        PRICE = price_;
    }

    function getPolicy(uint256) external view returns (PolicyVault.Policy memory policy) {
        policy = PolicyVault.Policy({
            provider: address(0xA11CE),
            payout: address(0),
            paymentToken: address(0),
            price: PRICE,
            createdAt: uint64(block.timestamp),
            active: true,
            allowlistEnabled: false,
            ciphertextHash: keccak256("ciphertext"),
            keyCommitment: keccak256("content-key"),
            metadataHash: keccak256("policy-metadata"),
            providerUaidHash: keccak256("uaid"),
            datasetId: 1,
            conditionsHash: keccak256(abi.encode(new bytes32[](0))),
            conditionCount: 0
        });
    }

    function getPolicyConditionCount(uint256) external pure returns (uint256) {
        return 0;
    }

    function getPolicyCondition(uint256, uint256)
        external
        pure
        returns (address evaluator, bytes memory configData, bytes32 configHash)
    {
        return (address(0), bytes(""), bytes32(0));
    }

    function getDataset(uint256) external view returns (PolicyVault.Dataset memory dataset) {
        dataset = PolicyVault.Dataset({
            provider: address(0xA11CE),
            createdAt: uint64(block.timestamp),
            active: true,
            ciphertextHash: keccak256("ciphertext"),
            keyCommitment: keccak256("content-key"),
            metadataHash: keccak256("dataset-metadata"),
            providerUaidHash: keccak256("uaid")
        });
    }
}

contract ProgrammableSecretsModularSecurityTest is ProgrammableSecretsModularTestBase {
    bytes4 private constant INVALID_PAYOUT_ADDRESS_SELECTOR = bytes4(keccak256("InvalidPayoutAddress()"));

    function testCreatePolicyRejectsZeroCiphertextHash() public {
        vm.prank(PROVIDER);
        vm.expectRevert(InvalidDatasetHashes.selector);
        policyVault.registerDataset(bytes32(0), KEY_COMMITMENT, METADATA_HASH, PROVIDER_UAID_HASH);
    }

    function testCreatePolicyRejectsZeroKeyCommitment() public {
        vm.prank(PROVIDER);
        vm.expectRevert(InvalidDatasetHashes.selector);
        policyVault.registerDataset(CIPHERTEXT_HASH, bytes32(0), METADATA_HASH, PROVIDER_UAID_HASH);
    }

    function testCreatePolicyRejectsImmediateExpiry() public {
        uint256 datasetId = _registerDataset();
        PolicyVault.PolicyConditionInput[] memory conditions = new PolicyVault.PolicyConditionInput[](1);
        conditions[0] = PolicyVault.PolicyConditionInput({
            evaluator: address(timeRangeCondition),
            configData: abi.encode(
                TimeRangeCondition.TimeRangeConfig({notBefore: 0, notAfter: uint64(block.timestamp)})
            )
        });

        vm.prank(PROVIDER);
        vm.expectRevert(InvalidExpiry.selector);
        policyVault.createPolicyForDataset(datasetId, address(0), address(0), 1 ether, POLICY_METADATA_HASH, conditions);
    }

    function testCreatePolicyRejectsInvalidTimeRangeOrdering() public {
        uint256 datasetId = _registerDataset();
        PolicyVault.PolicyConditionInput[] memory conditions = new PolicyVault.PolicyConditionInput[](1);
        conditions[0] = PolicyVault.PolicyConditionInput({
            evaluator: address(timeRangeCondition),
            configData: abi.encode(
                TimeRangeCondition.TimeRangeConfig({
                    notBefore: uint64(block.timestamp + 2 days), notAfter: uint64(block.timestamp + 1 days)
                })
            )
        });

        vm.prank(PROVIDER);
        vm.expectRevert(InvalidExpiry.selector);
        policyVault.createPolicyForDataset(datasetId, address(0), address(0), 1 ether, POLICY_METADATA_HASH, conditions);
    }

    function testPurchaseRevertsAtExactExpiryTimestamp() public {
        uint256 policyId = _createDatasetPolicy(1 ether, uint64(block.timestamp + 1 days), false);
        bytes[] memory runtimeInputs = _emptyRuntimeInputs(1);

        vm.warp(block.timestamp + 1 days);
        _assertPolicyConditionFailure(BUYER, policyId, BUYER, runtimeInputs, 1 ether, 0);
    }

    function testPurchaseRevertsWhenPayoutRejectsEtherAndDoesNotMintReceipt() public {
        RejectingPayoutV2 payout = new RejectingPayoutV2();
        uint256 datasetId = _registerDataset();
        PolicyVault.PolicyConditionInput[] memory conditions = new PolicyVault.PolicyConditionInput[](0);

        vm.prank(PROVIDER);
        uint256 policyId = policyVault.createPolicyForDataset(
            datasetId, address(payout), address(0), 1 ether, POLICY_METADATA_HASH, conditions
        );
        bytes[] memory runtimeInputs = new bytes[](0);

        vm.prank(BUYER);
        vm.expectRevert(PaymentFailed.selector);
        paymentModule.purchase{value: 1 ether}(policyId, BUYER, runtimeInputs);

        assertTrue(!paymentModule.hasAccess(policyId, BUYER));
    }

    function testPurchaseBlocksPayoutReentrancy() public {
        ReenteringPayoutV2 payout = new ReenteringPayoutV2(paymentModule);
        uint256 outerDatasetId = _registerDataset();
        uint256 reenterDatasetId = _registerDataset();
        PolicyVault.PolicyConditionInput[] memory conditions = new PolicyVault.PolicyConditionInput[](0);

        vm.prank(PROVIDER);
        uint256 outerPolicyId = policyVault.createPolicyForDataset(
            outerDatasetId, address(payout), address(0), 1 ether, POLICY_METADATA_HASH, conditions
        );
        vm.prank(PROVIDER);
        uint256 reenterPolicyId = policyVault.createPolicyForDataset(
            reenterDatasetId, address(payout), address(0), 1 ether, POLICY_METADATA_HASH, conditions
        );

        payout.configure(reenterPolicyId, 1 ether);
        bytes[] memory runtimeInputs = new bytes[](0);

        vm.prank(BUYER);
        paymentModule.purchase{value: 1 ether}(outerPolicyId, BUYER, runtimeInputs);

        assertTrue(payout.attempted());
        assertTrue(!payout.succeeded());
        assertTrue(paymentModule.hasAccess(outerPolicyId, BUYER));
        assertTrue(!paymentModule.hasAccess(reenterPolicyId, address(payout)));
    }

    function testPurchaseStoresReceiptStateBeforeReceiverCallback() public {
        uint256 policyId = _createDatasetPolicy(1 ether, 0, false);
        ReceiptObserverV2 observer = new ReceiptObserverV2(accessReceipt, paymentModule);
        vm.deal(address(observer), 1 ether);

        observer.purchase(policyId, 1 ether);

        assertTrue(observer.observed());
        assertTrue(paymentModule.hasAccess(policyId, address(observer)));
    }

    function testHasAccessReturnsFalseWhenDatasetIsInactive() public {
        uint256 policyId = _createDatasetPolicy(1 ether, 0, false);
        uint256 datasetId = policyVault.getPolicy(policyId).datasetId;

        vm.prank(BUYER);
        paymentModule.purchase{value: 1 ether}(policyId, BUYER, _emptyRuntimeInputs(0));

        vm.prank(PROVIDER);
        policyVault.setDatasetActive(datasetId, false);

        assertTrue(!paymentModule.hasAccess(policyId, BUYER));
        assertTrue(!paymentModule.hasDatasetAccess(datasetId, BUYER));
    }

    function testPurchaseRejectsInactiveDataset() public {
        uint256 policyId = _createDatasetPolicy(1 ether, 0, false);
        uint256 datasetId = policyVault.getPolicy(policyId).datasetId;

        vm.prank(PROVIDER);
        policyVault.setDatasetActive(datasetId, false);

        vm.prank(BUYER);
        vm.expectRevert(DatasetInactive.selector);
        paymentModule.purchase{value: 1 ether}(policyId, BUYER, _emptyRuntimeInputs(0));
    }

    function testPurchaseRejectsZeroPayoutAddress() public {
        ZeroPayoutPolicyVaultV2 zeroPayoutVault = new ZeroPayoutPolicyVaultV2(1 ether);

        vm.prank(UPGRADE_OWNER);
        paymentModule.setPolicyVault(address(zeroPayoutVault));

        vm.prank(BUYER);
        vm.expectRevert(INVALID_PAYOUT_ADDRESS_SELECTOR);
        paymentModule.purchase{value: 1 ether}(1, BUYER, _emptyRuntimeInputs(0));
    }

    function testCreateUaidBoundPolicyRejectsZeroRequiredUaidHash() public {
        uint256 datasetId = _registerDataset();
        PolicyVault.PolicyConditionInput[] memory conditions = new PolicyVault.PolicyConditionInput[](1);
        conditions[0] = PolicyVault.PolicyConditionInput({
            evaluator: address(uaidOwnershipCondition),
            configData: abi.encode(
                UaidOwnershipCondition.UaidOwnershipConfig({
                    requiredBuyerUaidHash: bytes32(0), identityRegistry: address(agentIdentityRegistry), agentId: 1
                })
            )
        });
        vm.prank(PROVIDER);
        vm.expectRevert(InvalidRequiredBuyerUaid.selector);
        policyVault.createPolicyForDataset(datasetId, PAYOUT, address(0), 1 ether, POLICY_METADATA_HASH, conditions);
    }

    function testCreateUaidBoundPolicyRejectsZeroIdentityRegistry() public {
        uint256 datasetId = _registerDataset();
        PolicyVault.PolicyConditionInput[] memory conditions = new PolicyVault.PolicyConditionInput[](1);
        conditions[0] = PolicyVault.PolicyConditionInput({
            evaluator: address(uaidOwnershipCondition),
            configData: abi.encode(
                UaidOwnershipCondition.UaidOwnershipConfig({
                    requiredBuyerUaidHash: keccak256(bytes(REQUIRED_BUYER_UAID)),
                    identityRegistry: address(0),
                    agentId: 1
                })
            )
        });
        vm.prank(PROVIDER);
        vm.expectRevert(InvalidIdentityRegistry.selector);
        policyVault.createPolicyForDataset(datasetId, PAYOUT, address(0), 1 ether, POLICY_METADATA_HASH, conditions);
    }

    function testCreateUaidBoundPolicyRejectsZeroAgentId() public {
        uint256 datasetId = _registerDataset();
        PolicyVault.PolicyConditionInput[] memory conditions = new PolicyVault.PolicyConditionInput[](1);
        conditions[0] = PolicyVault.PolicyConditionInput({
            evaluator: address(uaidOwnershipCondition),
            configData: abi.encode(
                UaidOwnershipCondition.UaidOwnershipConfig({
                    requiredBuyerUaidHash: keccak256(bytes(REQUIRED_BUYER_UAID)),
                    identityRegistry: address(agentIdentityRegistry),
                    agentId: 0
                })
            )
        });
        vm.prank(PROVIDER);
        vm.expectRevert(InvalidAgentId.selector);
        policyVault.createPolicyForDataset(datasetId, PAYOUT, address(0), 1 ether, POLICY_METADATA_HASH, conditions);
    }

    function testCreateUaidBoundPolicyRejectsUnknownExternalIdentity() public {
        uint256 datasetId = _registerDataset();
        PolicyVault.PolicyConditionInput[] memory conditions = new PolicyVault.PolicyConditionInput[](1);
        conditions[0] = PolicyVault.PolicyConditionInput({
            evaluator: address(uaidOwnershipCondition),
            configData: abi.encode(
                UaidOwnershipCondition.UaidOwnershipConfig({
                    requiredBuyerUaidHash: keccak256(bytes(REQUIRED_BUYER_UAID)),
                    identityRegistry: address(agentIdentityRegistry),
                    agentId: 999
                })
            )
        });
        vm.prank(PROVIDER);
        vm.expectRevert(AgentIdentityNotFound.selector);
        policyVault.createPolicyForDataset(datasetId, PAYOUT, address(0), 1 ether, POLICY_METADATA_HASH, conditions);
    }

    function testPurchaseRejectsUaidBoundPolicyWithoutUaid() public {
        uint256 agentId = _registerBuyerAgent(BUYER, "volatility-agent");
        uint256 policyId = _createUaidBoundPolicy(1 ether, 0, REQUIRED_BUYER_UAID, agentId);
        bytes[] memory runtimeInputs = _emptyRuntimeInputs(1);

        _assertPolicyConditionFailure(BUYER, policyId, BUYER, runtimeInputs, 1 ether, 0);
    }

    function testPurchaseRejectsUaidMismatch() public {
        uint256 agentId = _registerBuyerAgent(BUYER, "volatility-agent");
        uint256 policyId = _createUaidBoundPolicy(1 ether, 0, REQUIRED_BUYER_UAID, agentId);
        bytes[] memory runtimeInputs =
            _runtimeInputsForUaid(1, 0, "uaid:aid:wrong;uid=46630:1;registry=erc-8004;proto=erc-8004;nativeId=46630:1");

        _assertPolicyConditionFailure(BUYER, policyId, BUYER, runtimeInputs, 1 ether, 0);
    }

    function testPurchaseRejectsAgentOwnershipMismatch() public {
        uint256 agentId = _registerBuyerAgent(BUYER, "volatility-agent");
        uint256 policyId = _createUaidBoundPolicy(1 ether, 0, REQUIRED_BUYER_UAID, agentId);
        bytes[] memory runtimeInputs = _runtimeInputsForUaid(1, 0, REQUIRED_BUYER_UAID);

        _assertPolicyConditionFailure(OTHER_BUYER, policyId, OTHER_BUYER, runtimeInputs, 1 ether, 0);
    }
}
