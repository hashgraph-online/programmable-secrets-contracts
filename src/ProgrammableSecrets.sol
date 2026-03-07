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
    InvalidExpiry,
    InvalidPaymentToken,
    InvalidOfferHashes,
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

    struct PackedOffer {
        address provider;
        uint96 price;
        address payout;
        uint64 createdAt;
        bool active;
        address paymentToken;
        uint64 expiresAt;
        bytes32 ciphertextHash;
        bytes32 keyCommitment;
        bytes32 metadataHash;
        bytes32 providerUaidHash;
    }

    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    uint256 public offerCount;

    mapping(uint256 => PackedOffer) internal offers;
    mapping(uint256 => mapping(address => uint64)) public purchasedAt;

    uint256 private unlocked = NOT_ENTERED;

    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    /// @notice Creates a new programmable secret offer with immutable integrity anchors.
    /// @dev Hash commitments must be non-zero and expiries must be in the future when set.
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
        _validateExpiry(expiresAt);
        _validateOfferHashes(ciphertextHash, keyCommitment, metadataHash, providerUaidHash);

        offerId = ++offerCount;

        address normalizedPayout = payout == address(0) ? msg.sender : payout;
        uint64 createdAt = uint64(block.timestamp);

        offers[offerId] = PackedOffer({
            provider: msg.sender,
            price: price,
            payout: normalizedPayout,
            createdAt: createdAt,
            active: true,
            paymentToken: paymentToken,
            expiresAt: expiresAt,
            ciphertextHash: ciphertextHash,
            keyCommitment: keyCommitment,
            metadataHash: metadataHash,
            providerUaidHash: providerUaidHash
        });

        emit OfferCreated(
            offerId,
            msg.sender,
            normalizedPayout,
            paymentToken,
            price,
            expiresAt,
            ciphertextHash,
            keyCommitment,
            metadataHash,
            providerUaidHash
        );
    }

    /// @notice Updates mutable offer parameters while preserving the original ciphertext and key commitments.
    function updateOffer(uint256 offerId, uint96 newPrice, uint64 newExpiresAt, bool active, bytes32 newMetadataHash)
        external
    {
        PackedOffer storage offer = _getOfferStorage(offerId);

        if (offer.provider != msg.sender) {
            revert NotOfferProvider();
        }
        if (newPrice == 0) {
            revert InvalidPrice();
        }
        _validateExpiry(newExpiresAt);
        if (newMetadataHash == bytes32(0)) {
            revert InvalidOfferHashes();
        }

        offer.price = newPrice;
        offer.expiresAt = newExpiresAt;
        offer.active = active;
        offer.metadataHash = newMetadataHash;

        emit OfferUpdated(offerId, newPrice, newExpiresAt, active, newMetadataHash);
    }

    /// @notice Returns the externally stable offer view for a given offer id.
    function getOffer(uint256 offerId) external view returns (Offer memory) {
        return _toOffer(_getOfferStorage(offerId));
    }

    /// @notice Purchases access for the caller using exact native ETH payment.
    /// @dev The emitted recipient is informational; on-chain access is always keyed by the buyer address.
    function purchase(uint256 offerId, address recipient) external payable nonReentrant {
        PackedOffer storage offer = _getOfferStorage(offerId);

        if (!offer.active) {
            revert OfferInactive();
        }
        if (offer.expiresAt != 0 && offer.expiresAt <= block.timestamp) {
            revert OfferExpired();
        }
        address paymentToken = offer.paymentToken;
        if (paymentToken != address(0)) {
            revert InvalidPaymentToken();
        }
        if (purchasedAt[offerId][msg.sender] != 0) {
            revert AlreadyPurchased();
        }
        uint96 price = offer.price;
        if (msg.value != price) {
            revert InvalidPrice();
        }

        uint64 purchasedTimestampValue = uint64(block.timestamp);
        purchasedAt[offerId][msg.sender] = purchasedTimestampValue;

        address payout = offer.payout;
        (bool success,) = payout.call{value: msg.value}("");
        if (!success) {
            revert PaymentFailed();
        }

        address normalizedRecipient = recipient == address(0) ? msg.sender : recipient;

        emit AccessPurchased(
            offerId,
            msg.sender,
            normalizedRecipient,
            paymentToken,
            price,
            purchasedTimestampValue,
            offer.ciphertextHash,
            offer.keyCommitment
        );
    }

    /// @notice Returns whether a buyer has already purchased access to an offer.
    function hasAccess(uint256 offerId, address user) external view returns (bool) {
        return purchasedAt[offerId][user] != 0;
    }

    /// @notice Returns the purchase timestamp for a buyer or zero when access has not been purchased.
    function purchasedTimestamp(uint256 offerId, address user) external view returns (uint64) {
        return purchasedAt[offerId][user];
    }

    function _getOfferStorage(uint256 offerId) internal view returns (PackedOffer storage offer) {
        offer = offers[offerId];
        if (offer.provider == address(0)) {
            revert OfferNotFound();
        }
    }

    function _nonReentrantBefore() internal {
        if (unlocked != NOT_ENTERED) {
            revert ReentrancyDetected();
        }
        unlocked = ENTERED;
    }

    function _nonReentrantAfter() internal {
        unlocked = NOT_ENTERED;
    }

    function _validateExpiry(uint64 expiresAt) internal view {
        if (expiresAt != 0 && expiresAt <= block.timestamp) {
            revert InvalidExpiry();
        }
    }

    function _validateOfferHashes(
        bytes32 ciphertextHash,
        bytes32 keyCommitment,
        bytes32 metadataHash,
        bytes32 providerUaidHash
    ) internal pure {
        if (
            ciphertextHash == bytes32(0) || keyCommitment == bytes32(0) || metadataHash == bytes32(0)
                || providerUaidHash == bytes32(0)
        ) {
            revert InvalidOfferHashes();
        }
    }

    function _toOffer(PackedOffer storage offer) internal view returns (Offer memory) {
        return Offer({
            provider: offer.provider,
            payout: offer.payout,
            paymentToken: offer.paymentToken,
            price: offer.price,
            createdAt: offer.createdAt,
            expiresAt: offer.expiresAt,
            active: offer.active,
            ciphertextHash: offer.ciphertextHash,
            keyCommitment: offer.keyCommitment,
            metadataHash: offer.metadataHash,
            providerUaidHash: offer.providerUaidHash
        });
    }
}
