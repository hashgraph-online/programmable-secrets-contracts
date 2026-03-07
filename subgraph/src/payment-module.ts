import {
  AccessGranted as AccessGrantedEvent,
  AccessReceiptUpdated as AccessReceiptUpdatedEvent,
  PolicyVaultUpdated as PolicyVaultUpdatedEvent,
} from "../generated/PaymentModule/PaymentModule";
import { AccessGrant, Receipt } from "../generated/schema";
import {
  ONE,
  eventId,
  loadOrCreateDataset,
  loadOrCreatePolicy,
  loadOrCreateProtocolConfig,
} from "./utils";

export function handleAccessGranted(event: AccessGrantedEvent): void {
  const dataset = loadOrCreateDataset(
    event.params.datasetId,
    event.block.number,
    event.block.timestamp,
    event.transaction.hash,
  );
  const policy = loadOrCreatePolicy(
    event.params.policyId,
    event.params.datasetId,
    event.block.number,
    event.block.timestamp,
    event.transaction.hash,
  );

  const grant = new AccessGrant(eventId(event.transaction.hash, event.logIndex));
  grant.policy = policy.id;
  grant.dataset = dataset.id;
  grant.receiptTokenId = event.params.receiptTokenId;
  grant.buyer = event.params.buyer;
  grant.recipient = event.params.recipient;
  grant.paymentToken = event.params.paymentToken;
  grant.price = event.params.price;
  grant.purchasedAt = event.params.purchasedAt;
  grant.ciphertextHash = event.params.ciphertextHash;
  grant.keyCommitment = event.params.keyCommitment;
  grant.transactionHash = event.transaction.hash;
  grant.blockNumber = event.block.number;
  grant.blockTimestamp = event.block.timestamp;
  grant.save();

  dataset.accessGrantCount = dataset.accessGrantCount.plus(ONE);
  dataset.updatedAt = event.block.timestamp;
  dataset.updatedBlock = event.block.number;
  dataset.updatedTxHash = event.transaction.hash;
  dataset.save();

  policy.dataset = dataset.id;
  policy.accessGrantCount = policy.accessGrantCount.plus(ONE);
  policy.updatedAt = event.block.timestamp;
  policy.updatedBlock = event.block.number;
  policy.updatedTxHash = event.transaction.hash;
  policy.save();

  const receiptId = event.params.receiptTokenId.toString();
  let receipt = Receipt.load(receiptId);
  if (receipt === null) {
    receipt = new Receipt(receiptId);
    receipt.receiptTokenId = event.params.receiptTokenId;
  }

  receipt.policy = policy.id;
  receipt.dataset = dataset.id;
  receipt.buyer = event.params.buyer;
  receipt.recipient = event.params.recipient;
  receipt.paymentToken = event.params.paymentToken;
  receipt.price = event.params.price;
  receipt.purchasedAt = event.params.purchasedAt;
  receipt.ciphertextHash = event.params.ciphertextHash;
  receipt.keyCommitment = event.params.keyCommitment;
  receipt.mintedFrom = "payment-module";
  receipt.transactionHash = event.transaction.hash;
  receipt.blockNumber = event.block.number;
  receipt.blockTimestamp = event.block.timestamp;
  receipt.save();

  const config = loadOrCreateProtocolConfig(event.block.number, event.block.timestamp);
  config.paymentModule = event.address;
  config.updatedAt = event.block.timestamp;
  config.updatedBlock = event.block.number;
  config.save();
}

export function handlePolicyVaultUpdated(event: PolicyVaultUpdatedEvent): void {
  const config = loadOrCreateProtocolConfig(event.block.number, event.block.timestamp);
  config.paymentModule = event.address;
  config.policyVault = event.params.policyVault;
  config.updatedAt = event.block.timestamp;
  config.updatedBlock = event.block.number;
  config.save();
}

export function handleAccessReceiptUpdated(event: AccessReceiptUpdatedEvent): void {
  const config = loadOrCreateProtocolConfig(event.block.number, event.block.timestamp);
  config.paymentModule = event.address;
  config.accessReceipt = event.params.accessReceipt;
  config.updatedAt = event.block.timestamp;
  config.updatedBlock = event.block.number;
  config.save();
}
