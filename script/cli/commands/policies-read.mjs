import { getAddress, zeroAddress } from 'viem';
import { CliError } from '../errors.mjs';
import { CLI_RUNTIME } from '../runtime.mjs';
import { emitPreview, emitResult, printField, printHeading, printTransactionResult } from '../output.mjs';
import { parseBigIntValue, requireOption, readOption, resolveMetadataHash, resolveSelectedWalletRole, shouldPreview } from '../options.mjs';
import { POLICY_VAULT_ABI } from '../constants.mjs';
import {
  buildPolicyVaultAddress,
  buildExplorerUrl,
  createTransactionResult,
  decodeIndexedEvent,
  getBuiltInEvaluatorCatalog,
  getNetworkIdFromOptions,
  getPublicClient,
  getSelectedChain,
  getWalletClientForRole,
  printPolicyConditions,
  printPolicySummary,
  readPolicyConditions,
  serializeEvaluatorRegistration,
  serializePolicyForDisplay,
} from '../index-support.mjs';

function normalizeAddress(value) {
  return getAddress(value).toLowerCase();
}

export async function listPoliciesCommand(options) {
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const publicClient = getPublicClient(chain);
  const policyVaultAddress = buildPolicyVaultAddress(networkId);
  const datasetIdFilter = readOption(options, ['dataset-id']);
  const policyCount = await publicClient.readContract({
    address: policyVaultAddress,
    abi: POLICY_VAULT_ABI,
    functionName: 'policyCount',
  });
  const items = [];
  printHeading(`Policies on ${chain.name}`);
  printField('Total', policyCount);
  for (let policyId = 1n; policyId <= policyCount; policyId += 1n) {
    const policy = await publicClient.readContract({
      address: policyVaultAddress,
      abi: POLICY_VAULT_ABI,
      functionName: 'getPolicy',
      args: [policyId],
    });
    if (datasetIdFilter && `${policy.datasetId}` !== `${datasetIdFilter}`) {
      continue;
    }
    const conditions = await readPolicyConditions({ publicClient, networkId, policyId });
    items.push({ ...serializePolicyForDisplay(policyId, policy, conditions), network: chain.name });
    if (!CLI_RUNTIME.json) {
      console.log('');
      printPolicySummary(policyId, policy);
      printPolicyConditions(conditions, CLI_RUNTIME);
    }
  }
  if (CLI_RUNTIME.json) {
    emitResult('policies', { count: policyCount, items, network: chain.name });
  }
}

export async function getPolicyCommand(options) {
  const policyId = parseBigIntValue(requireOption(options, 'policy-id', 'policy id'), 'policy-id');
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const publicClient = getPublicClient(chain);
  const policy = await publicClient.readContract({
    address: buildPolicyVaultAddress(networkId),
    abi: POLICY_VAULT_ABI,
    functionName: 'getPolicy',
    args: [policyId],
  });
  const conditions = await readPolicyConditions({ publicClient, networkId, policyId });
  const payload = { ...serializePolicyForDisplay(policyId, policy, conditions), network: chain.name };
  if (CLI_RUNTIME.json) {
    emitResult('policy', payload);
    return;
  }
  printHeading(`Policy ${policyId} on ${chain.name}`);
  printPolicySummary(policyId, policy);
  printPolicyConditions(conditions, CLI_RUNTIME);
}

export async function listEvaluatorsCommand(options) {
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const publicClient = getPublicClient(chain);
  const policyVaultAddress = buildPolicyVaultAddress(networkId);
  const catalog = getBuiltInEvaluatorCatalog(networkId);
  const discoveredAddresses = [];
  let discoveryMode = 'onchain-index';
  try {
    const count = await publicClient.readContract({
      address: policyVaultAddress,
      abi: POLICY_VAULT_ABI,
      functionName: 'getPolicyEvaluatorCount',
    });
    for (let index = 0n; index < count; index += 1n) {
      const evaluator = await publicClient.readContract({
        address: policyVaultAddress,
        abi: POLICY_VAULT_ABI,
        functionName: 'getPolicyEvaluatorAt',
        args: [index],
      });
      discoveredAddresses.push(getAddress(evaluator));
    }
  } catch {
    discoveryMode = 'manifest';
    for (const builtIn of Object.values(catalog)) {
      discoveredAddresses.push(getAddress(builtIn.address));
    }
  }
  const uniqueAddresses = [...new Set(discoveredAddresses.map((entry) => normalizeAddress(entry)))];
  const items = [];
  for (const normalizedAddress of uniqueAddresses) {
    const evaluator = getAddress(normalizedAddress);
    try {
      const registration = await publicClient.readContract({
        address: policyVaultAddress,
        abi: POLICY_VAULT_ABI,
        functionName: 'getPolicyEvaluator',
        args: [evaluator],
      });
      items.push(serializeEvaluatorRegistration(evaluator, registration, catalog[normalizeAddress(evaluator)] || null));
    } catch {
      items.push({
        active: false,
        address: evaluator,
        builtIn: Boolean(catalog[normalizeAddress(evaluator)]),
        builtInKind: catalog[normalizeAddress(evaluator)]?.kind || null,
        metadataHash: `0x${'0'.repeat(64)}`,
        registeredAt: 0n,
        registrant: zeroAddress,
      });
    }
  }
  if (CLI_RUNTIME.json) {
    emitResult('evaluators', { count: BigInt(items.length), discoveryMode, items, network: chain.name });
    return;
  }
  printHeading(`Evaluators on ${chain.name}`);
  printField('Total', items.length);
  printField('Source', discoveryMode);
  for (const item of items) {
    console.log('');
    printField('Evaluator', item.address);
    printField('Built-in', item.builtInKind || item.builtIn);
    printField('Active', item.active);
    printField('Registrant', item.registrant);
    printField('Metadata', item.metadataHash);
  }
}

