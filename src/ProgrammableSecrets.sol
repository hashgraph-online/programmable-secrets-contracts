// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
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
    PaymentFailed
} from "./Errors.sol";

contract ProgrammableSecrets is
    Initializable,
    Ownable2StepUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuard,
    ProgrammableSecretsEvents
{
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

    /// @custom:storage-location erc7201:hashgraphonline.storage.ProgrammableSecrets
    struct ProgrammableSecretsStorage {
        uint256 offerCounter;
        mapping(uint256 => PackedOffer) offers;
        mapping(uint256 => mapping(address => uint64)) purchaseTimestamps;
    }

    bytes32 private constant PROGRAMMABLE_SECRETS_STORAGE_LOCATION =
        0x813404bd5df493b2ad6149ba36536a19b27204935defea8660ff53704fb84c00;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the proxy with the upgrade owner.
    function initialize(address initialOwner) external initializer {
        __Ownable_init(initialOwner);
        __Ownable2Step_init();
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
        ProgrammableSecretsStorage storage $ = _getProgrammableSecretsStorage();

        if (paymentToken != address(0)) {
            revert InvalidPaymentToken();
        }
        if (price == 0) {
            revert InvalidPrice();
        }
        _validateExpiry(expiresAt);
        _validateOfferHashes(ciphertextHash, keyCommitment, metadataHash, providerUaidHash);

        offerId = ++$.offerCounter;

        address normalizedPayout = payout == address(0) ? msg.sender : payout;
        uint64 createdAt = uint64(block.timestamp);

        $.offers[offerId] = PackedOffer({
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
        if (purchasedAt(offerId, msg.sender) != 0) {
            revert AlreadyPurchased();
        }
        uint96 price = offer.price;
        if (msg.value != price) {
            revert InvalidPrice();
        }

        uint64 purchasedTimestampValue = uint64(block.timestamp);
        _getProgrammableSecretsStorage().purchaseTimestamps[offerId][msg.sender] = purchasedTimestampValue;

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
        return purchasedAt(offerId, user) != 0;
    }

    /// @notice Returns the total number of offers created through the proxy.
    function offerCount() public view returns (uint256) {
        return _getProgrammableSecretsStorage().offerCounter;
    }

    /// @notice Returns the purchase timestamp for a buyer or zero when access has not been purchased.
    function purchasedTimestamp(uint256 offerId, address user) external view returns (uint64) {
        return purchasedAt(offerId, user);
    }

    /// @notice Returns the raw nested purchase timestamp mapping entry.
    function purchasedAt(uint256 offerId, address buyer) public view returns (uint64) {
        return _getProgrammableSecretsStorage().purchaseTimestamps[offerId][buyer];
    }

    function _authorizeUpgrade(address newImplementation) internal view override onlyOwner {
        newImplementation;
    }

    function _getOfferStorage(uint256 offerId) internal view returns (PackedOffer storage offer) {
        offer = _getProgrammableSecretsStorage().offers[offerId];
        if (offer.provider == address(0)) {
            revert OfferNotFound();
        }
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

    function _getProgrammableSecretsStorage() private pure returns (ProgrammableSecretsStorage storage $) {
        assembly {
            $.slot := PROGRAMMABLE_SECRETS_STORAGE_LOCATION
        }
    }
}
