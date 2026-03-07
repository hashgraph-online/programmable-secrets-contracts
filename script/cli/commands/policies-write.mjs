import { encodeAbiParameters, getAddress, parseAbiParameters, zeroAddress } from 'viem';
import { CLI_COMMAND, POLICY_VAULT_ABI } from '../constants.mjs';
import { CliError } from '../errors.mjs';
import { CLI_RUNTIME } from '../runtime.mjs';
import { emitPreview, emitResult, printSuccess, serializeJson } from '../output.mjs';
import {
  buildHashFromText,
  parseAddressList,
  parseBigIntValue,
  parseBooleanOption,
  readOption,
  requireOption,
  resolveExpiryUnix,
  resolveMetadataHash,
  resolveOutputPath,
  resolvePriceWei,
  resolveSelectedWalletRole,
  shouldPreview,
} from '../options.mjs';
import {
  buildExplorerUrl,
  buildIdentityRegistryAddress,
  buildPolicyVaultAddress,
  createTransactionResult,
  decodeIndexedEvent,
  getNetworkIdFromOptions,
  getPublicClient,
  getSelectedChain,
  getWalletClientForRole,
  maybeWriteJsonFile,
  printTransactionResult,
  readJsonFile,
  readPolicyConditions,
  resolveConditionEvaluatorAddress,
  serializePolicyForDisplay,
} from '../index-support.mjs';

function resolveAllowlistAccounts(options) {
  return parseAddressList(readOption(options, ['accounts', 'allowlist'], ''), getAddress);
}

