import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  encodeAbiParameters,
  getAddress,
  hexToBytes,
  keccak256,
  parseAbiParameters,
  toBytes,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { normalizePrivateKey } from './env.mjs';
import { CliError } from './errors.mjs';
import { buildHashFromText, normalizeHash, parseBigIntValue, parseUintValue } from './options.mjs';

const THRESHOLD_COMMITTEE_CONFIG_PARAMETERS =
  parseAbiParameters('bytes32 policyContextHash,uint64 maxDeadline,uint8 threshold,address[] committee');
const THRESHOLD_COMMITTEE_RUNTIME_PARAMETERS = parseAbiParameters('uint64 deadline,bytes[] signatures');
const THRESHOLD_COMMITTEE_MESSAGE_PARAMETERS = parseAbiParameters(
  'bytes32 typehash,address evaluator,address policyVault,uint256 chainId,uint256 policyId,address buyer,address recipient,bytes32 policyContextHash,uint64 deadline',
);

export const THRESHOLD_COMMITTEE_ATTESTATION_TYPEHASH = keccak256(
  toBytes(
    'ThresholdCommitteeAttestation(address evaluator,address policyVault,uint256 chainId,uint256 policyId,address buyer,address recipient,bytes32 policyContextHash,uint64 deadline)',
  ),
);

function sortAddresses(addresses) {
  return [...addresses]
    .map((address) => getAddress(address))
    .sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
}

function assertUniqueAddresses(addresses) {
  for (let index = 1; index < addresses.length; index += 1) {
    if (addresses[index - 1].toLowerCase() === addresses[index].toLowerCase()) {
      throw new CliError(
        'DUPLICATE_COMMITTEE_MEMBER',
        `Duplicate committee signer detected: ${addresses[index]}.`,
        'Provide each committee address only once.',
      );
    }
  }
}

function parseCommitteeAddresses(value) {
  const addresses = `${value ?? ''}`
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (addresses.length === 0) {
    throw new CliError(
      'MISSING_COMMITTEE',
      'Threshold committee policies require at least one committee address.',
      'Pass --committee 0xSigner1,0xSigner2,...',
    );
  }
  const normalized = sortAddresses(addresses);
  assertUniqueAddresses(normalized);
  return normalized;
}

function parsePrivateKeyList(rawKeys) {
  const normalized = rawKeys
    .map((entry) => `${entry ?? ''}`.trim())
    .filter(Boolean)
    .map((entry, index) => normalizePrivateKey(entry, `committee private key ${index + 1}`));
  if (normalized.length === 0) {
    throw new CliError(
      'MISSING_COMMITTEE_KEYS',
      'Threshold committee runtime generation requires at least one committee private key.',
      'Pass --committee-private-keys 0xabc...,0xdef... or --committee-private-keys-file signers.json.',
    );
  }
  return normalized;
}

function readPrivateKeyFile(inputPath) {
  let payload;
  try {
    payload = JSON.parse(readFileSync(resolve(inputPath), 'utf8'));
  } catch (error) {
    throw new CliError(
      'PRIVATE_KEY_FILE_READ_FAILED',
      `Unable to read committee private keys from ${inputPath}.`,
      'Provide a JSON array of hex private keys or an object with a privateKeys array.',
      error instanceof Error ? error.message : `${error}`,
    );
  }

  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.privateKeys)) {
    return payload.privateKeys;
  }

  throw new CliError(
    'INVALID_PRIVATE_KEY_FILE',
    `Unsupported committee private key file format in ${inputPath}.`,
    'Expected ["0x..."] or { "privateKeys": ["0x..."] }.',
  );
}

export function resolvePolicyContextHash({ hash, text }) {
  if (hash) {
    return normalizeHash(hash, 'policy-context-hash');
  }
  if (text) {
    return buildHashFromText(text);
  }
  throw new CliError(
    'MISSING_POLICY_CONTEXT',
    'Threshold committee attestations require a policy context hash.',
    'Pass --policy-context-hash 0x... or --policy-context-text "committee-release-v1".',
  );
}

export function buildThresholdCommitteeConfig({
  committee,
  maxDeadlineUnix,
  policyContextHash,
  threshold,
}) {
  const normalizedCommittee = parseCommitteeAddresses(committee);
  const thresholdValue = parseUintValue(`${threshold}`, 'threshold');
  if (thresholdValue <= 0 || thresholdValue > normalizedCommittee.length) {
    throw new CliError(
      'INVALID_THRESHOLD',
      `Invalid threshold ${thresholdValue} for committee size ${normalizedCommittee.length}.`,
      'Choose a threshold between 1 and the committee signer count.',
    );
  }
  const maxDeadline = parseBigIntValue(`${maxDeadlineUnix}`, 'max-deadline-unix');
  if (maxDeadline <= 0n) {
    throw new CliError(
      'INVALID_MAX_DEADLINE',
      `Invalid max-deadline-unix "${maxDeadlineUnix}".`,
      'Provide a unix timestamp greater than 0.',
    );
  }

  return {
    committee: normalizedCommittee,
    configData: encodeAbiParameters(THRESHOLD_COMMITTEE_CONFIG_PARAMETERS, [
      policyContextHash,
      maxDeadline,
      thresholdValue,
      normalizedCommittee,
    ]),
    maxDeadline,
    policyContextHash,
    threshold: thresholdValue,
  };
}

