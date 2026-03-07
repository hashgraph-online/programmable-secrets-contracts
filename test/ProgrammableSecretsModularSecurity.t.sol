// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {AccessReceipt} from "../src/AccessReceipt.sol";
import {PaymentModule} from "../src/PaymentModule.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {InvalidExpiry, InvalidPolicyHashes, PaymentFailed, PolicyExpired} from "../src/Errors.sol";
import {ProgrammableSecretsModularTestBase} from "./ProgrammableSecretsModularTestBase.sol";

contract RejectingPayoutV2 {
    receive() external payable {
        revert();
    }
}

contract ReenteringPayoutV2 {
    PaymentModule private immutable TARGET;
    uint256 private reenterPolicyId;
    uint256 private reenterPrice;

    bool public attempted;
    bool public succeeded;

    constructor(PaymentModule target_) {
        TARGET = target_;
    }

    function configure(uint256 policyId, uint256 price) external {
        reenterPolicyId = policyId;
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
            abi.encodeWithSignature("purchase(uint256,address)", reenterPolicyId, address(this))
        );
    }
}

contract ReceiptObserverV2 is IERC721Receiver {
    AccessReceipt private immutable RECEIPT;
    PaymentModule private immutable PAYMENT_MODULE;

    bool public observed;

    constructor(AccessReceipt receipt_, PaymentModule paymentModule_) {
        RECEIPT = receipt_;
        PAYMENT_MODULE = paymentModule_;
    }

    function purchase(uint256 policyId, uint256 price) external {
        PAYMENT_MODULE.purchase{value: price}(policyId, address(this));
    }

    function onERC721Received(address, address, uint256 tokenId, bytes calldata) external returns (bytes4) {
        uint256 policyId = RECEIPT.getReceipt(tokenId).policyId;
        uint256 observedReceiptId = RECEIPT.receiptOfPolicyAndBuyer(policyId, address(this));

        require(policyId != 0, "receipt not stored");
        require(observedReceiptId == tokenId, "receipt lookup missing");

        observed = true;
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract ZeroPayoutPolicyVaultV2 {
    uint96 private immutable PRICE;

    constructor(uint96 price_) {
        PRICE = price_;
    }

    function getPolicy(uint256) external view returns (PolicyVault.Policy memory policy) {
        policy.provider = address(0xA11CE);
        policy.payout = address(0);
        policy.paymentToken = address(0);
        policy.price = PRICE;
        policy.createdAt = uint64(block.timestamp);
        policy.active = true;
        policy.allowlistEnabled = false;
        policy.ciphertextHash = keccak256("ciphertext");
        policy.keyCommitment = keccak256("content-key");
        policy.metadataHash = keccak256("metadata");
        policy.providerUaidHash = keccak256("uaid");
    }

    function isAllowlisted(uint256, address) external pure returns (bool) {
        return true;
    }
}

contract ProgrammableSecretsModularSecurityTest is ProgrammableSecretsModularTestBase {
    bytes4 private constant INVALID_PAYOUT_ADDRESS_SELECTOR = bytes4(keccak256("InvalidPayoutAddress()"));

    function testCreatePolicyRejectsZeroCiphertextHash() public {
        address[] memory emptyAllowlist = new address[](0);
        vm.prank(PROVIDER);
        vm.expectRevert(InvalidPolicyHashes.selector);
        policyVault.createPolicy(
            PROVIDER,
            address(0),
            1 ether,
            0,
            false,
            bytes32(0),
            KEY_COMMITMENT,
            METADATA_HASH,
            PROVIDER_UAID_HASH,
            emptyAllowlist
        );
    }

    function testCreatePolicyRejectsZeroKeyCommitment() public {
        address[] memory emptyAllowlist = new address[](0);
        vm.prank(PROVIDER);
        vm.expectRevert(InvalidPolicyHashes.selector);
        policyVault.createPolicy(
            PROVIDER,
            address(0),
            1 ether,
            0,
            false,
            CIPHERTEXT_HASH,
            bytes32(0),
            METADATA_HASH,
            PROVIDER_UAID_HASH,
            emptyAllowlist
        );
    }

    function testCreatePolicyRejectsImmediateExpiry() public {
        address[] memory emptyAllowlist = new address[](0);
        vm.prank(PROVIDER);
        vm.expectRevert(InvalidExpiry.selector);
        policyVault.createPolicy(
            PROVIDER,
            address(0),
            1 ether,
            uint64(block.timestamp),
            false,
            CIPHERTEXT_HASH,
            KEY_COMMITMENT,
            METADATA_HASH,
            PROVIDER_UAID_HASH,
            emptyAllowlist
        );
    }

    function testUpdatePolicyRejectsImmediateExpiry() public {
        uint256 policyId = _createPolicy(1 ether, uint64(block.timestamp + 1 days), false);

        vm.prank(PROVIDER);
        vm.expectRevert(InvalidExpiry.selector);
        policyVault.updatePolicy(policyId, 2 ether, uint64(block.timestamp), true, false, METADATA_HASH);
    }

    function testPurchaseRevertsAtExactExpiryTimestamp() public {
        uint256 policyId = _createPolicy(1 ether, uint64(block.timestamp + 1 days), false);

        vm.warp(block.timestamp + 1 days);
        vm.prank(BUYER);
        vm.expectRevert(PolicyExpired.selector);
        paymentModule.purchase{value: 1 ether}(policyId, BUYER);
    }

    function testPurchaseRevertsWhenPayoutRejectsEtherAndDoesNotMintReceipt() public {
        RejectingPayoutV2 payout = new RejectingPayoutV2();
        address[] memory emptyAllowlist = new address[](0);

        vm.prank(PROVIDER);
        uint256 policyId = policyVault.createPolicy(
            address(payout),
            address(0),
            1 ether,
            0,
            false,
            CIPHERTEXT_HASH,
            KEY_COMMITMENT,
            METADATA_HASH,
            PROVIDER_UAID_HASH,
            emptyAllowlist
        );

        vm.prank(BUYER);
        vm.expectRevert(PaymentFailed.selector);
        paymentModule.purchase{value: 1 ether}(policyId, BUYER);

        assertTrue(!paymentModule.hasAccess(policyId, BUYER));
    }

    function testPurchaseBlocksPayoutReentrancy() public {
        ReenteringPayoutV2 payout = new ReenteringPayoutV2(paymentModule);
        address[] memory emptyAllowlist = new address[](0);

        vm.prank(PROVIDER);
        uint256 outerPolicyId = policyVault.createPolicy(
            address(payout),
            address(0),
            1 ether,
            0,
            false,
            CIPHERTEXT_HASH,
            KEY_COMMITMENT,
            METADATA_HASH,
            PROVIDER_UAID_HASH,
            emptyAllowlist
        );
        vm.prank(PROVIDER);
        uint256 reenterPolicyId = policyVault.createPolicy(
            address(payout),
            address(0),
            1 ether,
            0,
            false,
            CIPHERTEXT_HASH,
            KEY_COMMITMENT,
            METADATA_HASH,
            PROVIDER_UAID_HASH,
            emptyAllowlist
        );

        payout.configure(reenterPolicyId, 1 ether);

        vm.prank(BUYER);
        paymentModule.purchase{value: 1 ether}(outerPolicyId, BUYER);

        assertTrue(payout.attempted());
        assertTrue(!payout.succeeded());
        assertTrue(paymentModule.hasAccess(outerPolicyId, BUYER));
        assertTrue(!paymentModule.hasAccess(reenterPolicyId, address(payout)));
    }

    function testPurchaseStoresReceiptStateBeforeReceiverCallback() public {
        uint256 policyId = _createPolicy(1 ether, 0, false);
        ReceiptObserverV2 observer = new ReceiptObserverV2(accessReceipt, paymentModule);
        vm.deal(address(observer), 1 ether);

        observer.purchase(policyId, 1 ether);

        assertTrue(observer.observed());
        assertTrue(paymentModule.hasAccess(policyId, address(observer)));
    }

    function testPurchaseRejectsZeroPayoutAddress() public {
        ZeroPayoutPolicyVaultV2 zeroPayoutVault = new ZeroPayoutPolicyVaultV2(1 ether);

        vm.prank(UPGRADE_OWNER);
        paymentModule.setPolicyVault(address(zeroPayoutVault));

        vm.prank(BUYER);
        vm.expectRevert(INVALID_PAYOUT_ADDRESS_SELECTOR);
        paymentModule.purchase{value: 1 ether}(1, BUYER);
    }
}
