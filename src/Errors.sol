// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

error InvalidPrice();
error InvalidExpiry();
error InvalidPaymentToken();
error InvalidPayoutAddress();
error InvalidPolicyType();
error InvalidIdentityRegistry();
error InvalidAgentId();
error InvalidRequiredBuyerUaid();
error PaymentFailed();
error NotPolicyProvider();
error NotDatasetProvider();
error PolicyNotFound();
error DatasetNotFound();
error PolicyInactive();
error PolicyExpired();
error InvalidPolicyHashes();
error InvalidDatasetHashes();
error InvalidModuleAddress();
error DatasetInactive();
error BuyerNotAllowlisted();
error NotPaymentModule();
error ReceiptNonTransferable();
error AlreadyHasReceipt();
error BuyerUaidRequired();
error BuyerUaidMismatch();
error BuyerDoesNotOwnRequiredAgent();
