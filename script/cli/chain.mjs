import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  decodeEventLog,
  encodeAbiParameters,
  formatEther,
  getAddress,
  http,
  parseAbiParameters,
  zeroAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  ACCESS_RECEIPT_ABI,
  CLI_COMMAND,
  DEFAULT_NETWORK_ID,
  DEPLOYMENT_FILES,
  NETWORK_ALIASES,
  POLICY_VAULT_ABI,
  SUPPORTED_NETWORKS,
} from './constants.mjs';
import { CliError } from './errors.mjs';
import { normalizePrivateKey, requireEnvValue, resolvePreferredEnvValue } from './env.mjs';
import { printField } from './output.mjs';
import { CLI_RUNTIME } from './runtime.mjs';
import { readOption } from './options.mjs';

export function loadDeployment(network) {
  const path = DEPLOYMENT_FILES[network];
  if (!path) {
    throw new CliError('UNSUPPORTED_NETWORK', `Unsupported deployment network: ${network}`, `Use one of: ${Object.keys(DEPLOYMENT_FILES).join(', ')}.`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function getPublicClient(chain) {
  return createPublicClient({
    chain,
    transport: http(chain.rpcUrls.default.http[0]),
  });
}

export function getWalletClient({ privateKey, chain }) {
  const normalizedPrivateKey = normalizePrivateKey(privateKey, 'privateKey');
  const account = privateKeyToAccount(normalizedPrivateKey);
  return createWalletClient({
    account,
    chain,
    transport: http(chain.rpcUrls.default.http[0]),
  });
}

export function getSelectedNetworkId() {
  const requestedNetworkId = readOption(
    CLI_RUNTIME.globalOptions,
    ['network'],
    resolvePreferredEnvValue('PROGRAMMABLE_SECRETS_NETWORK', ['DEMO_ERC8004_NETWORK'], DEFAULT_NETWORK_ID).value,
  );
  const normalizedNetworkId = NETWORK_ALIASES[requestedNetworkId] || requestedNetworkId;
  if (!(normalizedNetworkId in SUPPORTED_NETWORKS)) {
    throw new CliError('UNSUPPORTED_NETWORK', `Unsupported PROGRAMMABLE_SECRETS_NETWORK "${requestedNetworkId}".`, `Expected one of: ${Object.keys(SUPPORTED_NETWORKS).join(', ')}`);
  }
  return normalizedNetworkId;
}

export function getSelectedChain(networkId) {
  const chain = SUPPORTED_NETWORKS[networkId];
  if (!chain) {
    throw new CliError('UNSUPPORTED_NETWORK', `Unsupported network "${networkId}".`, `Use one of: ${Object.keys(SUPPORTED_NETWORKS).join(', ')}`);
  }
  return chain;
}

export function normalizeNetworkId(rawValue) {
  const candidate = `${rawValue}`.trim();
  return NETWORK_ALIASES[candidate] || candidate;
}

export function getNetworkIdFromOptions(options) {
  const requested = readOption(options, ['network'], null);
  if (!requested) {
    return getSelectedNetworkId();
  }
  const normalized = normalizeNetworkId(requested);
  if (!(normalized in SUPPORTED_NETWORKS)) {
    throw new CliError('UNSUPPORTED_NETWORK', `Unsupported network "${requested}".`, `Expected one of: ${Object.keys(SUPPORTED_NETWORKS).join(', ')}.`);
  }
  return normalized;
}

export function getChainFromOptions(options) {
  return getSelectedChain(getNetworkIdFromOptions(options));
}

export function buildExplorerUrl(chain, hash, kind = 'tx') {
  if (!chain?.explorerBaseUrl || !hash) {
    return null;
  }
  return `${chain.explorerBaseUrl}/${kind}/${hash}`;
}

export function buildPolicyVaultAddress(network) {
  return getAddress(loadDeployment(network).entrypoints.policyVaultAddress);
}

export function buildPaymentModuleAddress(network) {
  return getAddress(loadDeployment(network).entrypoints.paymentModuleAddress);
}

export function buildAccessReceiptAddress(network) {
  return getAddress(loadDeployment(network).entrypoints.accessReceiptAddress);
}

export function buildIdentityRegistryAddress(network) {
  return getAddress(loadDeployment(network).entrypoints.agentIdentityRegistryAddress);
}

export function requireIdentityRegistryAddress(network) {
  const identityRegistryAddress = buildIdentityRegistryAddress(network);
  if (identityRegistryAddress === zeroAddress) {
    throw new CliError('IDENTITY_REGISTRY_MISSING', `No ERC-8004 IdentityRegistry is configured for ${network}.`, `Update deployments/${network}.json, pass --identity-registry, or switch PROGRAMMABLE_SECRETS_NETWORK.`);
  }
  return identityRegistryAddress;
}

export function getWalletKeyForRole(role) {
  if (role === 'provider') {
    return requireEnvValue('ETH_PK_2', { description: 'provider wallet private key' }).value;
  }
  return requireEnvValue('ETH_PK', { description: 'agent wallet private key' }).value;
}

export function getWalletClientForRole({ role, chain }) {
  return getWalletClient({ privateKey: getWalletKeyForRole(role), chain });
}

export function formatTimestamp(unixSeconds) {
  if (!unixSeconds || Number(unixSeconds) === 0) {
    return 'none';
  }
  return new Date(Number(unixSeconds) * 1000).toISOString();
}

function normalizeAddress(value) {
  return getAddress(value).toLowerCase();
}

export function getBuiltInEvaluatorCatalog(networkId) {
  const deployment = loadDeployment(networkId);
  const builtIns = deployment.contracts?.builtInPolicyEvaluators;
  if (!builtIns) {
    return {};
  }
  const catalog = {};
  for (const [key, entry] of Object.entries(builtIns)) {
    if (entry?.address) {
      catalog[normalizeAddress(entry.address)] = { address: getAddress(entry.address), kind: key };
    }
  }
  return catalog;
}

export function resolveConditionEvaluatorAddress(networkId, kind, overrideValue = null) {
  if (overrideValue) {
    return getAddress(overrideValue);
  }
  const entry = Object.values(getBuiltInEvaluatorCatalog(networkId)).find((candidate) => candidate.kind === kind);
  if (!entry) {
    throw new CliError('MISSING_EVALUATOR_ADDRESS', `No ${kind} evaluator address is available for ${networkId}.`, `Add builtInPolicyEvaluators.${kind} to deployments/${networkId}.json or pass an explicit evaluator address.`);
  }
  return getAddress(entry.address);
}

export function buildRuntimeWitnessLabel(runtimeWitness) {
  if (runtimeWitness === 'buyer-uaid') {
    return 'buyer-uaid string';
  }
  if (runtimeWitness === 'none') {
    return 'none';
  }
  return 'custom runtime bytes';
}

function buildConditionDescription(kind, decoded) {
  if (kind === 'timeRangeCondition' && decoded) {
    return `Purchase window ${formatTimestamp(decoded.notBefore)} -> ${formatTimestamp(decoded.notAfter)}`;
  }
  if (kind === 'uaidOwnershipCondition' && decoded) {
    return `Requires buyer UAID hash ${decoded.requiredBuyerUaidHash} and ERC-8004 agent ${decoded.agentId} at ${decoded.identityRegistry}`;
  }
  if (kind === 'addressAllowlistCondition' && Array.isArray(decoded)) {
    return `Allows ${decoded.length} wallet${decoded.length === 1 ? '' : 's'}`;
  }
  return kind ? `Built-in evaluator: ${kind}` : 'Custom evaluator condition';
}

export function serializeEvaluatorRegistration(evaluator, registration, builtIn = null) {
  return {
    active: registration.active,
    address: evaluator,
    builtIn: registration.builtIn,
    builtInKind: builtIn?.kind || null,
    metadataHash: registration.metadataHash,
    registeredAt: registration.registeredAt,
    registrant: registration.registrant,
  };
}

function decodeConditionConfig(kind, configData) {
  try {
    if (kind === 'timeRangeCondition') {
      const [decoded] = decodeAbiParameters(parseAbiParameters('(uint64 notBefore,uint64 notAfter) value'), configData);
      return { decoded, runtimeWitness: 'none' };
    }
    if (kind === 'uaidOwnershipCondition') {
      const [decoded] = decodeAbiParameters(parseAbiParameters('(bytes32 requiredBuyerUaidHash,address identityRegistry,uint256 agentId) value'), configData);
      return { decoded, runtimeWitness: 'buyer-uaid' };
    }
    if (kind === 'addressAllowlistCondition') {
      const [decoded] = decodeAbiParameters(parseAbiParameters('address[] value'), configData);
      return { decoded, runtimeWitness: 'none' };
    }
  } catch {
    return { decoded: null, runtimeWitness: 'unknown' };
  }
  return { decoded: null, runtimeWitness: 'unknown' };
}

export async function readPolicyConditions({ publicClient, networkId, policyId }) {
  const policyVaultAddress = buildPolicyVaultAddress(networkId);
  const builtInCatalog = getBuiltInEvaluatorCatalog(networkId);
  const conditionCount = await publicClient.readContract({
    address: policyVaultAddress,
    abi: POLICY_VAULT_ABI,
    functionName: 'getPolicyConditionCount',
    args: [policyId],
  });
  const items = [];
  for (let index = 0n; index < conditionCount; index += 1n) {
    const [evaluator, configData, configHash] = await publicClient.readContract({
      address: policyVaultAddress,
      abi: POLICY_VAULT_ABI,
      functionName: 'getPolicyCondition',
      args: [policyId, index],
    });
    const registration = await publicClient.readContract({
      address: policyVaultAddress,
      abi: POLICY_VAULT_ABI,
      functionName: 'getPolicyEvaluator',
      args: [evaluator],
    });
    const builtIn = builtInCatalog[normalizeAddress(evaluator)] || null;
    const decoded = decodeConditionConfig(builtIn?.kind || 'unknown', configData);
    items.push({
      builtInKind: builtIn?.kind || null,
      configData,
      configHash,
      configSummary: decoded.decoded,
      description: buildConditionDescription(builtIn?.kind || null, decoded.decoded),
      evaluator,
      evaluatorRegistration: serializeEvaluatorRegistration(evaluator, registration, builtIn),
      index,
      runtimeWitness: decoded.runtimeWitness,
      runtimeWitnessLabel: buildRuntimeWitnessLabel(decoded.runtimeWitness),
    });
  }
  return items;
}

export function buildConditionRuntimeInputs(conditions, options) {
  const buyerUaid = readOption(options, ['buyer-uaid'], '').trim();
  const runtimeInputs = [];
  for (const condition of conditions) {
    if (condition.runtimeWitness === 'buyer-uaid') {
      if (!buyerUaid) {
        throw new CliError('MISSING_BUYER_UAID', 'This policy requires --buyer-uaid for purchase runtime inputs.', `Rerun with: ${CLI_COMMAND} purchase --policy-id <id> --buyer-uaid <uaid>`);
      }
      runtimeInputs.push(encodeAbiParameters(parseAbiParameters('string value'), [buyerUaid]));
      continue;
    }
    runtimeInputs.push('0x');
  }
  return runtimeInputs;
}

export function buildPolicyCategory(conditions) {
  const kinds = new Set(conditions.map((condition) => condition.builtInKind).filter(Boolean));
  if (kinds.has('uaidOwnershipCondition')) {
    return 'uaid-gated';
  }
  if (kinds.has('timeRangeCondition')) {
    return 'timebound';
  }
  if (kinds.has('addressAllowlistCondition')) {
    return 'allowlisted';
  }
  return 'custom';
}

export function printDatasetSummary(datasetId, dataset) {
  printField('Dataset', datasetId);
  printField('Provider', dataset.provider);
  printField('Active', dataset.active);
  printField('Created', formatTimestamp(dataset.createdAt));
  printField('Ciphertext', dataset.ciphertextHash);
  printField('Key commit', dataset.keyCommitment);
  printField('Metadata', dataset.metadataHash);
  printField('Prov UAID', dataset.providerUaidHash);
}

export function printPolicySummary(policyId, policy) {
  printField('Policy', policyId);
  printField('Dataset', policy.datasetId);
  printField('Provider', policy.provider);
  printField('Payout', policy.payout);
  printField('Price', `${formatEther(policy.price)} ETH (${policy.price} wei)`);
  printField('Active', policy.active);
  printField('Receipt transferable', policy.receiptTransferable);
  printField('Allowlist', policy.allowlistEnabled);
  printField('Conditions', policy.conditionCount);
  printField('Created', formatTimestamp(policy.createdAt));
  printField('Metadata', policy.metadataHash);
  printField('ConditionsHash', policy.conditionsHash);
}

export function printPolicyConditions(conditions, cliRuntime) {
  if (cliRuntime.json || cliRuntime.quiet || conditions.length === 0) {
    return;
  }
  console.log('Conditions       see below');
  for (const condition of conditions) {
    console.log(`  - [${condition.index}] ${condition.builtInKind || 'custom'}: ${condition.description}`);
    console.log(`    evaluator=${condition.evaluator}`);
    console.log(`    witness=${condition.runtimeWitnessLabel}`);
  }
}

export function printReceiptSummary(receiptTokenId, receipt) {
  printField('Receipt', receiptTokenId);
  printField('Policy', receipt.policyId);
  printField('Dataset', receipt.datasetId);
  printField('Buyer', receipt.buyer);
  printField('Recipient', receipt.recipient);
  printField('Price', `${formatEther(receipt.price)} ETH (${receipt.price} wei)`);
  printField('Purchased', formatTimestamp(receipt.purchasedAt));
  printField('Ciphertext', receipt.ciphertextHash);
  printField('Key commit', receipt.keyCommitment);
}

export function serializeDataset(datasetId, dataset, policyIds = []) {
  return {
    active: dataset.active,
    ciphertextHash: dataset.ciphertextHash,
    createdAt: dataset.createdAt,
    datasetId,
    keyCommitment: dataset.keyCommitment,
    metadataHash: dataset.metadataHash,
    policies: policyIds,
    provider: dataset.provider,
    providerUaidHash: dataset.providerUaidHash,
  };
}

export function serializePolicy(policyId, policy) {
  return {
    active: policy.active,
    receiptTransferable: policy.receiptTransferable,
    allowlistEnabled: policy.allowlistEnabled,
    createdAt: policy.createdAt,
    conditionCount: policy.conditionCount,
    conditionsHash: policy.conditionsHash,
    ciphertextHash: policy.ciphertextHash,
    datasetId: policy.datasetId,
    keyCommitment: policy.keyCommitment,
    metadataHash: policy.metadataHash,
    paymentToken: policy.paymentToken,
    payout: policy.payout,
    policyId,
    priceWei: policy.price,
    provider: policy.provider,
    providerUaidHash: policy.providerUaidHash,
  };
}

export function serializePolicyForDisplay(policyId, policy, conditions = []) {
  return {
    ...serializePolicy(policyId, policy),
    category: buildPolicyCategory(conditions),
    conditions,
    receiptSemantics: 'purchase-time evaluator checks, then policy-active and dataset-active status for access resolution',
  };
}

export function serializeReceipt(receiptTokenId, receipt) {
  return {
    buyer: receipt.buyer,
    ciphertextHash: receipt.ciphertextHash,
    datasetId: receipt.datasetId,
    keyCommitment: receipt.keyCommitment,
    paymentToken: receipt.paymentToken,
    policyId: receipt.policyId,
    priceWei: receipt.price,
    purchasedAt: receipt.purchasedAt,
    receiptTransferable: receipt.receiptTransferable,
    receiptId: receiptTokenId,
    recipient: receipt.recipient,
  };
}

export function maybeWriteJsonFile(outputPath, payload, serializeJson) {
  const resolvedPath = resolve(outputPath);
  writeFileSync(resolvedPath, `${serializeJson(payload)}\n`);
  return resolvedPath;
}

export function readJsonFile(inputPath, description) {
  try {
    return JSON.parse(readFileSync(resolve(inputPath), 'utf8'));
  } catch (error) {
    throw new CliError('JSON_READ_FAILED', `Unable to read ${description} from ${inputPath}.`, 'Confirm the file exists and contains valid JSON.', error instanceof Error ? error.message : `${error}`);
  }
}

export function requireSecondWallet() {
  return requireEnvValue('ETH_PK_2', { description: 'provider wallet private key' }).value;
}

export function buildBuyerUaid({ chainId, agentId }) {
  const provided = resolvePreferredEnvValue('PROGRAMMABLE_SECRETS_BUYER_UAID', ['DEMO_BUYER_UAID']).value;
  if (provided) {
    return provided;
  }
  return `uaid:aid:volatility-agent;uid=${chainId}:${agentId};registry=erc-8004;proto=erc-8004;nativeId=${chainId}:${agentId}`;
}

export function parseErc8004AgentId(value) {
  const trimmed = `${value ?? ''}`.trim();
  if (!trimmed) {
    throw new CliError('MISSING_AGENT_ID', 'ERC-8004 agent id is required.', `Provide --agent-id or rerun ${CLI_COMMAND} identity register with --interactive.`);
  }
  const candidate = trimmed.includes(':') ? trimmed.slice(trimmed.lastIndexOf(':') + 1) : trimmed;
  const parsed = Number.parseInt(candidate, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliError('INVALID_AGENT_ID', `Unable to parse ERC-8004 agent id from "${trimmed}".`, 'Use a positive integer or a chain-qualified value such as 421614:97.');
  }
  return parsed;
}

export async function decodeIndexedEvent({ abi, receipt, eventName }) {
  const log = receipt.logs.find((candidate) => {
    try {
      const decoded = decodeEventLog({ abi, data: candidate.data, topics: candidate.topics });
      return decoded.eventName === eventName;
    } catch {
      return false;
    }
  });
  if (!log) {
    throw new CliError('EVENT_NOT_FOUND', `Expected ${eventName} event was not found.`, 'Inspect the transaction receipt and confirm the contract emitted the expected event.');
  }
  return decodeEventLog({ abi, data: log.data, topics: log.topics });
}
