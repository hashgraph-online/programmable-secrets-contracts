import {
  DatasetRegistered as DatasetRegisteredEvent,
  DatasetStatusUpdated as DatasetStatusUpdatedEvent,
  PolicyCreated as PolicyCreatedEvent,
  PolicyEvaluatorFeeRecipientUpdated as PolicyEvaluatorFeeRecipientUpdatedEvent,
  PolicyEvaluatorFeeUpdated as PolicyEvaluatorFeeUpdatedEvent,
  PolicyEvaluatorRegistered as PolicyEvaluatorRegisteredEvent,
  PolicyEvaluatorStatusUpdated as PolicyEvaluatorStatusUpdatedEvent,
  PolicyUpdated as PolicyUpdatedEvent,
} from "../generated/PolicyVault/PolicyVault";
import { Evaluator, Policy as PolicyEntity } from "../generated/schema";
import {
  ONE,
  ZERO,
  loadOrCreateDataset,
  loadOrCreatePolicy,
  loadOrCreateProtocolConfig,
} from "./utils";

export function handleDatasetRegistered(event: DatasetRegisteredEvent): void {
  const dataset = loadOrCreateDataset(
    event.params.datasetId,
    event.block.number,
    event.block.timestamp,
    event.transaction.hash,
  );

  dataset.provider = event.params.provider;
  dataset.ciphertextHash = event.params.ciphertextHash;
  dataset.keyCommitment = event.params.keyCommitment;
  dataset.metadataHash = event.params.metadataHash;
  dataset.providerUaidHash = event.params.providerUaidHash;
  dataset.active = true;
  dataset.updatedAt = event.block.timestamp;
  dataset.updatedBlock = event.block.number;
  dataset.updatedTxHash = event.transaction.hash;
  dataset.save();

  const config = loadOrCreateProtocolConfig(event.block.number, event.block.timestamp);
  config.policyVault = event.address;
  config.updatedAt = event.block.timestamp;
  config.updatedBlock = event.block.number;
  config.save();
}

export function handleDatasetStatusUpdated(event: DatasetStatusUpdatedEvent): void {
  const dataset = loadOrCreateDataset(
    event.params.datasetId,
    event.block.number,
    event.block.timestamp,
    event.transaction.hash,
  );

  dataset.active = event.params.active;
  dataset.updatedAt = event.block.timestamp;
  dataset.updatedBlock = event.block.number;
  dataset.updatedTxHash = event.transaction.hash;
  dataset.save();

  const config = loadOrCreateProtocolConfig(event.block.number, event.block.timestamp);
  config.policyVault = event.address;
  config.updatedAt = event.block.timestamp;
  config.updatedBlock = event.block.number;
  config.save();
}

export function handlePolicyCreated(event: PolicyCreatedEvent): void {
  const dataset = loadOrCreateDataset(
    event.params.datasetId,
    event.block.number,
    event.block.timestamp,
    event.transaction.hash,
  );

  const policyAlreadyExists = PolicyEntity.load(event.params.policyId.toString()) !== null;
  const policy = loadOrCreatePolicy(
    event.params.policyId,
    event.params.datasetId,
    event.block.number,
    event.block.timestamp,
    event.transaction.hash,
  );

  policy.dataset = dataset.id;
  policy.provider = event.params.provider;
  policy.payout = event.params.payout;
  policy.paymentToken = event.params.paymentToken;
  policy.price = event.params.price;
  policy.receiptTransferable = event.params.receiptTransferable;
  policy.conditionsHash = event.params.conditionsHash;
  policy.conditionCount = event.params.conditionCount;
  policy.metadataHash = event.params.metadataHash;
  policy.datasetMetadataHash = event.params.datasetMetadataHash;
  policy.active = true;
  policy.updatedAt = event.block.timestamp;
  policy.updatedBlock = event.block.number;
  policy.updatedTxHash = event.transaction.hash;
  policy.save();

  if (!policyAlreadyExists) {
    dataset.policyCount = dataset.policyCount.plus(ONE);
  }

  dataset.updatedAt = event.block.timestamp;
  dataset.updatedBlock = event.block.number;
  dataset.updatedTxHash = event.transaction.hash;
  dataset.save();

  const config = loadOrCreateProtocolConfig(event.block.number, event.block.timestamp);
  config.policyVault = event.address;
  config.updatedAt = event.block.timestamp;
  config.updatedBlock = event.block.number;
  config.save();
}

