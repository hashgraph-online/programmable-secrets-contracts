import { getAddress } from 'viem';
import { POLICY_VAULT_ABI, THRESHOLD_COMMITTEE_CONDITION_ABI } from '../constants.mjs';
import { CliError } from '../errors.mjs';
import { CLI_RUNTIME } from '../runtime.mjs';
import { emitResult, printField, printHeading, printSuccess, serializeJson } from '../output.mjs';
import {
  parseBigIntValue,
  parseUintValue,
  readOption,
  requireOption,
  resolveOutputPath,
} from '../options.mjs';
import {
  buildPolicyVaultAddress,
  getNetworkIdFromOptions,
  getPublicClient,
  getSelectedChain,
  maybeWriteJsonFile,
  readJsonFile,
  readPolicyConditions,
} from '../index-support.mjs';
import {
  buildThresholdCommitteeConfig,
  buildThresholdCommitteeRuntime,
  resolveCommitteePrivateKeys,
  resolvePolicyContextHash,
} from '../threshold-committee.mjs';

function resolveUnixDeadline(options, unixOptionName, durationOptionName, description) {
  const explicitUnix = readOption(options, [unixOptionName], null);
  if (explicitUnix !== null) {
    const deadline = parseBigIntValue(`${explicitUnix}`, description);
    if (deadline <= 0n) {
      throw new CliError(
        'INVALID_DEADLINE',
        `Invalid ${description}: "${explicitUnix}".`,
        `Provide --${unixOptionName} as a unix timestamp greater than 0.`,
      );
    }
    return deadline;
  }
  const durationMinutes = readOption(options, [durationOptionName], null);
  if (durationMinutes !== null) {
    const minutes = parseUintValue(durationMinutes, durationOptionName);
    if (minutes === 0) {
      throw new CliError(
        'INVALID_DEADLINE_DURATION',
        `${durationOptionName} must be greater than 0.`,
        `Provide --${durationOptionName} 15 or pass --${unixOptionName}.`,
      );
    }
    return BigInt(Math.floor(Date.now() / 1000) + minutes * 60);
  }
  throw new CliError(
    'MISSING_DEADLINE',
    `Missing ${description}.`,
    `Provide --${unixOptionName} <unix> or --${durationOptionName} <minutes>.`,
  );
}

function buildThresholdConfigPayload(options) {
  const policyContextHash = resolvePolicyContextHash({
    hash: readOption(options, ['policy-context-hash'], null),
    text: readOption(options, ['policy-context-text'], null),
  });
  const committee = requireOption(options, ['committee'], 'committee signer address list');
  const threshold = requireOption(options, ['threshold'], 'threshold');
  const maxDeadlineUnix = resolveUnixDeadline(
    options,
    'max-deadline-unix',
    'max-duration-minutes',
    'max-deadline-unix',
  );

  return buildThresholdCommitteeConfig({
    committee,
    maxDeadlineUnix,
    policyContextHash,
    threshold,
  });
}

function resolveHexPayload({ options, directOption, fileOption, fieldName, description }) {
  const directValue = readOption(options, [directOption], null);
  if (directValue !== null) {
    return `${directValue}`.trim();
  }
  const filePath = readOption(options, [fileOption], null);
  if (filePath === null) {
    return null;
  }
  const payload = readJsonFile(filePath, description);
  const resolvedValue = payload?.[fieldName];
  if (typeof resolvedValue === 'string' && resolvedValue.trim().length > 0) {
    return resolvedValue.trim();
  }
  throw new CliError(
    'INVALID_THRESHOLD_PAYLOAD',
    `Unable to resolve ${fieldName} from ${filePath}.`,
    `Expected ${filePath} to contain a JSON object with a ${fieldName} field.`,
  );
}

