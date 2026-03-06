// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Log} from "forge-std/Vm.sol";
import {ProgrammableSecrets} from "../src/ProgrammableSecrets.sol";
import {
    NotOfferProvider,
    OfferNotFound,
    OfferInactive,
    OfferExpired,
    AlreadyPurchased,
    InvalidPrice,
    InvalidPaymentToken
} from "../src/Errors.sol";

contract ProgrammableSecretsTest is Test {
    bytes32 private constant OFFER_CREATED_SIG =
        keccak256("OfferCreated(uint256,address,address,address,uint256,uint64,bytes32,bytes32,bytes32,bytes32)");
    bytes32 private constant OFFER_UPDATED_SIG = keccak256("OfferUpdated(uint256,uint256,uint64,bool,bytes32)");
    bytes32 private constant ACCESS_PURCHASED_SIG =
        keccak256("AccessPurchased(uint256,address,address,address,uint256,uint64,bytes32,bytes32)");

    ProgrammableSecrets private programmableSecrets;

    address private constant PROVIDER = address(0xA11CE);
    address private constant PAYOUT = address(0xBEEF);
    address private constant BUYER = address(0xCAFE);
    address private constant RECIPIENT = address(0xD00D);

    bytes32 private constant CIPHERTEXT_HASH = keccak256("ciphertext");
    bytes32 private constant KEY_COMMITMENT = keccak256("content-key");
    bytes32 private constant METADATA_HASH = keccak256("metadata");
    bytes32 private constant PROVIDER_UAID_HASH = keccak256("uaid");

    function setUp() public {
        programmableSecrets = new ProgrammableSecrets();
        vm.deal(BUYER, 100 ether);
    }

    function testCreateOfferStoresCorrectFieldsAndEmitsEvent() public {
        vm.recordLogs();
        uint256 offerId = _createOffer(1 ether, 0, true);
        Log[] memory entries = vm.getRecordedLogs();

        ProgrammableSecrets.Offer memory offer = programmableSecrets.getOffer(offerId);

        assertEqAddress(offer.provider, PROVIDER);
        assertEqAddress(offer.payout, PAYOUT);
        assertEqAddress(offer.paymentToken, address(0));
        assertEqUint(uint256(offer.price), uint256(1 ether));
        assertEqUint64(offer.expiresAt, uint64(0));
        assertEqBool(offer.active, true);
        assertEqBytes32(offer.ciphertextHash, CIPHERTEXT_HASH);
        assertEqBytes32(offer.keyCommitment, KEY_COMMITMENT);
        assertEqBytes32(offer.metadataHash, METADATA_HASH);
        assertEqBytes32(offer.providerUaidHash, PROVIDER_UAID_HASH);
        assertEqUint(entries.length, uint256(1));
        assertEqBytes32(entries[0].topics[0], OFFER_CREATED_SIG);
        assertEqUint(uint256(entries[0].topics[1]), offerId);
        assertEqAddress(address(uint160(uint256(entries[0].topics[2]))), PROVIDER);
        assertEqAddress(address(uint160(uint256(entries[0].topics[3]))), PAYOUT);

        (
            address paymentToken,
            uint256 price,
            uint64 expiresAt,
            bytes32 ciphertextHash,
            bytes32 keyCommitment,
            bytes32 metadataHash,
            bytes32 providerUaidHash
        ) = abi.decode(entries[0].data, (address, uint256, uint64, bytes32, bytes32, bytes32, bytes32));

        assertEqAddress(paymentToken, address(0));
        assertEqUint(price, uint256(1 ether));
        assertEqUint64(expiresAt, uint64(0));
        assertEqBytes32(ciphertextHash, CIPHERTEXT_HASH);
        assertEqBytes32(keyCommitment, KEY_COMMITMENT);
        assertEqBytes32(metadataHash, METADATA_HASH);
        assertEqBytes32(providerUaidHash, PROVIDER_UAID_HASH);
    }

    function testUpdateOfferOnlyProvider() public {
        uint256 offerId = _createOffer(1 ether, 0, true);

        vm.prank(BUYER);
        vm.expectRevert(NotOfferProvider.selector);
        programmableSecrets.updateOffer(offerId, 2 ether, 0, true, bytes32(uint256(2)));
    }

    function testUpdateOfferRevertsForMissingOffer() public {
        vm.prank(PROVIDER);
        vm.expectRevert(OfferNotFound.selector);
        programmableSecrets.updateOffer(1, 1 ether, 0, true, METADATA_HASH);
    }

    function testUpdateOfferWritesFieldsAndEmitsEvent() public {
        uint256 offerId = _createOffer(1 ether, 0, true);
        bytes32 updatedMetadataHash = keccak256("updated");

        vm.recordLogs();
        vm.prank(PROVIDER);
        programmableSecrets.updateOffer(offerId, 2 ether, 777, false, updatedMetadataHash);
        Log[] memory entries = vm.getRecordedLogs();

        ProgrammableSecrets.Offer memory offer = programmableSecrets.getOffer(offerId);

        assertEqUint(uint256(offer.price), uint256(2 ether));
        assertEqUint64(offer.expiresAt, uint64(777));
        assertEqBool(offer.active, false);
        assertEqBytes32(offer.metadataHash, updatedMetadataHash);
        assertEqUint(entries.length, uint256(1));
        assertEqBytes32(entries[0].topics[0], OFFER_UPDATED_SIG);
        assertEqUint(uint256(entries[0].topics[1]), offerId);

        (uint256 newPrice, uint64 newExpiresAt, bool active, bytes32 newMetadataHash) =
            abi.decode(entries[0].data, (uint256, uint64, bool, bytes32));

        assertEqUint(newPrice, uint256(2 ether));
        assertEqUint64(newExpiresAt, uint64(777));
        assertEqBool(active, false);
        assertEqBytes32(newMetadataHash, updatedMetadataHash);
    }

    function testInactiveOfferPurchaseFails() public {
        uint256 offerId = _createOffer(1 ether, 0, false);

        vm.prank(BUYER);
        vm.expectRevert(OfferInactive.selector);
        programmableSecrets.purchase{value: 1 ether}(offerId, BUYER);
    }

    function testExpiredOfferPurchaseFails() public {
        uint64 expiresAt = uint64(block.timestamp + 1);
        uint256 offerId = _createOffer(1 ether, expiresAt, true);

        vm.warp(block.timestamp + 2);
        vm.prank(BUYER);
        vm.expectRevert(OfferExpired.selector);
        programmableSecrets.purchase{value: 1 ether}(offerId, BUYER);
    }

    function testDoublePurchaseFails() public {
        uint256 offerId = _createOffer(1 ether, 0, true);

        vm.prank(BUYER);
        programmableSecrets.purchase{value: 1 ether}(offerId, BUYER);

        vm.prank(BUYER);
        vm.expectRevert(AlreadyPurchased.selector);
        programmableSecrets.purchase{value: 1 ether}(offerId, BUYER);
    }

    function testNativePaymentRequiresExactPrice() public {
        uint256 offerId = _createOffer(1 ether, 0, true);

        vm.prank(BUYER);
        vm.expectRevert(InvalidPrice.selector);
        programmableSecrets.purchase{value: 2 ether}(offerId, BUYER);
    }

    function testHasAccessAndPurchasedTimestampBeforeAndAfterPurchase() public {
        uint256 offerId = _createOffer(1 ether, 0, true);

        assertEqBool(programmableSecrets.hasAccess(offerId, BUYER), false);
        assertEqUint64(programmableSecrets.purchasedTimestamp(offerId, BUYER), uint64(0));

        vm.prank(BUYER);
        programmableSecrets.purchase{value: 1 ether}(offerId, BUYER);

        assertEqBool(programmableSecrets.hasAccess(offerId, BUYER), true);
        assertTrue(programmableSecrets.purchasedTimestamp(offerId, BUYER) > 0);
    }

    function testPurchaseRecordsTimestampPayoutAndEmitsEvent() public {
        uint256 offerId = _createOffer(1 ether, 0, true);
        uint256 payoutBalanceBefore = PAYOUT.balance;

        vm.recordLogs();
        vm.prank(BUYER);
        programmableSecrets.purchase{value: 1 ether}(offerId, RECIPIENT);
        Log[] memory entries = vm.getRecordedLogs();

        uint64 purchasedTimestampValue = programmableSecrets.purchasedTimestamp(offerId, BUYER);

        assertEqUint(PAYOUT.balance, payoutBalanceBefore + uint256(1 ether));
        assertTrue(purchasedTimestampValue > 0);
        assertEqUint(entries.length, uint256(1));
        assertEqBytes32(entries[0].topics[0], ACCESS_PURCHASED_SIG);
        assertEqUint(uint256(entries[0].topics[1]), offerId);
        assertEqAddress(address(uint160(uint256(entries[0].topics[2]))), BUYER);
        assertEqAddress(address(uint160(uint256(entries[0].topics[3]))), RECIPIENT);

        (address paymentToken, uint256 price, uint64 purchasedAtValue, bytes32 ciphertextHash, bytes32 keyCommitment) =
            abi.decode(entries[0].data, (address, uint256, uint64, bytes32, bytes32));

        assertEqAddress(paymentToken, address(0));
        assertEqUint(price, uint256(1 ether));
        assertEqUint64(purchasedAtValue, purchasedTimestampValue);
        assertEqBytes32(ciphertextHash, CIPHERTEXT_HASH);
        assertEqBytes32(keyCommitment, KEY_COMMITMENT);
    }

    function testCreateOfferRejectsNonNativePaymentToken() public {
        vm.prank(PROVIDER);
        vm.expectRevert(InvalidPaymentToken.selector);
        programmableSecrets.createOffer(
            PAYOUT, address(0x1234), 1 ether, 0, CIPHERTEXT_HASH, KEY_COMMITMENT, METADATA_HASH, PROVIDER_UAID_HASH
        );
    }

    function testFuzzCreateOfferStoresRandomPriceAndExpiry(uint96 price, uint64 expiresAt) public {
        if (price == 0) {
            return;
        }

        vm.prank(PROVIDER);
        uint256 offerId = programmableSecrets.createOffer(
            PAYOUT, address(0), price, expiresAt, CIPHERTEXT_HASH, KEY_COMMITMENT, METADATA_HASH, PROVIDER_UAID_HASH
        );

        ProgrammableSecrets.Offer memory offer = programmableSecrets.getOffer(offerId);
        assertEqUint(uint256(offer.price), uint256(price));
        assertEqUint64(offer.expiresAt, expiresAt);
    }

    function testFuzzPurchaseIsRecordedExactlyOnce(uint96 price) public {
        if (price == 0) {
            return;
        }

        vm.deal(BUYER, uint256(price) * 2);
        uint256 offerId = _createOffer(price, 0, true);

        vm.prank(BUYER);
        programmableSecrets.purchase{value: price}(offerId, BUYER);

        assertTrue(programmableSecrets.hasAccess(offerId, BUYER));
        assertTrue(programmableSecrets.purchasedTimestamp(offerId, BUYER) > 0);

        vm.prank(BUYER);
        vm.expectRevert(AlreadyPurchased.selector);
        programmableSecrets.purchase{value: price}(offerId, BUYER);
    }

    function _createOffer(uint96 price, uint64 expiresAt, bool active) private returns (uint256 offerId) {
        vm.prank(PROVIDER);
        offerId = programmableSecrets.createOffer(
            PAYOUT, address(0), price, expiresAt, CIPHERTEXT_HASH, KEY_COMMITMENT, METADATA_HASH, PROVIDER_UAID_HASH
        );

        if (!active) {
            vm.prank(PROVIDER);
            programmableSecrets.updateOffer(offerId, price, expiresAt, false, METADATA_HASH);
        }
    }
}
