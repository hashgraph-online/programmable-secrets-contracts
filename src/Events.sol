// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

abstract contract PolicyVaultEvents {
    event PolicyCreated(
        uint256 indexed policyId,
        address indexed provider,
        address indexed payout,
        address paymentToken,
        uint256 price,
        uint64 expiresAt,
        bool allowlistEnabled,
        bytes32 ciphertextHash,
        bytes32 keyCommitment,
        bytes32 metadataHash,
        bytes32 providerUaidHash
    );

    event PolicyUpdated(
        uint256 indexed policyId,
        uint256 newPrice,
        uint64 newExpiresAt,
        bool active,
        bool allowlistEnabled,
        bytes32 newMetadataHash
    );

    event AllowlistUpdated(uint256 indexed policyId, address indexed account, bool allowed);
}

abstract contract PaymentModuleEvents {
    event AccessGranted(
        uint256 indexed policyId,
        uint256 indexed receiptTokenId,
        address indexed buyer,
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
        address indexed buyer,
        address recipient,
        address paymentToken,
        uint256 price,
        uint64 purchasedAt,
        bytes32 ciphertextHash,
        bytes32 keyCommitment
    );

    event PaymentModuleUpdated(address indexed paymentModule);
}
