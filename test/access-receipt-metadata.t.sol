// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AccessReceipt} from "../src/AccessReceipt.sol";

contract AccessReceiptMetadataTest is Test {
    address private constant OWNER = address(0xABCD);
    address private constant PAYMENT_MODULE = address(0x1234);
    address private constant BUYER = address(0xCAFE);
    string private constant RECEIPT_METADATA_URI = "ipfs://bafkreibw3osbcrk7w522tcjuz5a4ihffd3bfbjkwmfso5esxyfml2cfal4";

    function testMintedReceiptsShareTheConfiguredMetadataUri() public {
        AccessReceipt accessReceipt = new AccessReceipt(OWNER);

        vm.prank(OWNER);
        accessReceipt.setPaymentModule(PAYMENT_MODULE);

        vm.prank(PAYMENT_MODULE);
        uint256 firstReceiptId = accessReceipt.mintReceipt(
            BUYER,
            BUYER,
            1,
            1,
            address(0),
            1 ether,
            uint64(block.timestamp),
            keccak256("ciphertext-1"),
            keccak256("key-1")
        );
        vm.prank(PAYMENT_MODULE);
        uint256 secondReceiptId = accessReceipt.mintReceipt(
            address(0xBEEF),
            address(0xBEEF),
            2,
            2,
            address(0),
            2 ether,
            uint64(block.timestamp),
            keccak256("ciphertext-2"),
            keccak256("key-2")
        );

        assertEqBytes32(
            keccak256(bytes(accessReceipt.tokenURI(firstReceiptId))), keccak256(bytes(RECEIPT_METADATA_URI))
        );
        assertEqBytes32(
            keccak256(bytes(accessReceipt.tokenURI(secondReceiptId))), keccak256(bytes(RECEIPT_METADATA_URI))
        );
    }
}
