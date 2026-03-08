import {
  PaymentModuleUpdated as PaymentModuleUpdatedEvent,
  ReceiptMinted as ReceiptMintedEvent,
  Transfer as TransferEvent,
} from "../generated/AccessReceipt/AccessReceipt";
import { Receipt } from "../generated/schema";
import {
  loadOrCreateDataset,
  loadOrCreatePolicy,
  loadOrCreateProtocolConfig,
} from "./utils";

export function handleReceiptMinted(event: ReceiptMintedEvent): void {
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

  const receiptId = event.params.receiptTokenId.toString();
  let receipt = Receipt.load(receiptId);
  if (receipt === null) {
    receipt = new Receipt(receiptId);
    receipt.receiptTokenId = event.params.receiptTokenId;
  }

  receipt.policy = policy.id;
  receipt.dataset = dataset.id;
  receipt.buyer = event.params.buyer;
  receipt.holder = event.params.buyer;
  receipt.recipient = event.params.recipient;
  receipt.receiptTransferable = event.params.receiptTransferable;
  receipt.paymentToken = event.params.paymentToken;
  receipt.price = event.params.price;
  receipt.purchasedAt = event.params.purchasedAt;
  receipt.ciphertextHash = event.params.ciphertextHash;
  receipt.keyCommitment = event.params.keyCommitment;
  receipt.mintedFrom = "access-receipt";
  receipt.transactionHash = event.transaction.hash;
  receipt.blockNumber = event.block.number;
  receipt.blockTimestamp = event.block.timestamp;
  receipt.save();

  dataset.updatedAt = event.block.timestamp;
  dataset.updatedBlock = event.block.number;
  dataset.updatedTxHash = event.transaction.hash;
  dataset.save();

  policy.dataset = dataset.id;
  policy.updatedAt = event.block.timestamp;
  policy.updatedBlock = event.block.number;
  policy.updatedTxHash = event.transaction.hash;
  policy.save();

  const config = loadOrCreateProtocolConfig(event.block.number, event.block.timestamp);
  config.accessReceipt = event.address;
  config.updatedAt = event.block.timestamp;
  config.updatedBlock = event.block.number;
  config.save();
}

export function handlePaymentModuleUpdated(event: PaymentModuleUpdatedEvent): void {
  const config = loadOrCreateProtocolConfig(event.block.number, event.block.timestamp);
  config.accessReceipt = event.address;
  config.paymentModule = event.params.paymentModule;
  config.updatedAt = event.block.timestamp;
  config.updatedBlock = event.block.number;
  config.save();
}

export function handleTransfer(event: TransferEvent): void {
  const receipt = Receipt.load(event.params.tokenId.toString());
  if (receipt === null) {
    return;
  }

  if (event.params.to.notEqual(event.params.from)) {
    receipt.holder = event.params.to;
    receipt.transactionHash = event.transaction.hash;
    receipt.blockNumber = event.block.number;
    receipt.blockTimestamp = event.block.timestamp;
    receipt.save();
  }
}