export async function getEvaluatorCommand(options) {
  const evaluator = getAddress(requireOption(options, ['evaluator', 'address'], 'evaluator address'));
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const publicClient = getPublicClient(chain);
  const registration = await publicClient.readContract({
    address: buildPolicyVaultAddress(networkId),
    abi: POLICY_VAULT_ABI,
    functionName: 'getPolicyEvaluator',
    args: [evaluator],
  });
  const payload = {
    ...serializeEvaluatorRegistration(evaluator, registration, getBuiltInEvaluatorCatalog(networkId)[normalizeAddress(evaluator)] || null),
    network: chain.name,
  };
  if (CLI_RUNTIME.json) {
    emitResult('evaluator', payload);
    return;
  }
  printHeading(`Evaluator on ${chain.name}`);
  printField('Evaluator', payload.address);
  printField('Built-in', payload.builtInKind || payload.builtIn);
  printField('Active', payload.active);
  printField('Registrant', payload.registrant);
  printField('Metadata', payload.metadataHash);
}

export async function registerEvaluatorCommand(options) {
  const evaluator = getAddress(requireOption(options, ['evaluator', 'address'], 'evaluator address'));
  const metadataHash = resolveMetadataHash(options);
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const publicClient = getPublicClient(chain);
  const walletClient = getWalletClientForRole({ role: resolveSelectedWalletRole(options, 'provider'), chain });
  const policyVaultAddress = buildPolicyVaultAddress(networkId);
  const registrationFee = await publicClient.readContract({
    address: policyVaultAddress,
    abi: POLICY_VAULT_ABI,
    functionName: 'evaluatorRegistrationFee',
  });
  const preview = {
    action: 'Register Policy Evaluator',
    address: policyVaultAddress,
    args: [evaluator, metadataHash],
    contract: 'PolicyVault',
    functionName: 'registerPolicyEvaluator',
    network: chain.name,
    nextCommand: `programmable-secret evaluators get --evaluator ${evaluator}`,
    valueWei: registrationFee,
    wallet: walletClient.account.address,
  };
  if (shouldPreview(options)) {
    emitPreview(preview);
    return;
  }
  const hash = await walletClient.writeContract({
    account: walletClient.account,
    address: policyVaultAddress,
    abi: POLICY_VAULT_ABI,
    args: [evaluator, metadataHash],
    chain,
    functionName: 'registerPolicyEvaluator',
    value: registrationFee,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  let registeredEvaluator = evaluator;
  let registrant = walletClient.account.address;
  try {
    const event = await decodeIndexedEvent({
      abi: POLICY_VAULT_ABI,
      eventName: 'PolicyEvaluatorRegistered',
      receipt,
    });
    registeredEvaluator = event.args.evaluator;
    registrant = event.args.registrant;
  } catch (error) {
    if (!(error instanceof CliError) || error.code !== 'EVENT_NOT_FOUND') {
      throw error;
    }
    const registration = await publicClient.readContract({
      address: policyVaultAddress,
      abi: POLICY_VAULT_ABI,
      functionName: 'getPolicyEvaluator',
      args: [evaluator],
    });
    if (!registration.active) {
      throw error;
    }
    registrant = registration.registrant;
  }
  printTransactionResult(
    createTransactionResult({
      action: 'Evaluator Registered',
      chain,
      contract: 'PolicyVault',
      entityLabel: 'Evaluator',
      entityValue: registeredEvaluator,
      explorerUrl: buildExplorerUrl(chain, hash),
      nextCommand: `programmable-secret evaluators get --evaluator ${registeredEvaluator}`,
      secondaryLabel: 'Registrant',
      secondaryValue: registrant,
      txHash: hash,
      valueWei: registrationFee,
      wallet: walletClient.account.address,
    }),
  );
}