export function buildThresholdCommitteeMessageHash({
  buyer,
  chainId,
  deadline,
  evaluator,
  policyContextHash,
  policyId,
  policyVault,
  recipient,
}) {
  return keccak256(
    encodeAbiParameters(THRESHOLD_COMMITTEE_MESSAGE_PARAMETERS, [
      THRESHOLD_COMMITTEE_ATTESTATION_TYPEHASH,
      getAddress(evaluator),
      getAddress(policyVault),
      parseBigIntValue(`${chainId}`, 'chain id'),
      parseBigIntValue(`${policyId}`, 'policy id'),
      getAddress(buyer),
      getAddress(recipient),
      policyContextHash,
      parseBigIntValue(`${deadline}`, 'deadline'),
    ]),
  );
}

export function buildEthPersonalMessageHash(messageHash) {
  const prefix = Buffer.from('\u0019Ethereum Signed Message:\n32', 'utf8');
  const body = Buffer.from(messageHash.slice(2), 'hex');
  return keccak256(`0x${Buffer.concat([prefix, body]).toString('hex')}`);
}

export function buildThresholdCommitteeRuntimeData({ deadline, signatures }) {
  return encodeAbiParameters(THRESHOLD_COMMITTEE_RUNTIME_PARAMETERS, [
    parseBigIntValue(`${deadline}`, 'deadline'),
    signatures,
  ]);
}

export function buildThresholdCommitteeRuntimeInputs({ conditionCount, conditionIndex, runtimeData }) {
  const totalConditions = parseUintValue(`${conditionCount}`, 'condition-count');
  const targetIndex = parseUintValue(`${conditionIndex}`, 'condition-index');
  if (totalConditions === 0) {
    throw new CliError(
      'INVALID_CONDITION_COUNT',
      'condition-count must be at least 1.',
      'Pass --condition-count 1 or let the CLI infer the policy condition layout from --policy-id.',
    );
  }
  if (targetIndex >= totalConditions) {
    throw new CliError(
      'INVALID_CONDITION_INDEX',
      `condition-index ${targetIndex} is outside condition-count ${totalConditions}.`,
      'Use a zero-based condition index that is smaller than the condition count.',
    );
  }

  const runtimeInputs = Array.from({ length: totalConditions }, () => '0x');
  runtimeInputs[targetIndex] = runtimeData;
  return runtimeInputs;
}

export function resolveCommitteePrivateKeys({ inputFile, inlineKeys }) {
  const rawValues = inputFile ? readPrivateKeyFile(inputFile) : `${inlineKeys ?? ''}`.split(',');
  return parsePrivateKeyList(rawValues);
}

export async function buildThresholdCommitteeRuntime({
  buyer,
  chainId,
  conditionCount = null,
  conditionIndex = null,
  committeePrivateKeys,
  deadline,
  evaluator,
  policyContextHash,
  policyId,
  policyVault,
  recipient,
}) {
  const normalizedBuyer = getAddress(buyer);
  const normalizedRecipient = getAddress(recipient || buyer);
  const normalizedEvaluator = getAddress(evaluator);
  const normalizedPolicyVault = getAddress(policyVault);
  const normalizedDeadline = parseBigIntValue(`${deadline}`, 'deadline');
  const messageHash = buildThresholdCommitteeMessageHash({
    buyer: normalizedBuyer,
    chainId,
    deadline: normalizedDeadline,
    evaluator: normalizedEvaluator,
    policyContextHash,
    policyId,
    policyVault: normalizedPolicyVault,
    recipient: normalizedRecipient,
  });
  const ethSignedMessageHash = buildEthPersonalMessageHash(messageHash);
  const signers = resolveCommitteePrivateKeys({
    inlineKeys: committeePrivateKeys,
    inputFile: null,
  })
    .map((privateKey) => privateKeyToAccount(privateKey))
    .sort((left, right) => left.address.toLowerCase().localeCompare(right.address.toLowerCase()));

  const signatures = [];
  for (const signer of signers) {
    signatures.push(
      await signer.signMessage({
        message: { raw: hexToBytes(messageHash) },
      }),
    );
  }

  const runtimeData = buildThresholdCommitteeRuntimeData({
    deadline: normalizedDeadline,
    signatures,
  });

  return {
    buyer: normalizedBuyer,
    chainId: parseBigIntValue(`${chainId}`, 'chain id'),
    conditionCount: conditionCount === null ? null : parseUintValue(`${conditionCount}`, 'condition-count'),
    conditionIndex: conditionIndex === null ? null : parseUintValue(`${conditionIndex}`, 'condition-index'),
    deadline: normalizedDeadline,
    ethSignedMessageHash,
    evaluator: normalizedEvaluator,
    messageHash,
    policyContextHash,
    policyId: parseBigIntValue(`${policyId}`, 'policy id'),
    policyVault: normalizedPolicyVault,
    recipient: normalizedRecipient,
    runtimeData,
    runtimeInputs:
      conditionCount === null || conditionIndex === null
        ? null
        : buildThresholdCommitteeRuntimeInputs({
            conditionCount,
            conditionIndex,
            runtimeData,
          }),
    signatures,
    signers: signers.map((signer) => signer.address),
  };
}