async function resolveRuntimePlacement({ evaluator, networkId, policyId, publicClient, options }) {
  const conditionCount = readOption(options, ['condition-count'], null);
  const conditionIndex = readOption(options, ['condition-index'], null);
  if (conditionCount !== null && conditionIndex !== null) {
    return {
      conditionCount: parseUintValue(conditionCount, 'condition-count'),
      conditionIndex: parseUintValue(conditionIndex, 'condition-index'),
      source: 'explicit',
    };
  }

  const conditions = await readPolicyConditions({ networkId, policyId, publicClient });
  const normalizedEvaluator = getAddress(evaluator).toLowerCase();
  const matches = conditions.filter(
    (condition) => getAddress(condition.evaluator).toLowerCase() === normalizedEvaluator,
  );
  if (matches.length === 0) {
    throw new CliError(
      'EVALUATOR_NOT_FOUND_ON_POLICY',
      `Policy ${policyId} does not include evaluator ${evaluator}.`,
      'Pass --condition-count and --condition-index if you need to build runtime inputs for an offchain policy draft.',
    );
  }
  if (matches.length > 1) {
    throw new CliError(
      'AMBIGUOUS_EVALUATOR_CONDITION',
      `Policy ${policyId} contains evaluator ${evaluator} more than once.`,
      'Pass --condition-count and --condition-index explicitly.',
    );
  }
  return {
    conditionCount: conditions.length,
    conditionIndex: Number(matches[0].index),
    source: 'policy-read',
  };
}

async function buildThresholdRuntimePayload(options) {
  const policyId = parseBigIntValue(requireOption(options, ['policy-id'], 'policy id'), 'policy-id');
  const buyer = getAddress(requireOption(options, ['buyer'], 'buyer address'));
  const evaluator = getAddress(requireOption(options, ['evaluator'], 'evaluator address'));
  const policyContextHash = resolvePolicyContextHash({
    hash: readOption(options, ['policy-context-hash'], null),
    text: readOption(options, ['policy-context-text'], null),
  });
  const deadline = resolveUnixDeadline(options, 'deadline-unix', 'duration-minutes', 'deadline-unix');
  const committeePrivateKeys = resolveCommitteePrivateKeys({
    inlineKeys: readOption(options, ['committee-private-keys'], ''),
    inputFile: readOption(options, ['committee-private-keys-file'], null),
  });
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const policyVault = getAddress(readOption(options, ['policy-vault'], buildPolicyVaultAddress(networkId)));
  const publicClient = getPublicClient(chain);
  const recipient = getAddress(readOption(options, ['recipient'], buyer));
  const placement = await resolveRuntimePlacement({
    evaluator,
    networkId,
    options,
    policyId,
    publicClient,
  });
  const payload = await buildThresholdCommitteeRuntime({
    buyer,
    chainId: chain.id,
    committeePrivateKeys: committeePrivateKeys.join(','),
    conditionCount: placement.conditionCount,
    conditionIndex: placement.conditionIndex,
    deadline,
    evaluator,
    policyContextHash,
    policyId,
    policyVault,
    recipient,
  });
  return {
    ...payload,
    network: chain.name,
    placementSource: placement.source,
  };
}

export async function thresholdConfigCommand(options) {
  const payload = buildThresholdConfigPayload(options);
  const outputPath = resolveOutputPath(options);
  if (outputPath) {
    const writtenPath = maybeWriteJsonFile(outputPath, payload, serializeJson);
    if (CLI_RUNTIME.json) {
      emitResult('threshold-committee-config', { outputPath: writtenPath, ...payload });
      return;
    }
    printSuccess(`Wrote threshold committee config to ${writtenPath}`);
    return;
  }
  if (CLI_RUNTIME.json) {
    emitResult('threshold-committee-config', payload);
    return;
  }
  printHeading('Threshold Committee Config');
  printField('Threshold', payload.threshold);
  printField('Committee', payload.committee.join(','));
  printField('Max deadline', payload.maxDeadline);
  printField('Policy context', payload.policyContextHash);
  printField('Config data', payload.configData);
}

