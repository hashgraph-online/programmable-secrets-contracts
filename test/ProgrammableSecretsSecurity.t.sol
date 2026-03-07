// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProgrammableSecrets} from "../src/ProgrammableSecrets.sol";
import {InvalidExpiry, InvalidOfferHashes, PaymentFailed, OfferExpired} from "../src/Errors.sol";
import {ProgrammableSecretsTestBase} from "./ProgrammableSecretsTestBase.sol";

contract RejectingPayout {
    receive() external payable {
        revert();
    }
}

contract ReenteringPayout {
    ProgrammableSecrets private immutable TARGET;
    uint256 private reenterOfferId;
    uint256 private reenterPrice;

    bool public attempted;
    bool public succeeded;

    constructor(ProgrammableSecrets target_) {
        TARGET = target_;
    }

    function configure(uint256 offerId, uint256 price) external {
        reenterOfferId = offerId;
        reenterPrice = price;
        attempted = false;
        succeeded = false;
    }

    receive() external payable {
        if (attempted) {
            return;
        }

        attempted = true;
        (succeeded,) = address(TARGET).call{value: reenterPrice}(
            abi.encodeWithSignature("purchase(uint256,address)", reenterOfferId, address(this))
        );
    }
}

contract ProgrammableSecretsSecurityTest is ProgrammableSecretsTestBase {
    function testCreateOfferRejectsZeroCiphertextHash() public {
        vm.prank(PROVIDER);
        vm.expectRevert(InvalidOfferHashes.selector);
        programmableSecrets.createOffer(
            PROVIDER, address(0), 1 ether, 0, bytes32(0), KEY_COMMITMENT, METADATA_HASH, PROVIDER_UAID_HASH
        );
    }

    function testCreateOfferRejectsZeroKeyCommitment() public {
        vm.prank(PROVIDER);
        vm.expectRevert(InvalidOfferHashes.selector);
        programmableSecrets.createOffer(
            PROVIDER, address(0), 1 ether, 0, CIPHERTEXT_HASH, bytes32(0), METADATA_HASH, PROVIDER_UAID_HASH
        );
    }

    function testCreateOfferRejectsZeroMetadataHash() public {
        vm.prank(PROVIDER);
        vm.expectRevert(InvalidOfferHashes.selector);
        programmableSecrets.createOffer(
            PROVIDER, address(0), 1 ether, 0, CIPHERTEXT_HASH, KEY_COMMITMENT, bytes32(0), PROVIDER_UAID_HASH
        );
    }

    function testCreateOfferRejectsZeroProviderUaidHash() public {
        vm.prank(PROVIDER);
        vm.expectRevert(InvalidOfferHashes.selector);
        programmableSecrets.createOffer(
            PROVIDER, address(0), 1 ether, 0, CIPHERTEXT_HASH, KEY_COMMITMENT, METADATA_HASH, bytes32(0)
        );
    }

    function testCreateOfferRejectsImmediateExpiry() public {
        vm.prank(PROVIDER);
        vm.expectRevert(InvalidExpiry.selector);
        programmableSecrets.createOffer(
            PROVIDER,
            address(0),
            1 ether,
            uint64(block.timestamp),
            CIPHERTEXT_HASH,
            KEY_COMMITMENT,
            METADATA_HASH,
            PROVIDER_UAID_HASH
        );
    }

    function testUpdateOfferRejectsZeroMetadataHash() public {
        uint256 offerId = _createOffer(1 ether, uint64(block.timestamp + 1 days), true);

        vm.prank(PROVIDER);
        vm.expectRevert(InvalidOfferHashes.selector);
        programmableSecrets.updateOffer(offerId, 2 ether, uint64(block.timestamp + 2 days), true, bytes32(0));
    }

    function testUpdateOfferRejectsImmediateExpiry() public {
        uint256 offerId = _createOffer(1 ether, uint64(block.timestamp + 1 days), true);

        vm.prank(PROVIDER);
        vm.expectRevert(InvalidExpiry.selector);
        programmableSecrets.updateOffer(offerId, 2 ether, uint64(block.timestamp), true, METADATA_HASH);
    }

    function testPurchaseRevertsAtExactExpiryTimestamp() public {
        uint256 offerId = _createOffer(1 ether, uint64(block.timestamp + 1 days), true);

        vm.warp(block.timestamp + 1 days);
        vm.prank(BUYER);
        vm.expectRevert(OfferExpired.selector);
        programmableSecrets.purchase{value: 1 ether}(offerId, BUYER);
    }

    function testPurchaseRevertsWhenPayoutRejectsEtherAndDoesNotGrantAccess() public {
        RejectingPayout payout = new RejectingPayout();
        uint256 offerId = _createOfferForPayout(address(payout), 1 ether, 0);

        vm.prank(BUYER);
        vm.expectRevert(PaymentFailed.selector);
        programmableSecrets.purchase{value: 1 ether}(offerId, BUYER);

        assertTrue(!programmableSecrets.hasAccess(offerId, BUYER));
    }

    function testPurchaseBlocksPayoutReentrancy() public {
        ReenteringPayout payout = new ReenteringPayout(programmableSecrets);
        uint256 outerOfferId = _createOfferForPayout(address(payout), 1 ether, 0);
        uint256 reenterOfferId = _createOfferForPayout(address(payout), 1 ether, 0);

        payout.configure(reenterOfferId, 1 ether);

        vm.prank(BUYER);
        programmableSecrets.purchase{value: 1 ether}(outerOfferId, BUYER);

        assertTrue(payout.attempted());
        assertTrue(!payout.succeeded());
        assertTrue(programmableSecrets.hasAccess(outerOfferId, BUYER));
        assertTrue(!programmableSecrets.hasAccess(reenterOfferId, address(payout)));
    }
}
