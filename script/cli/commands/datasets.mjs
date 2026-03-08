import { CLI_COMMAND, POLICY_VAULT_ABI } from '../constants.mjs';
import { CliError } from '../errors.mjs';
import {
  buildExplorerUrl,
  buildPolicyVaultAddress,
  createReadResult,
  createTransactionResult,
  decodeIndexedEvent,
  getNetworkIdFromOptions,
  getPublicClient,
  getSelectedChain,
  getWalletClientForRole,
  printDatasetSummary,
  printHeading,
  printTransactionResult,
  serializeDataset,
} from '../index-support.mjs';
import { emitPreview, emitResult, printField, printSuccess, serializeJson } from '../output.mjs';
import { registerBrokerBackedAgentWithOptions, resolveBrokerBackedAgentByWallet } from '../broker.mjs';
import {
  parseBigIntValue,
  parseBooleanOption,
  readOption,
  requireOption,
  resolveDatasetRegistrationHashes,
  resolveOutputPath,
  resolveSelectedWalletRole,
  shouldPreview,
} from '../options.mjs';
import { CLI_RUNTIME } from '../runtime.mjs';
import { maybeWriteJsonFile, readJsonFile } from '../chain.mjs';
import { normalizeHash } from '../options.mjs';
import { normalizeProviderUaid } from '../provider-uaid.mjs';

async function resolveProviderUaidFromBroker(options, {
  allowRegistration,
  networkId,
  walletRole,
}) {
  const explicitProviderUaid = normalizeProviderUaid(readOption(options, ['provider-uaid'], ''), {
    fieldName: 'provider UAID',
  });
  if (explicitProviderUaid) {
    return explicitProviderUaid;
  }
  const shouldResolve = parseBooleanOption(
    readOption(
      options,
      ['resolve-provider-uaid', 'provider-uaid-auto'],
      'true',
    ),
    true,
  );
  if (!shouldResolve) {
    return null;
  }
  const requireErc8004 = parseBooleanOption(
    readOption(
      options,
      ['provider-uaid-require-erc8004'],
      'false',
    ),
    false,
  );
  const existingIdentity = await resolveBrokerBackedAgentByWallet({
    networkId,
    requireErc8004,
    walletRole,
  });
  if (existingIdentity?.uaid) {
    return normalizeProviderUaid(existingIdentity.uaid, { fieldName: 'broker provider UAID' });
  }
  const shouldRegister = parseBooleanOption(
    readOption(
      options,
      ['register-provider-agent', 'broker-register-provider-agent'],
      'false',
    ),
    false,
  );
  if (!shouldRegister) {
    return null;
  }
  if (!allowRegistration) {
    throw new CliError(
      'PREVIEW_REQUIRES_PROVIDER_UAID',
      'Preview mode cannot auto-register a provider agent.',
      `Provide --provider-uaid, --provider-uaid-hash, or run without --preview using "${CLI_COMMAND} datasets register --register-provider-agent true".`,
    );
  }
  const registration = await registerBrokerBackedAgentWithOptions({
    includeErc8004Network: requireErc8004,
    networkId,
    registerIfMissing: true,
    reuseExisting: false,
    walletRole,
  });
  try {
    return normalizeProviderUaid(registration.brokerUaid, { fieldName: 'registered provider UAID' });
  } finally {
    await registration.localAgentHandle.stop();
  }
}

async function resolveDatasetRegistrationArgs(options, {
  allowRegistration,
  networkId,
  walletRole,
}) {
  const bundlePath = readOption(options, ['bundle-file'], null);
  if (!bundlePath) {
    const providerUaid = await resolveProviderUaidFromBroker(options, {
      allowRegistration,
      networkId,
      walletRole,
    });
    try {
      return resolveDatasetRegistrationHashes(options, providerUaid);
    } catch (error) {
      if (
        error instanceof CliError
        && error.code === 'MISSING_HASH_SOURCE'
        && `${error.message}`.toLowerCase().includes('provider uaid hash')
      ) {
        throw new CliError(
          'MISSING_PROVIDER_UAID',
          'Dataset registration requires a valid provider UAID.',
          `Provide --provider-uaid, --provider-uaid-hash, or enable auto-registration with "${CLI_COMMAND} datasets register --register-provider-agent true".`,
        );
      }
      throw error;
    }
  }
  const payload = readJsonFile(bundlePath, 'bundle file');
  const bundle = payload.bundle || payload;
  return {
    ciphertextHash: normalizeHash(bundle.ciphertextHash, 'ciphertext hash'),
    keyCommitment: normalizeHash(bundle.keyCommitment, 'key commitment'),
    metadataHash: normalizeHash(bundle.metadataHash, 'metadata hash'),
    providerUaidHash: normalizeHash(bundle.providerUaidHash, 'provider UAID hash'),
  };
}