export function handlePolicyUpdated(event: PolicyUpdatedEvent): void {
  const dataset = loadOrCreateDataset(
    event.params.datasetId,
    event.block.number,
    event.block.timestamp,
    event.transaction.hash,
  );
  dataset.updatedAt = event.block.timestamp;
  dataset.updatedBlock = event.block.number;
  dataset.updatedTxHash = event.transaction.hash;
  dataset.save();

  const policy = loadOrCreatePolicy(
    event.params.policyId,
    event.params.datasetId,
    event.block.number,
    event.block.timestamp,
    event.transaction.hash,
  );

  policy.dataset = dataset.id;
  policy.price = event.params.newPrice;
  policy.active = event.params.active;
  policy.metadataHash = event.params.newMetadataHash;
  policy.updatedAt = event.block.timestamp;
  policy.updatedBlock = event.block.number;
  policy.updatedTxHash = event.transaction.hash;
  policy.save();

  const config = loadOrCreateProtocolConfig(event.block.number, event.block.timestamp);
  config.policyVault = event.address;
  config.updatedAt = event.block.timestamp;
  config.updatedBlock = event.block.number;
  config.save();
}

export function handlePolicyEvaluatorRegistered(event: PolicyEvaluatorRegisteredEvent): void {
  const evaluatorId = event.params.evaluator.toHexString();
  let evaluator = Evaluator.load(evaluatorId);

  if (evaluator === null) {
    evaluator = new Evaluator(evaluatorId);
    evaluator.evaluator = event.params.evaluator;
    evaluator.feePaid = ZERO;
    evaluator.builtIn = false;
    evaluator.active = true;
    evaluator.createdAt = event.block.timestamp;
    evaluator.createdBlock = event.block.number;
    evaluator.createdTxHash = event.transaction.hash;
  }

  evaluator.registrant = event.params.registrant;
  evaluator.metadataHash = event.params.metadataHash;
  evaluator.feePaid = event.params.feePaid;
  evaluator.builtIn = event.params.builtIn;
  evaluator.active = true;
  evaluator.updatedAt = event.block.timestamp;
  evaluator.updatedBlock = event.block.number;
  evaluator.updatedTxHash = event.transaction.hash;
  evaluator.save();

  const config = loadOrCreateProtocolConfig(event.block.number, event.block.timestamp);
  config.policyVault = event.address;
  config.updatedAt = event.block.timestamp;
  config.updatedBlock = event.block.number;
  config.save();
}

export function handlePolicyEvaluatorStatusUpdated(event: PolicyEvaluatorStatusUpdatedEvent): void {
  const evaluatorId = event.params.evaluator.toHexString();
  let evaluator = Evaluator.load(evaluatorId);

  if (evaluator === null) {
    evaluator = new Evaluator(evaluatorId);
    evaluator.evaluator = event.params.evaluator;
    evaluator.feePaid = ZERO;
    evaluator.builtIn = false;
    evaluator.createdAt = event.block.timestamp;
    evaluator.createdBlock = event.block.number;
    evaluator.createdTxHash = event.transaction.hash;
  }

  evaluator.active = event.params.active;
  evaluator.updatedAt = event.block.timestamp;
  evaluator.updatedBlock = event.block.number;
  evaluator.updatedTxHash = event.transaction.hash;
  evaluator.save();

  const config = loadOrCreateProtocolConfig(event.block.number, event.block.timestamp);
  config.policyVault = event.address;
  config.updatedAt = event.block.timestamp;
  config.updatedBlock = event.block.number;
  config.save();
}

export function handlePolicyEvaluatorFeeUpdated(event: PolicyEvaluatorFeeUpdatedEvent): void {
  const config = loadOrCreateProtocolConfig(event.block.number, event.block.timestamp);
  config.policyVault = event.address;
  config.evaluatorRegistrationFee = event.params.registrationFee;
  config.updatedAt = event.block.timestamp;
  config.updatedBlock = event.block.number;
  config.save();
}

export function handlePolicyEvaluatorFeeRecipientUpdated(
  event: PolicyEvaluatorFeeRecipientUpdatedEvent,
): void {
  const config = loadOrCreateProtocolConfig(event.block.number, event.block.timestamp);
  config.policyVault = event.address;
  config.evaluatorFeeRecipient = event.params.feeRecipient;
  config.updatedAt = event.block.timestamp;
  config.updatedBlock = event.block.number;
  config.save();
}
