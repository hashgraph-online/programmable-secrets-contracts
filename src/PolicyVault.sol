// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IPolicyCondition} from "./IPolicyCondition.sol";
import {PolicyVaultEvents} from "./Events.sol";
import {
    DatasetInactive,
    DatasetNotFound,
    EvaluatorAlreadyRegistered,
    EvaluatorInactive,
    EvaluatorNotRegistered,
    EvaluatorRegistrationPayoutFailed,
    InvalidConditionEvaluator,
    InvalidDatasetHashes,
    InvalidEvaluatorMetadataHash,
    InvalidEvaluatorRegistrationFee,
    InvalidFeeRecipient,
    InvalidPaymentToken,
    InvalidPolicyHashes,
    InvalidPrice,
    NotDatasetProvider,
    NotPolicyProvider,
    PolicyNotFound,
    TooManyPolicyConditions
} from "./Errors.sol";

contract PolicyVault is Initializable, Ownable2StepUpgradeable, UUPSUpgradeable, PolicyVaultEvents {
    uint32 public constant MAX_POLICY_CONDITIONS = 16;

    struct PolicyConditionInput {
        address evaluator;
        bytes configData;
    }

    struct Policy {
        address provider;
        address payout;
        address paymentToken;
        uint96 price;
        uint64 createdAt;
        bool active;
        bool allowlistEnabled;
        bytes32 ciphertextHash;
        bytes32 keyCommitment;
        bytes32 metadataHash;
        bytes32 providerUaidHash;
        uint256 datasetId;
        bytes32 conditionsHash;
        uint32 conditionCount;
    }

    struct Dataset {
        address provider;
        uint64 createdAt;
        bool active;
        bytes32 ciphertextHash;
        bytes32 keyCommitment;
        bytes32 metadataHash;
        bytes32 providerUaidHash;
    }

    struct StoredPolicyCondition {
        address evaluator;
        bytes configData;
        bytes32 configHash;
    }

    struct PolicyEvaluatorRegistration {
        address registrant;
        bytes32 metadataHash;
        uint64 registeredAt;
        bool active;
        bool builtIn;
    }

    uint256 public evaluatorRegistrationFee;
    address public evaluatorFeeRecipient;

    uint256 public policyCount;
    mapping(uint256 => Policy) private policies;
    mapping(uint256 => StoredPolicyCondition[]) private policyConditions;
    uint256 public datasetCount;
    mapping(uint256 => Dataset) private datasets;
    mapping(uint256 => uint256[]) private datasetPolicyIds;
    mapping(address => PolicyEvaluatorRegistration) private evaluatorRegistrations;
    address[] private evaluatorRegistryIndex;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) external initializer {
        __Ownable_init(initialOwner);
        __Ownable2Step_init();
        evaluatorRegistrationFee = 0.05 ether;
        evaluatorFeeRecipient = initialOwner;
    }

    function registerPolicyEvaluator(address evaluator, bytes32 metadataHash) external payable {
        _registerPolicyEvaluator(evaluator, msg.sender, metadataHash, msg.value, false);
    }

    function registerBuiltInEvaluator(address evaluator, bytes32 metadataHash) external onlyOwner {
        _registerPolicyEvaluator(evaluator, msg.sender, metadataHash, 0, true);
    }

    function setPolicyEvaluatorActive(address evaluator, bool active) external onlyOwner {
        PolicyEvaluatorRegistration storage registration = _getEvaluatorRegistrationStorage(evaluator);
        registration.active = active;
        emit PolicyEvaluatorStatusUpdated(evaluator, active);
    }

    function setEvaluatorRegistrationFee(uint256 newFee) external onlyOwner {
        evaluatorRegistrationFee = newFee;
        emit PolicyEvaluatorFeeUpdated(newFee);
    }

    function setEvaluatorFeeRecipient(address newFeeRecipient) external onlyOwner {
        if (newFeeRecipient == address(0)) {
            revert InvalidFeeRecipient();
        }
        evaluatorFeeRecipient = newFeeRecipient;
        emit PolicyEvaluatorFeeRecipientUpdated(newFeeRecipient);
    }

    function registerDataset(
        bytes32 ciphertextHash,
        bytes32 keyCommitment,
        bytes32 metadataHash,
        bytes32 providerUaidHash
    ) external returns (uint256 datasetId) {
        datasetId = _registerDataset(msg.sender, ciphertextHash, keyCommitment, metadataHash, providerUaidHash);
    }

    function setDatasetActive(uint256 datasetId, bool active) external {
        Dataset storage dataset = _getDatasetStorage(datasetId);
        if (dataset.provider != msg.sender) {
            revert NotDatasetProvider();
        }

        dataset.active = active;
        emit DatasetStatusUpdated(datasetId, active);
    }

    function createPolicyForDataset(
        uint256 datasetId,
        address payout,
        address paymentToken,
        uint96 price,
        bytes32 metadataHash,
        PolicyConditionInput[] calldata conditions
    ) external returns (uint256 policyId) {
        policyId = _createPolicyForDataset(msg.sender, datasetId, payout, paymentToken, price, metadataHash, conditions);
    }

    function updatePolicy(uint256 policyId, uint96 newPrice, bool active, bytes32 newMetadataHash) external {
        Policy storage policy = _getPolicyStorage(policyId);

        if (policy.provider != msg.sender) {
            revert NotPolicyProvider();
        }
        if (newPrice == 0) {
            revert InvalidPrice();
        }
        if (newMetadataHash == bytes32(0)) {
            revert InvalidPolicyHashes();
        }

        policy.price = newPrice;
        policy.active = active;
        policy.metadataHash = newMetadataHash;

        emit PolicyUpdated(policyId, policy.datasetId, newPrice, active, newMetadataHash);
    }

    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        return _getPolicyStorage(policyId);
    }

    function getDataset(uint256 datasetId) external view returns (Dataset memory) {
        return _getDatasetStorage(datasetId);
    }

    function getDatasetPolicyCount(uint256 datasetId) external view returns (uint256) {
        _getDatasetStorage(datasetId);
        return datasetPolicyIds[datasetId].length;
    }

    function getDatasetPolicyIdAt(uint256 datasetId, uint256 index) external view returns (uint256) {
        _getDatasetStorage(datasetId);
        return datasetPolicyIds[datasetId][index];
    }

    function getDatasetPolicyIds(uint256 datasetId) external view returns (uint256[] memory) {
        _getDatasetStorage(datasetId);
        return datasetPolicyIds[datasetId];
    }

    function getPolicyConditionCount(uint256 policyId) external view returns (uint256) {
        _getPolicyStorage(policyId);
        return policyConditions[policyId].length;
    }

    function getPolicyCondition(uint256 policyId, uint256 index)
        external
        view
        returns (address evaluator, bytes memory configData, bytes32 configHash)
    {
        _getPolicyStorage(policyId);
        StoredPolicyCondition storage condition = policyConditions[policyId][index];
        return (condition.evaluator, condition.configData, condition.configHash);
    }

    function getPolicyEvaluator(address evaluator) external view returns (PolicyEvaluatorRegistration memory) {
        return _getEvaluatorRegistrationStorage(evaluator);
    }

    function getPolicyEvaluatorCount() external view returns (uint256) {
        return evaluatorRegistryIndex.length;
    }

    function getPolicyEvaluatorAt(uint256 index) external view returns (address evaluator) {
        return evaluatorRegistryIndex[index];
    }

    function _authorizeUpgrade(address newImplementation) internal view override onlyOwner {
        newImplementation;
    }

    function _getPolicyStorage(uint256 policyId) internal view returns (Policy storage policy) {
        policy = policies[policyId];
        if (policy.provider == address(0)) {
            revert PolicyNotFound();
        }
    }

    function _getDatasetStorage(uint256 datasetId) internal view returns (Dataset storage dataset) {
        dataset = datasets[datasetId];
        if (dataset.provider == address(0)) {
            revert DatasetNotFound();
        }
    }

    function _getEvaluatorRegistrationStorage(address evaluator)
        internal
        view
        returns (PolicyEvaluatorRegistration storage registration)
    {
        registration = evaluatorRegistrations[evaluator];
        if (registration.registrant == address(0)) {
            revert EvaluatorNotRegistered();
        }
    }

    function _registerPolicyEvaluator(
        address evaluator,
        address registrant,
        bytes32 metadataHash,
        uint256 feePaid,
        bool builtIn
    ) internal {
        if (evaluator == address(0) || evaluator.code.length == 0) {
            revert InvalidConditionEvaluator();
        }
        if (metadataHash == bytes32(0)) {
            revert InvalidEvaluatorMetadataHash();
        }
        if (evaluatorRegistrations[evaluator].registrant != address(0)) {
            revert EvaluatorAlreadyRegistered();
        }
        if (builtIn) {
            if (feePaid != 0) {
                revert InvalidEvaluatorRegistrationFee(0, feePaid);
            }
        } else if (feePaid != evaluatorRegistrationFee) {
            revert InvalidEvaluatorRegistrationFee(evaluatorRegistrationFee, feePaid);
        }

        evaluatorRegistrations[evaluator] = PolicyEvaluatorRegistration({
            registrant: registrant,
            metadataHash: metadataHash,
            registeredAt: uint64(block.timestamp),
            active: true,
            builtIn: builtIn
        });
        evaluatorRegistryIndex.push(evaluator);

        if (!builtIn && feePaid != 0) {
            address feeRecipient = evaluatorFeeRecipient;
            if (feeRecipient == address(0)) {
                revert InvalidFeeRecipient();
            }
            (bool success,) = feeRecipient.call{value: feePaid}("");
            if (!success) {
                revert EvaluatorRegistrationPayoutFailed();
            }
        }

        emit PolicyEvaluatorRegistered(evaluator, registrant, metadataHash, feePaid, builtIn);
    }

    function _registerDataset(
        address provider,
        bytes32 ciphertextHash,
        bytes32 keyCommitment,
        bytes32 metadataHash,
        bytes32 providerUaidHash
    ) internal returns (uint256 datasetId) {
        _validateDatasetHashes(ciphertextHash, keyCommitment, metadataHash, providerUaidHash);

        datasetId = ++datasetCount;
        datasets[datasetId] = Dataset({
            provider: provider,
            createdAt: uint64(block.timestamp),
            active: true,
            ciphertextHash: ciphertextHash,
            keyCommitment: keyCommitment,
            metadataHash: metadataHash,
            providerUaidHash: providerUaidHash
        });

        emit DatasetRegistered(datasetId, provider, ciphertextHash, keyCommitment, metadataHash, providerUaidHash);
    }

    function _createPolicyForDataset(
        address provider,
        uint256 datasetId,
        address payout,
        address paymentToken,
        uint96 price,
        bytes32 metadataHash,
        PolicyConditionInput[] calldata conditions
    ) internal returns (uint256 policyId) {
        Dataset storage dataset = _getDatasetStorage(datasetId);
        policyId = policyCount + 1;

        if (dataset.provider != provider) {
            revert NotDatasetProvider();
        }
        if (!dataset.active) {
            revert DatasetInactive();
        }
        if (paymentToken != address(0)) {
            revert InvalidPaymentToken();
        }
        if (price == 0) {
            revert InvalidPrice();
        }
        _validatePolicyMetadataHash(metadataHash);

        bytes32 conditionsHash = _storePolicyConditions(provider, datasetId, policyId, conditions);
        policyCount = policyId;

        address normalizedPayout = payout == address(0) ? provider : payout;
        policies[policyId] = Policy({
            provider: provider,
            payout: normalizedPayout,
            paymentToken: paymentToken,
            price: price,
            createdAt: uint64(block.timestamp),
            active: true,
            allowlistEnabled: false,
            ciphertextHash: dataset.ciphertextHash,
            keyCommitment: dataset.keyCommitment,
            metadataHash: metadataHash,
            providerUaidHash: dataset.providerUaidHash,
            datasetId: datasetId,
            conditionsHash: conditionsHash,
            conditionCount: uint32(conditions.length)
        });
        datasetPolicyIds[datasetId].push(policyId);

        emit PolicyCreated(
            policyId,
            datasetId,
            provider,
            normalizedPayout,
            paymentToken,
            price,
            conditionsHash,
            uint32(conditions.length),
            metadataHash,
            dataset.metadataHash
        );
    }

    function _storePolicyConditions(
        address provider,
        uint256 datasetId,
        uint256 nextPolicyId,
        PolicyConditionInput[] calldata conditions
    ) internal returns (bytes32 conditionsHash) {
        uint256 conditionCount = conditions.length;
        if (conditionCount > MAX_POLICY_CONDITIONS) {
            revert TooManyPolicyConditions(conditionCount, MAX_POLICY_CONDITIONS);
        }
        bytes32[] memory conditionEntryHashes = new bytes32[](conditionCount);

        for (uint256 index = 0; index < conditionCount; ++index) {
            PolicyConditionInput calldata condition = conditions[index];
            if (condition.evaluator == address(0)) {
                revert InvalidConditionEvaluator();
            }
            PolicyEvaluatorRegistration storage registration = _getEvaluatorRegistrationStorage(condition.evaluator);
            if (!registration.active) {
                revert EvaluatorInactive();
            }

            IPolicyCondition(condition.evaluator)
                .validateCondition(address(this), provider, datasetId, condition.configData);

            bytes32 configHash = keccak256(condition.configData);
            policyConditions[nextPolicyId].push(
                StoredPolicyCondition({
                    evaluator: condition.evaluator, configData: condition.configData, configHash: configHash
                })
            );
            conditionEntryHashes[index] = keccak256(abi.encode(condition.evaluator, configHash));
        }
        conditionsHash = keccak256(abi.encode(conditionEntryHashes));
    }

    function _validateDatasetHashes(
        bytes32 ciphertextHash,
        bytes32 keyCommitment,
        bytes32 metadataHash,
        bytes32 providerUaidHash
    ) internal pure {
        if (
            ciphertextHash == bytes32(0) || keyCommitment == bytes32(0) || metadataHash == bytes32(0)
                || providerUaidHash == bytes32(0)
        ) {
            revert InvalidDatasetHashes();
        }
    }

    function _validatePolicyMetadataHash(bytes32 metadataHash) internal pure {
        if (metadataHash == bytes32(0)) {
            revert InvalidPolicyHashes();
        }
    }
}
