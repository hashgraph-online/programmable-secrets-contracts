// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PaymentModule} from "../src/PaymentModule.sol";
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

contract ProgrammableSecretsModularSecurityTest is ProgrammableSecretsModularTestBase {
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
}
