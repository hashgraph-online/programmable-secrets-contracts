// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {AccessReceipt} from "../src/AccessReceipt.sol";
import {PaymentModule} from "../src/PaymentModule.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {DatasetInactive, InvalidDatasetHashes, InvalidExpiry, PaymentFailed, PolicyExpired} from "../src/Errors.sol";
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
        policy = PolicyVault.Policy({
            provider: address(0xA11CE),
            payout: address(0),
            paymentToken: address(0),
            price: PRICE,
            createdAt: uint64(block.timestamp),
            expiresAt: 0,
            active: true,
            allowlistEnabled: false,
            ciphertextHash: keccak256("ciphertext"),
            keyCommitment: keccak256("content-key"),
            metadataHash: keccak256("policy-metadata"),
            providerUaidHash: keccak256("uaid"),
            datasetId: 1,
            policyType: keccak256("TIMEBOUND_V1")
        });
    }

    function isAllowlisted(uint256, address) external pure returns (bool) {
        return true;
    }

    function getDataset(uint256) external view returns (PolicyVault.Dataset memory dataset) {
        dataset = PolicyVault.Dataset({
            provider: address(0xA11CE),
            createdAt: uint64(block.timestamp),
            active: true,
            ciphertextHash: keccak256("ciphertext"),
            keyCommitment: keccak256("content-key"),
            metadataHash: keccak256("dataset-metadata"),
            providerUaidHash: keccak256("uaid")
        });
    }
}

contract ProgrammableSecretsModularSecurityTest is ProgrammableSecretsModularTestBase {
    bytes4 private constant INVALID_PAYOUT_ADDRESS_SELECTOR = bytes4(keccak256("InvalidPayoutAddress()"));

    function testCreatePolicyRejectsZeroCiphertextHash() public {
        vm.prank(PROVIDER);
        vm.expectRevert(InvalidDatasetHashes.selector);
        policyVault.registerDataset(bytes32(0), KEY_COMMITMENT, METADATA_HASH, PROVIDER_UAID_HASH);
    }

    function testCreatePolicyRejectsZeroKeyCommitment() public {
        vm.prank(PROVIDER);
        vm.expectRevert(InvalidDatasetHashes.selector);
        policyVault.registerDataset(CIPHERTEXT_HASH, bytes32(0), METADATA_HASH, PROVIDER_UAID_HASH);
    }

    function testCreatePolicyRejectsImmediateExpiry() public {
        uint256 datasetId = _registerDataset();
        address[] memory emptyAllowlist = new address[](0);
        vm.prank(PROVIDER);
        vm.expectRevert(InvalidExpiry.selector);
        policyVault.createTimeboundPolicy(
            datasetId,
            address(0),
            address(0),
            1 ether,
            uint64(block.timestamp),
            false,
            POLICY_METADATA_HASH,
            emptyAllowlist
        );
    }

    function testUpdatePolicyRejectsImmediateExpiry() public {
        uint256 policyId = _createDatasetPolicy(1 ether, uint64(block.timestamp + 1 days), false);

        vm.prank(PROVIDER);
        vm.expectRevert(InvalidExpiry.selector);
        policyVault.updatePolicy(policyId, 2 ether, uint64(block.timestamp), true, false, METADATA_HASH);
    }

    function testPurchaseRevertsAtExactExpiryTimestamp() public {
        uint256 policyId = _createDatasetPolicy(1 ether, uint64(block.timestamp + 1 days), false);

        vm.warp(block.timestamp + 1 days);
        vm.prank(BUYER);
        vm.expectRevert(PolicyExpired.selector);
        paymentModule.purchase{value: 1 ether}(policyId, BUYER);
    }

    function testPurchaseRevertsWhenPayoutRejectsEtherAndDoesNotMintReceipt() public {
        RejectingPayoutV2 payout = new RejectingPayoutV2();
        uint256 datasetId = _registerDataset();
        address[] memory emptyAllowlist = new address[](0);

        vm.prank(PROVIDER);
        uint256 policyId = policyVault.createTimeboundPolicy(
            datasetId, address(payout), address(0), 1 ether, 0, false, POLICY_METADATA_HASH, emptyAllowlist
        );

        vm.prank(BUYER);
        vm.expectRevert(PaymentFailed.selector);
        paymentModule.purchase{value: 1 ether}(policyId, BUYER);

        assertTrue(!paymentModule.hasAccess(policyId, BUYER));
    }

    function testPurchaseBlocksPayoutReentrancy() public {
        ReenteringPayoutV2 payout = new ReenteringPayoutV2(paymentModule);
        uint256 outerDatasetId = _registerDataset();
        uint256 reenterDatasetId = _registerDataset();
        address[] memory emptyAllowlist = new address[](0);

        vm.prank(PROVIDER);
        uint256 outerPolicyId = policyVault.createTimeboundPolicy(
            outerDatasetId, address(payout), address(0), 1 ether, 0, false, POLICY_METADATA_HASH, emptyAllowlist
        );
        vm.prank(PROVIDER);
        uint256 reenterPolicyId = policyVault.createTimeboundPolicy(
            reenterDatasetId, address(payout), address(0), 1 ether, 0, false, POLICY_METADATA_HASH, emptyAllowlist
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
        uint256 policyId = _createDatasetPolicy(1 ether, 0, false);
        ReceiptObserverV2 observer = new ReceiptObserverV2(accessReceipt, paymentModule);
        vm.deal(address(observer), 1 ether);

        observer.purchase(policyId, 1 ether);

        assertTrue(observer.observed());
        assertTrue(paymentModule.hasAccess(policyId, address(observer)));
    }

    function testHasAccessReturnsFalseWhenDatasetIsInactive() public {
        uint256 policyId = _createDatasetPolicy(1 ether, 0, false);
        uint256 datasetId = policyVault.getPolicy(policyId).datasetId;

        vm.prank(BUYER);
        paymentModule.purchase{value: 1 ether}(policyId, BUYER);

        vm.prank(PROVIDER);
        policyVault.setDatasetActive(datasetId, false);

        assertTrue(!paymentModule.hasAccess(policyId, BUYER));
        assertTrue(!paymentModule.hasDatasetAccess(datasetId, BUYER));
    }

    function testPurchaseRejectsInactiveDataset() public {
        uint256 policyId = _createDatasetPolicy(1 ether, 0, false);
        uint256 datasetId = policyVault.getPolicy(policyId).datasetId;

        vm.prank(PROVIDER);
        policyVault.setDatasetActive(datasetId, false);

        vm.prank(BUYER);
        vm.expectRevert(DatasetInactive.selector);
        paymentModule.purchase{value: 1 ether}(policyId, BUYER);
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