export async function createTimeboundPolicyCommand(options) {
  const datasetId = parseBigIntValue(requireOption(options, 'dataset-id', 'dataset id'), 'dataset-id');
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const walletClient = getWalletClientForRole({ role: resolveSelectedWalletRole(options, 'provider'), chain });
  const publicClient = getPublicClient(chain);
  const payout = getAddress(readOption(options, ['payout'], walletClient.account.address));
  const priceWei = resolvePriceWei(options);
  const expiresAt = resolveExpiryUnix(options);
  const allowlistEnabled = parseBooleanOption(readOption(options, ['allowlist-enabled'], false), false);
  const metadataHash = resolveMetadataHash(options);
  const allowlistAccounts = resolveAllowlistAccounts(options);
  const conditions = [];
  if (expiresAt > 0n) {
    conditions.push({
      evaluator: resolveConditionEvaluatorAddress(networkId, 'timeRangeCondition', readOption(options, ['time-range-evaluator'], null)),
      configData: encodeAbiParameters(parseAbiParameters('(uint64 notBefore,uint64 notAfter) value'), [{ notBefore: 0n, notAfter: expiresAt }]),
    });
  }
  if (allowlistEnabled) {
    if (allowlistAccounts.length === 0) {
      throw new CliError('MISSING_ALLOWLIST_ACCOUNTS', 'Allowlist is enabled but no allowlist accounts were provided.', 'Pass --accounts 0x... when using --allowlist-enabled true.');
    }
    conditions.push({
      evaluator: resolveConditionEvaluatorAddress(networkId, 'addressAllowlistCondition', readOption(options, ['allowlist-evaluator'], null)),
      configData: encodeAbiParameters(parseAbiParameters('address[] value'), [allowlistAccounts]),
    });
  }
  const preview = {
    action: 'Create Timebound Policy',
    address: buildPolicyVaultAddress(networkId),
    args: [datasetId, payout, zeroAddress, priceWei, metadataHash, conditions],
    contract: 'PolicyVault',
    functionName: 'createPolicyForDataset',
    network: chain.name,
    nextCommand: `${CLI_COMMAND} policies list --dataset-id ${datasetId}`,
    valueWei: 0n,
    wallet: walletClient.account.address,
  };
  if (shouldPreview(options)) {
    emitPreview(preview);
    return;
  }
  const hash = await walletClient.writeContract({
    address: buildPolicyVaultAddress(networkId),
    abi: POLICY_VAULT_ABI,
    functionName: 'createPolicyForDataset',
    args: [datasetId, payout, zeroAddress, priceWei, metadataHash, conditions],
    chain,
    account: walletClient.account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const event = await decodeIndexedEvent({ abi: POLICY_VAULT_ABI, receipt, eventName: 'PolicyCreated' });
  printTransactionResult(createTransactionResult({
    action: 'Timebound Policy Created',
    chain,
    contract: 'PolicyVault',
    entityLabel: 'Policy',
    entityValue: event.args.policyId,
    explorerUrl: buildExplorerUrl(chain, hash),
    nextCommand: `${CLI_COMMAND} policies get --policy-id ${event.args.policyId}`,
    secondaryLabel: 'Dataset',
    secondaryValue: event.args.datasetId,
    txHash: hash,
    wallet: walletClient.account.address,
  }));
}

export async function createUaidPolicyCommand(options) {
  const datasetId = parseBigIntValue(requireOption(options, 'dataset-id', 'dataset id'), 'dataset-id');
  const requiredBuyerUaid = requireOption(options, ['required-buyer-uaid'], 'required buyer UAID');
  const agentId = parseBigIntValue(requireOption(options, ['agent-id'], 'ERC-8004 agent id'), 'agent-id');
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const walletClient = getWalletClientForRole({ role: resolveSelectedWalletRole(options, 'provider'), chain });
  const publicClient = getPublicClient(chain);
  const payout = getAddress(readOption(options, ['payout'], walletClient.account.address));
  const priceWei = resolvePriceWei(options);
  const expiresAt = resolveExpiryUnix(options);
  const allowlistEnabled = parseBooleanOption(readOption(options, ['allowlist-enabled'], false), false);
  const metadataHash = resolveMetadataHash(options);
  const allowlistAccounts = resolveAllowlistAccounts(options);
  const identityRegistry = getAddress(readOption(options, ['identity-registry'], buildIdentityRegistryAddress(networkId)));
  if (identityRegistry === zeroAddress) {
    throw new CliError('IDENTITY_REGISTRY_MISSING', `No identity registry is configured for ${networkId}.`, 'Provide --identity-registry or run on Arbitrum Sepolia with PROGRAMMABLE_SECRETS_NETWORK=arbitrum-sepolia.');
  }
  const conditions = [];
  if (expiresAt > 0n) {
    conditions.push({
      evaluator: resolveConditionEvaluatorAddress(networkId, 'timeRangeCondition', readOption(options, ['time-range-evaluator'], null)),
      configData: encodeAbiParameters(parseAbiParameters('(uint64 notBefore,uint64 notAfter) value'), [{ notBefore: 0n, notAfter: expiresAt }]),
    });
  }
  if (allowlistEnabled) {
    if (allowlistAccounts.length === 0) {
      throw new CliError('MISSING_ALLOWLIST_ACCOUNTS', 'Allowlist is enabled but no allowlist accounts were provided.', 'Pass --accounts 0x... when using --allowlist-enabled true.');
    }
    conditions.push({
      evaluator: resolveConditionEvaluatorAddress(networkId, 'addressAllowlistCondition', readOption(options, ['allowlist-evaluator'], null)),
      configData: encodeAbiParameters(parseAbiParameters('address[] value'), [allowlistAccounts]),
    });
  }
  conditions.push({
    evaluator: resolveConditionEvaluatorAddress(networkId, 'uaidOwnershipCondition', readOption(options, ['uaid-evaluator'], null)),
    configData: encodeAbiParameters(
      parseAbiParameters('(bytes32 requiredBuyerUaidHash,address identityRegistry,uint256 agentId) value'),
      [{ requiredBuyerUaidHash: buildHashFromText(requiredBuyerUaid), identityRegistry, agentId }],
    ),
  });
  const preview = {
    action: 'Create UAID Policy',
    address: buildPolicyVaultAddress(networkId),
    args: [datasetId, payout, zeroAddress, priceWei, metadataHash, conditions],
    contract: 'PolicyVault',
    functionName: 'createPolicyForDataset',
    network: chain.name,
    nextCommand: `${CLI_COMMAND} policies get --policy-id <policy-id>`,
    valueWei: 0n,
    wallet: walletClient.account.address,
  };
  if (shouldPreview(options)) {
    emitPreview(preview);
    return;
  }
  const hash = await walletClient.writeContract({
    address: buildPolicyVaultAddress(networkId),
    abi: POLICY_VAULT_ABI,
    functionName: 'createPolicyForDataset',
    args: [datasetId, payout, zeroAddress, priceWei, metadataHash, conditions],
    chain,
    account: walletClient.account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const event = await decodeIndexedEvent({ abi: POLICY_VAULT_ABI, receipt, eventName: 'PolicyCreated' });
  printTransactionResult(createTransactionResult({
    action: 'UAID Policy Created',
    chain,
    contract: 'PolicyVault',
    entityLabel: 'Policy',
    entityValue: event.args.policyId,
    explorerUrl: buildExplorerUrl(chain, hash),
    nextCommand: `${CLI_COMMAND} policies get --policy-id ${event.args.policyId}`,
    secondaryLabel: 'Dataset',
    secondaryValue: event.args.datasetId,
    txHash: hash,
    wallet: walletClient.account.address,
  }));
}

export async function updatePolicyCommand(options) {
  const policyId = parseBigIntValue(requireOption(options, 'policy-id', 'policy id'), 'policy-id');
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const walletClient = getWalletClientForRole({ role: resolveSelectedWalletRole(options, 'provider'), chain });
  const publicClient = getPublicClient(chain);
  const existing = await publicClient.readContract({
    address: buildPolicyVaultAddress(networkId),
    abi: POLICY_VAULT_ABI,
    functionName: 'getPolicy',
    args: [policyId],
  });
  const nextPrice = readOption(options, ['price-wei', 'price-eth']) ? resolvePriceWei(options) : existing.price;
  const active = readOption(options, ['active']) !== null ? parseBooleanOption(readOption(options, ['active'])) : existing.active;
  const metadataHash = readOption(options, ['metadata-hash', 'metadata', 'metadata-file', 'metadata-json']) !== null
    ? resolveMetadataHash(options)
    : existing.metadataHash;
  const preview = {
    action: 'Update Policy',
    address: buildPolicyVaultAddress(networkId),
    args: [policyId, nextPrice, active, metadataHash],
    contract: 'PolicyVault',
    functionName: 'updatePolicy',
    network: chain.name,
    nextCommand: `${CLI_COMMAND} policies get --policy-id ${policyId}`,
    valueWei: 0n,
    wallet: walletClient.account.address,
  };
  if (shouldPreview(options)) {
    emitPreview(preview);
    return;
  }
  const hash = await walletClient.writeContract({
    address: buildPolicyVaultAddress(networkId),
    abi: POLICY_VAULT_ABI,
    functionName: 'updatePolicy',
    args: [policyId, nextPrice, active, metadataHash],
    chain,
    account: walletClient.account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  printTransactionResult(createTransactionResult({
    action: 'Policy Updated',
    chain,
    contract: 'PolicyVault',
    entityLabel: 'Policy',
    entityValue: policyId,
    explorerUrl: buildExplorerUrl(chain, hash),
    nextCommand: `${CLI_COMMAND} policies get --policy-id ${policyId}`,
    txHash: hash,
    wallet: walletClient.account.address,
  }));
}

export async function setPolicyAllowlistCommand(options) {
  const policyId = parseBigIntValue(requireOption(options, 'policy-id', 'policy id'), 'policy-id');
  throw new CliError('ALLOWLIST_IMMUTABLE', `Policy ${policyId} allowlists are immutable in the evaluator-array model.`, `Create a new policy with --allowlist-enabled and --accounts, then deactivate the old policy with "${CLI_COMMAND} policies update --policy-id ${policyId} --active false".`);
}

export async function exportPolicyCommand(options) {
  const policyId = parseBigIntValue(requireOption(options, 'policy-id', 'policy id'), 'policy-id');
  const networkId = getNetworkIdFromOptions(options);
  const publicClient = getPublicClient(getSelectedChain(networkId));
  const policy = await publicClient.readContract({
    address: buildPolicyVaultAddress(networkId),
    abi: POLICY_VAULT_ABI,
    functionName: 'getPolicy',
    args: [policyId],
  });
  const conditions = await readPolicyConditions({ publicClient, networkId, policyId });
  const payload = {
    exportedAt: new Date().toISOString(),
    network: networkId,
    version: 1,
    policy: serializePolicyForDisplay(policyId, policy, conditions),
  };
  const outputPath = resolveOutputPath(options);
  if (outputPath) {
    const writtenPath = maybeWriteJsonFile(outputPath, payload, serializeJson);
    if (CLI_RUNTIME.json) {
      emitResult('policy-export', { outputPath: writtenPath, ...payload });
      return;
    }
    printSuccess(`Wrote policy export to ${writtenPath}`);
    return;
  }
  emitResult('policy-export', payload);
  if (!CLI_RUNTIME.json) {
    console.log(serializeJson(payload));
  }
}

export async function importPolicyCommand(options) {
  const inputPath = requireOption(options, ['file', 'input'], 'policy import file');
  const payload = readJsonFile(inputPath, 'policy import');
  const policy = payload.policy || payload;
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const walletClient = getWalletClientForRole({ role: resolveSelectedWalletRole(options, 'provider'), chain });
  const publicClient = getPublicClient(chain);
  const datasetId = parseBigIntValue(`${policy.datasetId}`, 'dataset id');
  const payout = getAddress(policy.payout || walletClient.account.address);
  const priceWei = parseBigIntValue(`${policy.priceWei ?? policy.price ?? 0}`, 'price');
  const metadataHash = policy.metadataHash;
  const importedConditions = Array.isArray(policy.conditions) ? policy.conditions : [];
  const args = [
    datasetId,
    payout,
    zeroAddress,
    priceWei,
    metadataHash,
    importedConditions.map((condition) => ({
      evaluator: getAddress(condition.evaluator),
      configData: condition.configData,
    })),
  ];
  const preview = {
    action: 'Import Policy',
    address: buildPolicyVaultAddress(networkId),
    args,
    contract: 'PolicyVault',
    functionName: 'createPolicyForDataset',
    network: chain.name,
    nextCommand: `${CLI_COMMAND} policies list --dataset-id ${datasetId}`,
    valueWei: 0n,
    wallet: walletClient.account.address,
  };
  if (shouldPreview(options)) {
    emitPreview(preview);
    return;
  }
  const hash = await walletClient.writeContract({
    address: buildPolicyVaultAddress(networkId),
    abi: POLICY_VAULT_ABI,
    functionName: 'createPolicyForDataset',
    args,
    chain,
    account: walletClient.account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const event = await decodeIndexedEvent({ abi: POLICY_VAULT_ABI, receipt, eventName: 'PolicyCreated' });
  printTransactionResult(createTransactionResult({
    action: 'Policy Imported',
    chain,
    contract: 'PolicyVault',
    entityLabel: 'Policy',
    entityValue: event.args.policyId,
    explorerUrl: buildExplorerUrl(chain, hash),
    nextCommand: `${CLI_COMMAND} policies get --policy-id ${event.args.policyId}`,
    secondaryLabel: 'Dataset',
    secondaryValue: event.args.datasetId,
    txHash: hash,
    wallet: walletClient.account.address,
  }));
}
