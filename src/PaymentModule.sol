// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IPolicyCondition} from "./IPolicyCondition.sol";
import {PaymentModuleEvents} from "./Events.sol";
import {
    AlreadyHasReceipt,
    DatasetInactive,
    InvalidConditionInputCount,
    InvalidModuleAddress,
    InvalidPaymentToken,
    InvalidPayoutAddress,
    InvalidPrice,
    PaymentFailed,
    PolicyConditionFailed,
    PolicyInactive
} from "./Errors.sol";
import {PolicyVault} from "./PolicyVault.sol";
import {AccessReceipt} from "./AccessReceipt.sol";
import {UpgradeableReentrancyGuard} from "./UpgradeableReentrancyGuard.sol";

contract PaymentModule is
    Initializable,
    Ownable2StepUpgradeable,
    UUPSUpgradeable,
    UpgradeableReentrancyGuard,
    PaymentModuleEvents
{
    uint16 public constant PROTOCOL_FEE_BPS = 300;
    uint16 internal constant BPS_DENOMINATOR = 10_000;

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

    function purchase(uint256 policyId, address recipient, bytes[] calldata conditionRuntimeInputs)
        external
        payable
        nonReentrant
        returns (uint256 receiptTokenId)
    {
        PolicyVault.Policy memory policy = policyVault.getPolicy(policyId);
        PolicyVault.Dataset memory dataset = policyVault.getDataset(policy.datasetId);
        address normalizedRecipient = recipient == address(0) ? msg.sender : recipient;

        if (!policy.active) {
            revert PolicyInactive();
        }
        if (!dataset.active) {
            revert DatasetInactive();
        }
        if (policy.paymentToken != address(0)) {
            revert InvalidPaymentToken();
        }
        if (accessReceipt.receiptOfDatasetAndBuyer(policy.datasetId, msg.sender) != 0) {
            revert AlreadyHasReceipt();
        }
        if (accessReceipt.receiptOfPolicyAndBuyer(policyId, msg.sender) != 0) {
            revert AlreadyHasReceipt();
        }
        uint96 price = policy.price;
        if (msg.value != price) {
            revert InvalidPrice();
        }
        _validatePurchaseConditions(policyId, msg.sender, normalizedRecipient, conditionRuntimeInputs);

        address payout = policy.payout;
        if (payout == address(0)) {
            revert InvalidPayoutAddress();
        }
        _settlePayment(payout, price);

        uint64 purchasedAt = uint64(block.timestamp);

        receiptTokenId = accessReceipt.mintReceipt(
            msg.sender,
            normalizedRecipient,
            policyId,
            policy.datasetId,
            policy.paymentToken,
            price,
            purchasedAt,
            policy.receiptTransferable,
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
            policy.receiptTransferable,
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

        return policyVault.getDataset(policy.datasetId).active;
    }

    function hasDatasetAccess(uint256 datasetId, address buyer) external view returns (bool) {
        if (!policyVault.getDataset(datasetId).active) {
            return false;
        }
        uint256 receiptTokenId = accessReceipt.receiptOfDatasetAndBuyer(datasetId, buyer);
        if (receiptTokenId == 0) {
            return false;
        }

        AccessReceipt.Receipt memory receipt = accessReceipt.getReceipt(receiptTokenId);
        PolicyVault.Policy memory policy = policyVault.getPolicy(receipt.policyId);
        if (!policy.active) {
            return false;
        }

        return true;
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

    function _settlePayment(address payout, uint96 price) internal {
        address protocolFeeRecipient = owner();
        uint256 protocolFee = (uint256(price) * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;

        if (protocolFee == 0 || protocolFeeRecipient == payout) {
            (bool success,) = payout.call{value: uint256(price)}("");
            if (!success) {
                revert PaymentFailed();
            }
            return;
        }

        uint256 providerProceeds = uint256(price) - protocolFee;
        (bool protocolFeeSuccess,) = protocolFeeRecipient.call{value: protocolFee}("");
        if (!protocolFeeSuccess) {
            revert PaymentFailed();
        }

        (bool payoutSuccess,) = payout.call{value: providerProceeds}("");
        if (!payoutSuccess) {
            revert PaymentFailed();
        }
    }

    function _validatePurchaseConditions(
        uint256 policyId,
        address buyer,
        address recipient,
        bytes[] calldata conditionRuntimeInputs
    ) internal view {
        uint256 conditionCount = policyVault.getPolicyConditionCount(policyId);
        if (conditionCount != conditionRuntimeInputs.length) {
            revert InvalidConditionInputCount();
        }

        for (uint256 index = 0; index < conditionCount; ++index) {
            (address evaluator, bytes memory configData,) = policyVault.getPolicyCondition(policyId, index);
            bool allowed = IPolicyCondition(evaluator)
                .isPurchaseAllowed(
                    address(policyVault), policyId, buyer, recipient, configData, conditionRuntimeInputs[index]
                );
            if (!allowed) {
                revert PolicyConditionFailed(index);
            }
        }
    }
}
