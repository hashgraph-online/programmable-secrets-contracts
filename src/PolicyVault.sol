// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IIdentityRegistry} from "./IIdentityRegistry.sol";
import {PolicyVaultEvents} from "./Events.sol";
import {
    AgentIdentityNotFound,
    DatasetInactive,
    DatasetNotFound,
    InvalidAgentId,
    InvalidExpiry,
    InvalidIdentityRegistry,
    InvalidDatasetHashes,
    InvalidPaymentToken,
    InvalidPolicyHashes,
    InvalidPolicyType,
    InvalidPrice,
    InvalidRequiredBuyerUaid,
    NotDatasetProvider,
    NotPolicyProvider,
    PolicyNotFound
} from "./Errors.sol";

contract PolicyVault is Initializable, Ownable2StepUpgradeable, UUPSUpgradeable, PolicyVaultEvents {
    bytes32 public constant POLICY_TYPE_TIMEBOUND = keccak256("TIMEBOUND_V1");
    bytes32 public constant POLICY_TYPE_UAID_ERC8004 = keccak256("UAID_ERC8004_V1");

    struct CreatePolicyConfig {
        address provider;
        uint256 datasetId;
        address payout;
        address paymentToken;
        uint96 price;
        uint64 expiresAt;
        bool allowlistEnabled;
        bytes32 metadataHash;
        bytes32 policyType;
        bytes32 requiredBuyerUaidHash;
        address identityRegistry;
        uint256 agentId;
    }

    struct Policy {
        address provider;
        address payout;
        address paymentToken;
        uint96 price;
        uint64 createdAt;
        uint64 expiresAt;
        bool active;
        bool allowlistEnabled;
        bytes32 ciphertextHash;
        bytes32 keyCommitment;
        bytes32 metadataHash;
        bytes32 providerUaidHash;
        uint256 datasetId;
        bytes32 policyType;
        bytes32 requiredBuyerUaidHash;
        address identityRegistry;
        uint256 agentId;
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

    uint256 public policyCount;
    mapping(uint256 => Policy) private policies;
    mapping(uint256 => mapping(address => bool)) private allowlistedAccounts;
    uint256 public datasetCount;
    mapping(uint256 => Dataset) private datasets;
    mapping(uint256 => uint256[]) private datasetPolicyIds;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) external initializer {
        __Ownable_init(initialOwner);
        __Ownable2Step_init();
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

    function createTimeboundPolicy(
        uint256 datasetId,
        address payout,
        address paymentToken,
        uint96 price,
        uint64 expiresAt,
        bool allowlistEnabled,
        bytes32 metadataHash,
        address[] calldata allowlistAccounts
    ) external returns (uint256 policyId) {
        CreatePolicyConfig memory config = CreatePolicyConfig({
            provider: msg.sender,
            datasetId: datasetId,
            payout: payout,
            paymentToken: paymentToken,
            price: price,
            expiresAt: expiresAt,
            allowlistEnabled: allowlistEnabled,
            metadataHash: metadataHash,
            policyType: POLICY_TYPE_TIMEBOUND,
            requiredBuyerUaidHash: bytes32(0),
            identityRegistry: address(0),
            agentId: 0
        });
        policyId = _createPolicyForDataset(config, allowlistAccounts);
    }

    function createUaidBoundPolicy(
        uint256 datasetId,
        address payout,
        address paymentToken,
        uint96 price,
        uint64 expiresAt,
        bool allowlistEnabled,
        bytes32 metadataHash,
        bytes32 requiredBuyerUaidHash,
        address identityRegistry,
        uint256 agentId,
        address[] calldata allowlistAccounts
    ) external returns (uint256 policyId) {
        CreatePolicyConfig memory config = CreatePolicyConfig({
            provider: msg.sender,
            datasetId: datasetId,
            payout: payout,
            paymentToken: paymentToken,
            price: price,
            expiresAt: expiresAt,
            allowlistEnabled: allowlistEnabled,
            metadataHash: metadataHash,
            policyType: POLICY_TYPE_UAID_ERC8004,
            requiredBuyerUaidHash: requiredBuyerUaidHash,
            identityRegistry: identityRegistry,
            agentId: agentId
        });
        policyId = _createPolicyForDataset(config, allowlistAccounts);
    }

    function createPolicyForDataset(
        uint256 datasetId,
        bytes32 policyType,
        address payout,
        address paymentToken,
        uint96 price,
        uint64 expiresAt,
        bool allowlistEnabled,
        bytes32 metadataHash,
        address[] calldata allowlistAccounts
    ) external returns (uint256 policyId) {
        CreatePolicyConfig memory config = CreatePolicyConfig({
            provider: msg.sender,
            datasetId: datasetId,
            payout: payout,
            paymentToken: paymentToken,
            price: price,
            expiresAt: expiresAt,
            allowlistEnabled: allowlistEnabled,
            metadataHash: metadataHash,
            policyType: policyType,
            requiredBuyerUaidHash: bytes32(0),
            identityRegistry: address(0),
            agentId: 0
        });
        policyId = _createPolicyForDataset(config, allowlistAccounts);
    }

    function updatePolicy(
        uint256 policyId,
        uint96 newPrice,
        uint64 newExpiresAt,
        bool active,
        bool allowlistEnabled,
        bytes32 newMetadataHash
    ) external {
        Policy storage policy = _getPolicyStorage(policyId);

        if (policy.provider != msg.sender) {
            revert NotPolicyProvider();
        }
        if (newPrice == 0) {
            revert InvalidPrice();
        }
        _validateExpiry(newExpiresAt);
        if (newMetadataHash == bytes32(0)) {
            revert InvalidPolicyHashes();
        }

        policy.price = newPrice;
        policy.expiresAt = newExpiresAt;
        policy.active = active;
        policy.allowlistEnabled = allowlistEnabled;
        _validatePolicyMetadataHash(newMetadataHash);
        policy.metadataHash = newMetadataHash;

        emit PolicyUpdated(
            policyId, policy.datasetId, newPrice, newExpiresAt, active, allowlistEnabled, newMetadataHash
        );
    }

    function setAllowlist(uint256 policyId, address[] calldata accounts, bool allowed) external {
        Policy storage policy = _getPolicyStorage(policyId);
        if (policy.provider != msg.sender) {
            revert NotPolicyProvider();
        }
        _setAllowlist(policyId, accounts, allowed);
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

    function isAllowlisted(uint256 policyId, address account) external view returns (bool) {
        Policy storage policy = _getPolicyStorage(policyId);
        if (!policy.allowlistEnabled) {
            return true;
        }
        return allowlistedAccounts[policyId][account];
    }

    function isSupportedPolicyType(bytes32 policyType) public pure returns (bool) {
        return policyType == POLICY_TYPE_TIMEBOUND || policyType == POLICY_TYPE_UAID_ERC8004;
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

    function _createPolicyForDataset(CreatePolicyConfig memory config, address[] calldata allowlistAccounts)
        internal
        returns (uint256 policyId)
    {
        Dataset storage dataset = _getDatasetStorage(config.datasetId);

        if (dataset.provider != config.provider) {
            revert NotDatasetProvider();
        }
        if (!dataset.active) {
            revert DatasetInactive();
        }
        if (!isSupportedPolicyType(config.policyType)) {
            revert InvalidPolicyType();
        }
        if (config.paymentToken != address(0)) {
            revert InvalidPaymentToken();
        }
        if (config.price == 0) {
            revert InvalidPrice();
        }
        _validateExpiry(config.expiresAt);
        _validatePolicyMetadataHash(config.metadataHash);
        _validatePolicyRequirements(config);

        policyId = ++policyCount;

        address normalizedPayout = config.payout == address(0) ? config.provider : config.payout;
        policies[policyId] = Policy({
            provider: config.provider,
            payout: normalizedPayout,
            paymentToken: config.paymentToken,
            price: config.price,
            createdAt: uint64(block.timestamp),
            expiresAt: config.expiresAt,
            active: true,
            allowlistEnabled: config.allowlistEnabled,
            ciphertextHash: dataset.ciphertextHash,
            keyCommitment: dataset.keyCommitment,
            metadataHash: config.metadataHash,
            providerUaidHash: dataset.providerUaidHash,
            datasetId: config.datasetId,
            policyType: config.policyType,
            requiredBuyerUaidHash: config.requiredBuyerUaidHash,
            identityRegistry: config.identityRegistry,
            agentId: config.agentId
        });
        datasetPolicyIds[config.datasetId].push(policyId);

        if (allowlistAccounts.length > 0) {
            _setAllowlist(policyId, allowlistAccounts, true);
        }

        emit PolicyCreated(
            policyId,
            config.datasetId,
            config.provider,
            normalizedPayout,
            config.paymentToken,
            config.policyType,
            config.price,
            config.expiresAt,
            config.allowlistEnabled,
            config.metadataHash,
            dataset.metadataHash
        );
    }

    function _setAllowlist(uint256 policyId, address[] calldata accounts, bool allowed) internal {
        uint256 accountsLength = accounts.length;
        for (uint256 index = 0; index < accountsLength; ++index) {
            address account = accounts[index];
            allowlistedAccounts[policyId][account] = allowed;
            emit AllowlistUpdated(policyId, account, allowed);
        }
    }

    function _validateExpiry(uint64 expiresAt) internal view {
        if (expiresAt != 0 && expiresAt <= block.timestamp) {
            revert InvalidExpiry();
        }
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

    function _validatePolicyRequirements(CreatePolicyConfig memory config) internal view {
        if (config.policyType != POLICY_TYPE_UAID_ERC8004) {
            return;
        }
        if (config.requiredBuyerUaidHash == bytes32(0)) {
            revert InvalidRequiredBuyerUaid();
        }
        if (config.identityRegistry == address(0)) {
            revert InvalidIdentityRegistry();
        }
        if (config.agentId == 0) {
            revert InvalidAgentId();
        }
        try IIdentityRegistry(config.identityRegistry).ownerOf(config.agentId) returns (address owner) {
            if (owner == address(0)) {
                revert AgentIdentityNotFound();
            }
        } catch {
            revert AgentIdentityNotFound();
        }
    }
}
