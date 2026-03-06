// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

abstract contract ProgrammableSecretsEvents {
    event OfferCreated(
        uint256 indexed offerId,
        address indexed provider,
        address indexed payout,
        address paymentToken,
        uint256 price,
        uint64 expiresAt,
        bytes32 ciphertextHash,
        bytes32 keyCommitment,
        bytes32 metadataHash,
        bytes32 providerUaidHash
    );

    event OfferUpdated(
        uint256 indexed offerId, uint256 newPrice, uint64 newExpiresAt, bool active, bytes32 newMetadataHash
    );

    event AccessPurchased(
        uint256 indexed offerId,
        address indexed buyer,
        address indexed recipient,
        address paymentToken,
        uint256 price,
        uint64 purchasedAt,
        bytes32 ciphertextHash,
        bytes32 keyCommitment
    );
}

