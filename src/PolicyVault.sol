// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {PolicyVaultEvents} from "./Events.sol";
import {
    InvalidExpiry,
    InvalidPaymentToken,
    InvalidPolicyHashes,
    InvalidPrice,
    NotPolicyProvider,
    PolicyNotFound
} from "./Errors.sol";

contract PolicyVault is Initializable, Ownable2StepUpgradeable, UUPSUpgradeable, PolicyVaultEvents {
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
    }

    uint256 public policyCount;
    mapping(uint256 => Policy) private policies;
    mapping(uint256 => mapping(address => bool)) private allowlistedAccounts;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) external initializer {
        __Ownable_init(initialOwner);
        __Ownable2Step_init();
    }

    function createPolicy(
        address payout,
        address paymentToken,
        uint96 price,
        uint64 expiresAt,
        bool allowlistEnabled,
        bytes32 ciphertextHash,
        bytes32 keyCommitment,
        bytes32 metadataHash,
        bytes32 providerUaidHash,
        address[] calldata allowlistAccounts
    ) external returns (uint256 policyId) {
        if (paymentToken != address(0)) {
            revert InvalidPaymentToken();
        }
        if (price == 0) {
            revert InvalidPrice();
        }
        _validateExpiry(expiresAt);
        _validatePolicyHashes(ciphertextHash, keyCommitment, metadataHash, providerUaidHash);

        policyId = ++policyCount;

        address normalizedPayout = payout == address(0) ? msg.sender : payout;
        policies[policyId] = Policy({
            provider: msg.sender,
            payout: normalizedPayout,
            paymentToken: paymentToken,
            price: price,
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            active: true,
            allowlistEnabled: allowlistEnabled,
            ciphertextHash: ciphertextHash,
            keyCommitment: keyCommitment,
            metadataHash: metadataHash,
            providerUaidHash: providerUaidHash
        });

        if (allowlistAccounts.length > 0) {
            _setAllowlist(policyId, allowlistAccounts, true);
        }

        emit PolicyCreated(
            policyId,
            msg.sender,
            normalizedPayout,
            paymentToken,
            price,
            expiresAt,
            allowlistEnabled,
            ciphertextHash,
            keyCommitment,
            metadataHash,
            providerUaidHash
        );
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
        policy.metadataHash = newMetadataHash;

        emit PolicyUpdated(policyId, newPrice, newExpiresAt, active, allowlistEnabled, newMetadataHash);
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

    function isAllowlisted(uint256 policyId, address account) external view returns (bool) {
        Policy storage policy = _getPolicyStorage(policyId);
        if (!policy.allowlistEnabled) {
            return true;
        }
        return allowlistedAccounts[policyId][account];
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

    function _validatePolicyHashes(
        bytes32 ciphertextHash,
        bytes32 keyCommitment,
        bytes32 metadataHash,
        bytes32 providerUaidHash
    ) internal pure {
        if (
            ciphertextHash == bytes32(0) || keyCommitment == bytes32(0) || metadataHash == bytes32(0)
                || providerUaidHash == bytes32(0)
        ) {
            revert InvalidPolicyHashes();
        }
    }
}