export async function listDatasetsCommand(options) {
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const publicClient = getPublicClient(chain);
  const policyVaultAddress = buildPolicyVaultAddress(networkId);
  const datasetCount = await publicClient.readContract({
    address: policyVaultAddress,
    abi: POLICY_VAULT_ABI,
    functionName: 'datasetCount',
  });
  const datasets = [];
  printHeading(`Datasets on ${chain.name}`);
  printField('Total', datasetCount);
  const providerFilter = options.provider?.trim()?.toLowerCase() || null;
  for (let datasetId = 1n; datasetId <= datasetCount; datasetId += 1n) {
    const dataset = await publicClient.readContract({
      address: policyVaultAddress,
      abi: POLICY_VAULT_ABI,
      functionName: 'getDataset',
      args: [datasetId],
    });
    if (providerFilter && dataset.provider.toLowerCase() !== providerFilter) {
      continue;
    }
    const policyIds = await publicClient.readContract({
      address: policyVaultAddress,
      abi: POLICY_VAULT_ABI,
      functionName: 'getDatasetPolicyIds',
      args: [datasetId],
    });
    const serialized = serializeDataset(datasetId, dataset, policyIds);
    datasets.push(serialized);
    if (!CLI_RUNTIME.json) {
      console.log('');
      printDatasetSummary(datasetId, dataset);
    }
  }
  if (CLI_RUNTIME.json) {
    emitResult('datasets', createReadResult('datasets', {
      count: datasetCount,
      items: datasets,
      network: chain.name,
    }).result);
  }
}

export async function getDatasetCommand(options) {
  const datasetId = parseBigIntValue(requireOption(options, 'dataset-id', 'dataset id'), 'dataset-id');
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const publicClient = getPublicClient(chain);
  const policyVaultAddress = buildPolicyVaultAddress(networkId);
  const dataset = await publicClient.readContract({
    address: policyVaultAddress,
    abi: POLICY_VAULT_ABI,
    functionName: 'getDataset',
    args: [datasetId],
  });
  const policyIds = await publicClient.readContract({
    address: policyVaultAddress,
    abi: POLICY_VAULT_ABI,
    functionName: 'getDatasetPolicyIds',
    args: [datasetId],
  });
  const payload = { ...serializeDataset(datasetId, dataset, policyIds), network: chain.name };
  if (CLI_RUNTIME.json) {
    emitResult('dataset', payload);
    return;
  }
  printHeading(`Dataset ${datasetId} on ${chain.name}`);
  printDatasetSummary(datasetId, dataset);
  printField('Policies', policyIds.length > 0 ? policyIds.join(', ') : 'none');
}

