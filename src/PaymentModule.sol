// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {PaymentModuleEvents} from "./Events.sol";
import {
    AlreadyHasReceipt,
    BuyerNotAllowlisted,
    BuyerDoesNotOwnRequiredAgent,
    BuyerUaidMismatch,
    BuyerUaidRequired,
    DatasetInactive,
    InvalidModuleAddress,
    InvalidPolicyType,
    InvalidPaymentToken,
    InvalidPayoutAddress,
    InvalidPrice,
    PaymentFailed,
    PolicyExpired,
    PolicyInactive
} from "./Errors.sol";
import {PolicyVault} from "./PolicyVault.sol";
import {AccessReceipt} from "./AccessReceipt.sol";
import {IIdentityRegistry} from "./IIdentityRegistry.sol";
import {UpgradeableReentrancyGuard} from "./UpgradeableReentrancyGuard.sol";

contract PaymentModule is
    Initializable,
    Ownable2StepUpgradeable,
    UUPSUpgradeable,
    UpgradeableReentrancyGuard,
    PaymentModuleEvents
{
    bytes32 private constant POLICY_TYPE_TIMEBOUND = keccak256("TIMEBOUND_V1");
    bytes32 private constant POLICY_TYPE_UAID_ERC8004 = keccak256("UAID_ERC8004_V1");

    PolicyVault public policyVault;
    AccessReceipt public accessReceipt;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner, address policyVaultAddress, address accessReceiptAddress)
        external
        initializer
    {
        __Ownable_init(initialOwner);
        __Ownable2Step_init();
        _upgradeableReentrancyGuardInit();

        _setPolicyVault(policyVaultAddress);
        _setAccessReceipt(accessReceiptAddress);
    }

    function setPolicyVault(address policyVaultAddress) external onlyOwner {
        _setPolicyVault(policyVaultAddress);
    }

    function setAccessReceipt(address accessReceiptAddress) external onlyOwner {
        _setAccessReceipt(accessReceiptAddress);
    }

    function purchase(uint256 policyId, address recipient, string calldata buyerUaid)
        external
        payable
        nonReentrant
        returns (uint256 receiptTokenId)
    {
        PolicyVault.Policy memory policy = policyVault.getPolicy(policyId);
        PolicyVault.Dataset memory dataset = policyVault.getDataset(policy.datasetId);

        if (!policy.active) {
            revert PolicyInactive();
        }
        if (policy.expiresAt != 0 && policy.expiresAt <= block.timestamp) {
            revert PolicyExpired();
        }
        if (!dataset.active) {
            revert DatasetInactive();
        }
        if (policy.paymentToken != address(0)) {
            revert InvalidPaymentToken();
        }
        if (policy.allowlistEnabled && !policyVault.isAllowlisted(policyId, msg.sender)) {
            revert BuyerNotAllowlisted();
        }
        if (accessReceipt.receiptOfPolicyAndBuyer(policyId, msg.sender) != 0) {
            revert AlreadyHasReceipt();
        }
        uint96 price = policy.price;
        if (msg.value != price) {
            revert InvalidPrice();
        }
        _validateBuyerPolicyRequirements(policy, buyerUaid);

        address payout = policy.payout;
        if (payout == address(0)) {
            revert InvalidPayoutAddress();
        }
        (bool success,) = payout.call{value: msg.value}("");
        if (!success) {
            revert PaymentFailed();
        }

        address normalizedRecipient = recipient == address(0) ? msg.sender : recipient;
        uint64 purchasedAt = uint64(block.timestamp);

        receiptTokenId = accessReceipt.mintReceipt(
            msg.sender,
            normalizedRecipient,
            policyId,
            policy.datasetId,
            policy.paymentToken,
            price,
            purchasedAt,
            dataset.ciphertextHash,
            dataset.keyCommitment
        );

        emit AccessGranted(
            policyId,
            policy.datasetId,
            receiptTokenId,
            msg.sender,
            normalizedRecipient,
            policy.paymentToken,
            price,
            purchasedAt,
            dataset.ciphertextHash,
            dataset.keyCommitment
        );
    }

    function hasAccess(uint256 policyId, address buyer) external view returns (bool) {
        if (accessReceipt.receiptOfPolicyAndBuyer(policyId, buyer) == 0) {
            return false;
        }

        PolicyVault.Policy memory policy = policyVault.getPolicy(policyId);
        if (!policy.active) {
            return false;
        }
        if (policy.expiresAt != 0 && policy.expiresAt <= block.timestamp) {
            return false;
        }

        return policyVault.getDataset(policy.datasetId).active;
    }

    function hasDatasetAccess(uint256 datasetId, address buyer) external view returns (bool) {
        if (!policyVault.getDataset(datasetId).active) {
            return false;
        }

        uint256 datasetPolicyCount = policyVault.getDatasetPolicyCount(datasetId);
        for (uint256 index = 0; index < datasetPolicyCount; ++index) {
            uint256 policyId = policyVault.getDatasetPolicyIdAt(datasetId, index);
            if (accessReceipt.receiptOfPolicyAndBuyer(policyId, buyer) == 0) {
                continue;
            }

            PolicyVault.Policy memory policy = policyVault.getPolicy(policyId);
            if (!policy.active) {
                continue;
            }
            if (policy.expiresAt != 0 && policy.expiresAt <= block.timestamp) {
                continue;
            }

            return true;
        }

        return false;
    }

    function receiptOfPolicyAndBuyer(uint256 policyId, address buyer) external view returns (uint256) {
        return accessReceipt.receiptOfPolicyAndBuyer(policyId, buyer);
    }

    function _authorizeUpgrade(address newImplementation) internal view override onlyOwner {
        newImplementation;
    }

    function _setPolicyVault(address policyVaultAddress) internal {
        if (policyVaultAddress == address(0)) {
            revert InvalidModuleAddress();
        }
        policyVault = PolicyVault(policyVaultAddress);
        emit PolicyVaultUpdated(policyVaultAddress);
    }

    function _setAccessReceipt(address accessReceiptAddress) internal {
        if (accessReceiptAddress == address(0)) {
            revert InvalidModuleAddress();
        }
        accessReceipt = AccessReceipt(accessReceiptAddress);
        emit AccessReceiptUpdated(accessReceiptAddress);
    }

    function _validateBuyerPolicyRequirements(PolicyVault.Policy memory policy, string calldata buyerUaid)
        internal
        view
    {
        if (policy.policyType == POLICY_TYPE_TIMEBOUND) {
            return;
        }
        if (policy.policyType != POLICY_TYPE_UAID_ERC8004) {
            revert InvalidPolicyType();
        }
        if (bytes(buyerUaid).length == 0) {
            revert BuyerUaidRequired();
        }
        if (keccak256(bytes(buyerUaid)) != policy.requiredBuyerUaidHash) {
            revert BuyerUaidMismatch();
        }
        if (IIdentityRegistry(policy.identityRegistry).ownerOf(policy.agentId) != msg.sender) {
            revert BuyerDoesNotOwnRequiredAgent();
        }
    }
}
