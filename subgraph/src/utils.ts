import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import { Dataset, Policy, ProtocolConfig } from "../generated/schema";

const PROTOCOL_CONFIG_ID = "protocol";

export const ZERO = BigInt.fromI32(0);
export const ONE = BigInt.fromI32(1);

export function eventId(txHash: Bytes, logIndex: BigInt): string {
  return txHash.toHexString().concat("-").concat(logIndex.toString());
}

export function loadOrCreateProtocolConfig(
  blockNumber: BigInt,
  blockTimestamp: BigInt,
): ProtocolConfig {
  const existing = ProtocolConfig.load(PROTOCOL_CONFIG_ID);
  if (existing !== null) {
    return existing;
  }

  const created = new ProtocolConfig(PROTOCOL_CONFIG_ID);
  created.evaluatorRegistrationFee = ZERO;
  created.updatedBlock = blockNumber;
  created.updatedAt = blockTimestamp;
  return created;
}

export function loadOrCreateDataset(
  datasetId: BigInt,
  blockNumber: BigInt,
  blockTimestamp: BigInt,
  txHash: Bytes,
): Dataset {
  const id = datasetId.toString();
  const existing = Dataset.load(id);
  if (existing !== null) {
    return existing;
  }

  const created = new Dataset(id);
  created.datasetId = datasetId;
  created.active = false;
  created.policyCount = ZERO;
  created.accessGrantCount = ZERO;
  created.createdAt = blockTimestamp;
  created.createdBlock = blockNumber;
  created.createdTxHash = txHash;
  created.updatedAt = blockTimestamp;
  created.updatedBlock = blockNumber;
  created.updatedTxHash = txHash;
  return created;
}

export function loadOrCreatePolicy(
  policyId: BigInt,
  datasetId: BigInt,
  blockNumber: BigInt,
  blockTimestamp: BigInt,
  txHash: Bytes,
): Policy {
  const id = policyId.toString();
  const existing = Policy.load(id);
  if (existing !== null) {
    return existing;
  }

  const created = new Policy(id);
  created.policyId = policyId;
  created.dataset = datasetId.toString();
  created.price = ZERO;
  created.conditionCount = ZERO;
  created.active = false;
  created.accessGrantCount = ZERO;
  created.createdAt = blockTimestamp;
  created.createdBlock = blockNumber;
  created.createdTxHash = txHash;
  created.updatedAt = blockTimestamp;
  created.updatedBlock = blockNumber;
  created.updatedTxHash = txHash;
  return created;
}
