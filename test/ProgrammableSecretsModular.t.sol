// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Log} from "forge-std/Vm.sol";
import {PolicyVault} from "../src/PolicyVault.sol";
import {AccessReceipt} from "../src/AccessReceipt.sol";
import {
    AlreadyHasReceipt,
    BuyerNotAllowlisted,
    InvalidPrice,
    NotPolicyProvider,
    PolicyExpired,
    PolicyInactive,
    ReceiptNonTransferable
} from "../src/Errors.sol";
import {ProgrammableSecretsModularTestBase} from "./ProgrammableSecretsModularTestBase.sol";

contract ProgrammableSecretsModularTest is ProgrammableSecretsModularTestBase {
    bytes32 private constant POLICY_CREATED_SIG =
        keccak256("PolicyCreated(uint256,address,address,address,uint256,uint64,bool,bytes32,bytes32,bytes32,bytes32)");
    bytes32 private constant POLICY_UPDATED_SIG = keccak256("PolicyUpdated(uint256,uint256,uint64,bool,bool,bytes32)");
    bytes32 private constant ACCESS_GRANTED_SIG =
        keccak256("AccessGranted(uint256,uint256,address,address,address,uint256,uint64,bytes32,bytes32)");

    function testCreatePolicyStoresFieldsAndEmitsEvent() public {
        vm.recordLogs();
        uint256 policyId = _createPolicy(1 ether, 0, false);
        Log[] memory entries = vm.getRecordedLogs();

        PolicyVault.Policy memory policy = policyVault.getPolicy(policyId);

        assertEqAddress(policy.provider, PROVIDER);
        assertEqAddress(policy.payout, PAYOUT);
        assertEqAddress(policy.paymentToken, address(0));
        assertEqUint(uint256(policy.price), uint256(1 ether));
        assertEqUint64(policy.expiresAt, uint64(0));
        assertEqBool(policy.active, true);
        assertEqBool(policy.allowlistEnabled, false);
        assertEqBytes32(policy.ciphertextHash, CIPHERTEXT_HASH);
        assertEqBytes32(policy.keyCommitment, KEY_COMMITMENT);
        assertEqBytes32(policy.metadataHash, METADATA_HASH);
        assertEqBytes32(policy.providerUaidHash, PROVIDER_UAID_HASH);
        assertEqUint(entries.length, uint256(1));
        assertEqBytes32(entries[0].topics[0], POLICY_CREATED_SIG);
        assertEqUint(uint256(entries[0].topics[1]), policyId);
    }

    function testUpdatePolicyOnlyProvider() public {
        uint256 policyId = _createPolicy(1 ether, 0, false);

        vm.prank(BUYER);
        vm.expectRevert(NotPolicyProvider.selector);
        policyVault.updatePolicy(policyId, 2 ether, 0, true, false, bytes32(uint256(2)));
    }

    function testUpdatePolicyWritesFieldsAndEmitsEvent() public {
        uint256 policyId = _createPolicy(1 ether, 0, false);
        bytes32 updatedMetadataHash = keccak256("updated");

        vm.recordLogs();
        vm.prank(PROVIDER);
        policyVault.updatePolicy(policyId, 2 ether, 777, false, true, updatedMetadataHash);
        Log[] memory entries = vm.getRecordedLogs();

        PolicyVault.Policy memory policy = policyVault.getPolicy(policyId);

        assertEqUint(uint256(policy.price), uint256(2 ether));
        assertEqUint64(policy.expiresAt, uint64(777));
        assertEqBool(policy.active, false);
        assertEqBool(policy.allowlistEnabled, true);
        assertEqBytes32(policy.metadataHash, updatedMetadataHash);
        assertEqUint(entries.length, uint256(1));
        assertEqBytes32(entries[0].topics[0], POLICY_UPDATED_SIG);
        assertEqUint(uint256(entries[0].topics[1]), policyId);
    }

    function testPurchaseMintsReceiptAndEmitsAccessGranted() public {
        uint256 policyId = _createPolicy(1 ether, 0, false);
        uint256 payoutBalanceBefore = PAYOUT.balance;

        vm.recordLogs();
        vm.prank(BUYER);
        uint256 receiptTokenId = paymentModule.purchase{value: 1 ether}(policyId, RECIPIENT);
        Log[] memory entries = vm.getRecordedLogs();

        AccessReceipt.Receipt memory receipt = accessReceipt.getReceipt(receiptTokenId);

        assertEqUint(PAYOUT.balance, payoutBalanceBefore + uint256(1 ether));
        assertEqUint(receipt.policyId, policyId);
        assertEqAddress(receipt.buyer, BUYER);
        assertEqAddress(receipt.recipient, RECIPIENT);
        assertEqUint(entries.length, uint256(3));
        assertEqBytes32(entries[2].topics[0], ACCESS_GRANTED_SIG);
        assertEqUint(uint256(entries[2].topics[1]), policyId);
        assertEqUint(uint256(entries[2].topics[2]), receiptTokenId);
        assertEqAddress(address(uint160(uint256(entries[2].topics[3]))), BUYER);
        assertEqBool(paymentModule.hasAccess(policyId, BUYER), true);
        assertEqUint(accessReceipt.receiptOfPolicyAndBuyer(policyId, BUYER), receiptTokenId);
    }

    function testPurchaseRejectsInactivePolicy() public {
        uint256 policyId = _createPolicy(1 ether, 0, false);

        vm.prank(PROVIDER);
        policyVault.updatePolicy(policyId, 1 ether, 0, false, false, METADATA_HASH);

        vm.prank(BUYER);
        vm.expectRevert(PolicyInactive.selector);
        paymentModule.purchase{value: 1 ether}(policyId, BUYER);
    }

    function testPurchaseRejectsExpiredPolicy() public {
        uint256 policyId = _createPolicy(1 ether, uint64(block.timestamp + 1), false);

        vm.warp(block.timestamp + 2);
        vm.prank(BUYER);
        vm.expectRevert(PolicyExpired.selector);
        paymentModule.purchase{value: 1 ether}(policyId, BUYER);
    }

    function testPurchaseRequiresExactPrice() public {
        uint256 policyId = _createPolicy(1 ether, 0, false);

        vm.prank(BUYER);
        vm.expectRevert(InvalidPrice.selector);
        paymentModule.purchase{value: 2 ether}(policyId, BUYER);
    }

    function testPurchaseRequiresAllowlistWhenEnabled() public {
        uint256 policyId = _createAllowlistedPolicy(BUYER, 1 ether, 0);

        vm.prank(OTHER_BUYER);
        vm.expectRevert(BuyerNotAllowlisted.selector);
        paymentModule.purchase{value: 1 ether}(policyId, OTHER_BUYER);
    }

    function testPurchaseRejectsSecondReceiptForSameBuyer() public {
        uint256 policyId = _createPolicy(1 ether, 0, false);

        vm.prank(BUYER);
        paymentModule.purchase{value: 1 ether}(policyId, BUYER);

        vm.prank(BUYER);
        vm.expectRevert(AlreadyHasReceipt.selector);
        paymentModule.purchase{value: 1 ether}(policyId, BUYER);
    }

    function testReceiptIsNonTransferable() public {
        uint256 policyId = _createPolicy(1 ether, 0, false);

        vm.prank(BUYER);
        uint256 receiptTokenId = paymentModule.purchase{value: 1 ether}(policyId, RECIPIENT);

        vm.prank(BUYER);
        vm.expectRevert(ReceiptNonTransferable.selector);
        accessReceipt.transferFrom(BUYER, OTHER_BUYER, receiptTokenId);
    }

    function testPolicyCountTracksProxyState() public {
        assertEqUint(policyVault.policyCount(), uint256(0));

        _createPolicy(1 ether, 0, false);
        _createPolicy(2 ether, uint64(block.timestamp + 1 days), true);

        assertEqUint(policyVault.policyCount(), uint256(2));
    }
}
