// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProgrammableSecretsEvents} from "./Events.sol";
import {
    NotOfferProvider,
    OfferNotFound,
    OfferInactive,
    OfferExpired,
    AlreadyPurchased,
    InvalidPrice,
    InvalidPaymentToken,
    PaymentFailed,
    ReentrancyDetected
} from "./Errors.sol";

contract ProgrammableSecrets is ProgrammableSecretsEvents {
    struct Offer {
        address provider;
        address payout;
        address paymentToken;
        uint96 price;
        uint64 createdAt;
        uint64 expiresAt;
        bool active;
        bytes32 ciphertextHash;
        bytes32 keyCommitment;
        bytes32 metadataHash;
        bytes32 providerUaidHash;
    }

    uint256 public offerCount;

    mapping(uint256 => Offer) internal offers;
    mapping(uint256 => mapping(address => uint64)) public purchasedAt;

    uint256 private unlocked = 1;

    modifier nonReentrant() {
        if (unlocked != 1) {
            revert ReentrancyDetected();
        }
        unlocked = 2;
        _;
        unlocked = 1;
    }

    function createOffer(
        address payout,
        address paymentToken,
        uint96 price,
        uint64 expiresAt,
        bytes32 ciphertextHash,
        bytes32 keyCommitment,
        bytes32 metadataHash,
        bytes32 providerUaidHash
    ) external returns (uint256 offerId) {
        if (paymentToken != address(0)) {
            revert InvalidPaymentToken();
        }
        if (price == 0) {
            revert InvalidPrice();
        }

        offerId = ++offerCount;

        offers[offerId] = Offer({
            provider: msg.sender,
            payout: payout == address(0) ? msg.sender : payout,
            paymentToken: paymentToken,
            price: price,
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            active: true,
            ciphertextHash: ciphertextHash,
            keyCommitment: keyCommitment,
            metadataHash: metadataHash,
            providerUaidHash: providerUaidHash
        });

        emit OfferCreated(
            offerId,
            msg.sender,
            offers[offerId].payout,
            paymentToken,
            price,
            expiresAt,
            ciphertextHash,
            keyCommitment,
            metadataHash,
            providerUaidHash
        );
    }

    function updateOffer(uint256 offerId, uint96 newPrice, uint64 newExpiresAt, bool active, bytes32 newMetadataHash)
        external
    {
        Offer storage offer = _getOfferStorage(offerId);

        if (offer.provider != msg.sender) {
            revert NotOfferProvider();
        }
        if (newPrice == 0) {
            revert InvalidPrice();
        }

        offer.price = newPrice;
        offer.expiresAt = newExpiresAt;
        offer.active = active;
        offer.metadataHash = newMetadataHash;

        emit OfferUpdated(offerId, newPrice, newExpiresAt, active, newMetadataHash);
    }

    function getOffer(uint256 offerId) external view returns (Offer memory) {
        return _getOfferStorage(offerId);
    }

    function purchase(uint256 offerId, address recipient) external payable nonReentrant {
        Offer storage offer = _getOfferStorage(offerId);

        if (!offer.active) {
            revert OfferInactive();
        }
        if (offer.expiresAt != 0 && offer.expiresAt < block.timestamp) {
            revert OfferExpired();
        }
        if (offer.paymentToken != address(0)) {
            revert InvalidPaymentToken();
        }
        if (purchasedAt[offerId][msg.sender] != 0) {
            revert AlreadyPurchased();
        }
        if (msg.value != offer.price) {
            revert InvalidPrice();
        }

        uint64 purchasedTimestampValue = uint64(block.timestamp);
        purchasedAt[offerId][msg.sender] = purchasedTimestampValue;

        (bool success,) = offer.payout.call{value: msg.value}("");
        if (!success) {
            revert PaymentFailed();
        }

        emit AccessPurchased(
            offerId,
            msg.sender,
            recipient == address(0) ? msg.sender : recipient,
            offer.paymentToken,
            offer.price,
            purchasedTimestampValue,
            offer.ciphertextHash,
            offer.keyCommitment
        );
    }

    function hasAccess(uint256 offerId, address user) external view returns (bool) {
        return purchasedAt[offerId][user] != 0;
    }

    function purchasedTimestamp(uint256 offerId, address user) external view returns (uint64) {
        return purchasedAt[offerId][user];
    }

    function _getOfferStorage(uint256 offerId) internal view returns (Offer storage offer) {
        offer = offers[offerId];
        if (offer.provider == address(0)) {
            revert OfferNotFound();
        }
    }
}

