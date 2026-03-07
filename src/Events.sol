// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

abstract contract PolicyVaultEvents {
    event PolicyEvaluatorRegistered(
        address indexed evaluator, address indexed registrant, bytes32 metadataHash, uint256 feePaid, bool builtIn
    );
    event PolicyEvaluatorStatusUpdated(address indexed evaluator, bool active);
    event PolicyEvaluatorFeeUpdated(uint256 registrationFee);
    event PolicyEvaluatorFeeRecipientUpdated(address indexed feeRecipient);

    event DatasetRegistered(
        uint256 indexed datasetId,
        address indexed provider,
        bytes32 ciphertextHash,
        bytes32 keyCommitment,
        bytes32 metadataHash,
        bytes32 providerUaidHash
    );

    event DatasetStatusUpdated(uint256 indexed datasetId, bool active);

    event PolicyCreated(
        uint256 indexed policyId,
        uint256 indexed datasetId,
        address indexed provider,
        address payout,
        address paymentToken,
        uint256 price,
        bytes32 conditionsHash,
        uint32 conditionCount,
        bytes32 metadataHash,
        bytes32 datasetMetadataHash
    );

    event PolicyUpdated(
        uint256 indexed policyId, uint256 indexed datasetId, uint256 newPrice, bool active, bytes32 newMetadataHash
    );
}

abstract contract PaymentModuleEvents {
    event AccessGranted(
        uint256 indexed policyId,
        uint256 indexed datasetId,
        uint256 indexed receiptTokenId,
        address buyer,
        address recipient,
        address paymentToken,
        uint256 price,
        uint64 purchasedAt,
        bytes32 ciphertextHash,
        bytes32 keyCommitment
    );

    event PolicyVaultUpdated(address indexed policyVault);
    event AccessReceiptUpdated(address indexed accessReceipt);
}

abstract contract AccessReceiptEvents {
    event ReceiptMinted(
        uint256 indexed receiptTokenId,
        uint256 indexed policyId,
        uint256 indexed datasetId,
        address buyer,
        address recipient,
        address paymentToken,
        uint256 price,
        uint64 purchasedAt,
        bytes32 ciphertextHash,
        bytes32 keyCommitment
    );

    event PaymentModuleUpdated(address indexed paymentModule);
}