export async function registerDatasetCommand(options) {
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const walletRole = resolveSelectedWalletRole(options, 'provider');
  const walletClient = getWalletClientForRole({ role: walletRole, chain });
  const publicClient = getPublicClient(chain);
  const policyVaultAddress = buildPolicyVaultAddress(networkId);
  const previewMode = shouldPreview(options);
  const hashes = await resolveDatasetRegistrationArgs(options, {
    allowRegistration: !previewMode,
    networkId,
    walletRole,
  });
  const preview = {
    action: 'Register Dataset',
    address: policyVaultAddress,
    args: [hashes.ciphertextHash, hashes.keyCommitment, hashes.metadataHash, hashes.providerUaidHash],
    contract: 'PolicyVault',
    functionName: 'registerDataset',
    network: chain.name,
    nextCommand: `${CLI_COMMAND} datasets get --dataset-id <dataset-id>`,
    valueWei: 0n,
    wallet: walletClient.account.address,
  };
  if (previewMode) {
    emitPreview(preview);
    return;
  }
  const hash = await walletClient.writeContract({
    address: policyVaultAddress,
    abi: POLICY_VAULT_ABI,
    functionName: 'registerDataset',
    args: [hashes.ciphertextHash, hashes.keyCommitment, hashes.metadataHash, hashes.providerUaidHash],
    chain,
    account: walletClient.account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const event = await decodeIndexedEvent({ abi: POLICY_VAULT_ABI, receipt, eventName: 'DatasetRegistered' });
  printTransactionResult(createTransactionResult({
    action: 'Dataset Registered',
    chain,
    contract: 'PolicyVault',
    entityLabel: 'Dataset',
    entityValue: event.args.datasetId,
    explorerUrl: buildExplorerUrl(chain, hash),
    nextCommand: `${CLI_COMMAND} datasets get --dataset-id ${event.args.datasetId}`,
    txHash: hash,
    wallet: walletClient.account.address,
  }));
}

export async function setDatasetActiveCommand(options) {
  const datasetId = parseBigIntValue(requireOption(options, 'dataset-id', 'dataset id'), 'dataset-id');
  const active = parseBooleanOption(requireOption(options, 'active', 'active flag'));
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const walletClient = getWalletClientForRole({
    role: resolveSelectedWalletRole(options, 'provider'),
    chain,
  });
  const publicClient = getPublicClient(chain);
  const preview = {
    action: 'Set Dataset Active',
    address: buildPolicyVaultAddress(networkId),
    args: [datasetId, active],
    contract: 'PolicyVault',
    functionName: 'setDatasetActive',
    network: chain.name,
    nextCommand: `${CLI_COMMAND} datasets get --dataset-id ${datasetId}`,
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
    functionName: 'setDatasetActive',
    args: [datasetId, active],
    chain,
    account: walletClient.account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  printTransactionResult(createTransactionResult({
    action: 'Dataset State Updated',
    chain,
    contract: 'PolicyVault',
    entityLabel: 'Dataset',
    entityValue: datasetId,
    explorerUrl: buildExplorerUrl(chain, hash),
    nextCommand: `${CLI_COMMAND} datasets get --dataset-id ${datasetId}`,
    secondaryLabel: 'Active',
    secondaryValue: active,
    txHash: hash,
    wallet: walletClient.account.address,
  }));
}

export async function exportDatasetCommand(options) {
  const datasetId = parseBigIntValue(requireOption(options, 'dataset-id', 'dataset id'), 'dataset-id');
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const publicClient = getPublicClient(chain);
  const dataset = await publicClient.readContract({
    address: buildPolicyVaultAddress(networkId),
    abi: POLICY_VAULT_ABI,
    functionName: 'getDataset',
    args: [datasetId],
  });
  const policyIds = await publicClient.readContract({
    address: buildPolicyVaultAddress(networkId),
    abi: POLICY_VAULT_ABI,
    functionName: 'getDatasetPolicyIds',
    args: [datasetId],
  });
  const payload = {
    exportedAt: new Date().toISOString(),
    network: networkId,
    version: 1,
    dataset: serializeDataset(datasetId, dataset, policyIds),
  };
  const outputPath = resolveOutputPath(options);
  if (outputPath) {
    const writtenPath = maybeWriteJsonFile(outputPath, payload, serializeJson);
    if (CLI_RUNTIME.json) {
      emitResult('dataset-export', { outputPath: writtenPath, ...payload });
      return;
    }
    printSuccess(`Wrote dataset export to ${writtenPath}`);
    return;
  }
  emitResult('dataset-export', payload);
  if (!CLI_RUNTIME.json) {
    console.log(serializeJson(payload));
  }
}

export async function importDatasetCommand(options) {
  const inputPath = requireOption(options, ['file', 'input', 'bundle-file'], 'dataset import file');
  const payload = readJsonFile(inputPath, 'dataset import');
  const dataset = payload.dataset || payload;
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const walletClient = getWalletClientForRole({
    role: resolveSelectedWalletRole(options, 'provider'),
    chain,
  });
  const publicClient = getPublicClient(chain);
  const args = [
    dataset.ciphertextHash,
    dataset.keyCommitment,
    dataset.metadataHash,
    dataset.providerUaidHash,
  ];
  const preview = {
    action: 'Import Dataset',
    address: buildPolicyVaultAddress(networkId),
    args,
    contract: 'PolicyVault',
    functionName: 'registerDataset',
    network: chain.name,
    nextCommand: `${CLI_COMMAND} datasets list --network ${networkId}`,
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
    functionName: 'registerDataset',
    args,
    chain,
    account: walletClient.account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const event = await decodeIndexedEvent({ abi: POLICY_VAULT_ABI, receipt, eventName: 'DatasetRegistered' });
  printTransactionResult(createTransactionResult({
    action: 'Dataset Imported',
    chain,
    contract: 'PolicyVault',
    entityLabel: 'Dataset',
    entityValue: event.args.datasetId,
    explorerUrl: buildExplorerUrl(chain, hash),
    nextCommand: `${CLI_COMMAND} datasets get --dataset-id ${event.args.datasetId}`,
    txHash: hash,
    wallet: walletClient.account.address,
  }));
}