export async function thresholdRuntimeCommand(options) {
  const enrichedPayload = await buildThresholdRuntimePayload(options);
  const outputPath = resolveOutputPath(options);
  if (outputPath) {
    const writtenPath = maybeWriteJsonFile(outputPath, enrichedPayload, serializeJson);
    if (CLI_RUNTIME.json) {
      emitResult('threshold-committee-runtime', { outputPath: writtenPath, ...enrichedPayload });
      return;
    }
    printSuccess(`Wrote threshold committee runtime payload to ${writtenPath}`);
    return;
  }
  if (CLI_RUNTIME.json) {
    emitResult('threshold-committee-runtime', enrichedPayload);
    return;
  }
  printHeading('Threshold Committee Runtime');
  printField('Policy', enrichedPayload.policyId);
  printField('Buyer', enrichedPayload.buyer);
  printField('Recipient', enrichedPayload.recipient);
  printField('Evaluator', enrichedPayload.evaluator);
  printField('PolicyVault', enrichedPayload.policyVault);
  printField('Policy context', enrichedPayload.policyContextHash);
  printField('Deadline', enrichedPayload.deadline);
  printField('Condition count', enrichedPayload.conditionCount);
  printField('Condition index', enrichedPayload.conditionIndex);
  printField('Message hash', enrichedPayload.messageHash);
  printField('Eth signed hash', enrichedPayload.ethSignedMessageHash);
  printField('Runtime data', enrichedPayload.runtimeData);
}

export async function thresholdCheckCommand(options) {
  const policyId = parseBigIntValue(requireOption(options, ['policy-id'], 'policy id'), 'policy-id');
  const buyer = getAddress(requireOption(options, ['buyer'], 'buyer address'));
  const evaluator = getAddress(requireOption(options, ['evaluator'], 'evaluator address'));
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const publicClient = getPublicClient(chain);
  const recipient = getAddress(readOption(options, ['recipient'], buyer));
  const policyVault = getAddress(readOption(options, ['policy-vault'], buildPolicyVaultAddress(networkId)));
  const configData =
    resolveHexPayload({
      description: 'threshold committee config payload',
      directOption: 'config-data',
      fieldName: 'configData',
      fileOption: 'config-file',
      options,
    }) ?? buildThresholdConfigPayload(options).configData;
  const runtimeData =
    resolveHexPayload({
      description: 'threshold committee runtime payload',
      directOption: 'runtime-data',
      fieldName: 'runtimeData',
      fileOption: 'runtime-file',
      options,
    }) ?? (await buildThresholdRuntimePayload(options)).runtimeData;
  const policy = await publicClient.readContract({
    address: policyVault,
    abi: POLICY_VAULT_ABI,
    functionName: 'getPolicy',
    args: [policyId],
  });
  let validated = true;
  let validationError = null;
  try {
    await publicClient.readContract({
      address: evaluator,
      abi: THRESHOLD_COMMITTEE_CONDITION_ABI,
      functionName: 'validateCondition',
      args: [policyVault, policy.provider, policy.datasetId, configData],
    });
  } catch (error) {
    validated = false;
    validationError = error instanceof Error ? error.message : `${error}`;
  }
  let purchaseAllowed = false;
  let purchaseAllowedError = null;
  try {
    purchaseAllowed = await publicClient.readContract({
      address: evaluator,
      abi: THRESHOLD_COMMITTEE_CONDITION_ABI,
      functionName: 'isPurchaseAllowed',
      args: [policyVault, policyId, buyer, recipient, configData, runtimeData],
    });
  } catch (error) {
    purchaseAllowedError = error instanceof Error ? error.message : `${error}`;
  }
  const version = await publicClient.readContract({
    address: evaluator,
    abi: THRESHOLD_COMMITTEE_CONDITION_ABI,
    functionName: 'version',
  });
  const payload = {
    buyer,
    configData,
    evaluator,
    network: chain.name,
    policyId,
    policyVault,
    provider: policy.provider,
    datasetId: policy.datasetId,
    purchaseAllowed,
    purchaseAllowedError,
    recipient,
    runtimeData,
    validated,
    validationError,
    version,
  };
  if (CLI_RUNTIME.json) {
    emitResult('threshold-committee-check', payload);
    return;
  }
  printHeading('Threshold Committee Check');
  printField('Network', payload.network);
  printField('Evaluator', payload.evaluator);
  printField('Version', payload.version);
  printField('Policy', payload.policyId);
  printField('Dataset', payload.datasetId);
  printField('Provider', payload.provider);
  printField('Buyer', payload.buyer);
  printField('Recipient', payload.recipient);
  printField('Validated', payload.validated);
  if (payload.validationError) {
    printField('Validate error', payload.validationError);
  }
  printField('Allowed', payload.purchaseAllowed);
  if (payload.purchaseAllowedError) {
    printField('Allow error', payload.purchaseAllowedError);
  }
}
