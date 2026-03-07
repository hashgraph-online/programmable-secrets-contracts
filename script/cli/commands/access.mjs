import { getAddress, zeroAddress } from 'viem';
import {
  ACCESS_RECEIPT_ABI,
  CLI_COMMAND,
  IDENTITY_REGISTRY_ABI,
  PAYMENT_MODULE_ABI,
  POLICY_VAULT_ABI,
} from '../constants.mjs';
import { CliError } from '../errors.mjs';
import { CLI_RUNTIME } from '../runtime.mjs';
import { emitPreview, emitResult, printField, printHeading, printTransactionResult } from '../output.mjs';
import {
  parseBigIntValue,
  readOption,
  requireOption,
  resolveSelectedWalletRole,
  shouldPreview,
} from '../options.mjs';
import {
  buildAccessReceiptAddress,
  buildExplorerUrl,
  buildIdentityRegistryAddress,
  buildPaymentModuleAddress,
  buildPolicyVaultAddress,
  buildConditionRuntimeInputs,
  createTransactionResult,
  decodeIndexedEvent,
  getNetworkIdFromOptions,
  getPublicClient,
  getSelectedChain,
  getWalletClientForRole,
  printReceiptSummary,
  readPolicyConditions,
  serializeReceipt,
} from '../index-support.mjs';

export async function purchasePolicyCommand(options) {
  const policyId = parseBigIntValue(requireOption(options, 'policy-id', 'policy id'), 'policy-id');
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const walletClient = getWalletClientForRole({ role: resolveSelectedWalletRole(options, 'agent'), chain });
  const publicClient = getPublicClient(chain);
  const policy = await publicClient.readContract({
    address: buildPolicyVaultAddress(networkId),
    abi: POLICY_VAULT_ABI,
    functionName: 'getPolicy',
    args: [policyId],
  });
  const conditions = await readPolicyConditions({ publicClient, networkId, policyId });
  const recipient = readOption(options, ['recipient'], zeroAddress);
  const runtimeInputs = buildConditionRuntimeInputs(conditions, options);
  const preview = {
    action: 'Purchase Policy',
    address: buildPaymentModuleAddress(networkId),
    args: [policyId, recipient === zeroAddress ? zeroAddress : getAddress(recipient), runtimeInputs],
    conditions,
    contract: 'PaymentModule',
    functionName: 'purchase',
    network: chain.name,
    nextCommand: `${CLI_COMMAND} receipts get --receipt-id <receipt-id>`,
    valueWei: policy.price,
    wallet: walletClient.account.address,
  };
  if (shouldPreview(options)) {
    emitPreview(preview);
    return;
  }
  const hash = await walletClient.writeContract({
    address: buildPaymentModuleAddress(networkId),
    abi: PAYMENT_MODULE_ABI,
    functionName: 'purchase',
    args: [policyId, recipient === zeroAddress ? zeroAddress : getAddress(recipient), runtimeInputs],
    value: policy.price,
    chain,
    account: walletClient.account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  const receiptTokenId = await publicClient.readContract({
    address: buildPaymentModuleAddress(networkId),
    abi: PAYMENT_MODULE_ABI,
    functionName: 'receiptOfPolicyAndBuyer',
    args: [policyId, walletClient.account.address],
  });
  printTransactionResult(createTransactionResult({
    action: 'Policy Purchased',
    chain,
    contract: 'PaymentModule',
    entityLabel: 'Receipt',
    entityValue: receiptTokenId,
    explorerUrl: buildExplorerUrl(chain, hash),
    nextCommand: `${CLI_COMMAND} receipts get --receipt-id ${receiptTokenId}`,
    secondaryLabel: 'Policy',
    secondaryValue: policyId,
    txHash: hash,
    valueWei: policy.price,
    wallet: walletClient.account.address,
  }));
}

export async function accessPolicyCommand(options) {
  const policyId = parseBigIntValue(requireOption(options, 'policy-id', 'policy id'), 'policy-id');
  const buyer = getAddress(requireOption(options, 'buyer', 'buyer address'));
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const hasAccess = await getPublicClient(chain).readContract({
    address: buildPaymentModuleAddress(networkId),
    abi: PAYMENT_MODULE_ABI,
    functionName: 'hasAccess',
    args: [policyId, buyer],
  });
  const payload = { buyer, hasAccess, network: chain.name, policyId };
  if (CLI_RUNTIME.json) {
    emitResult('policy-access', payload);
    return;
  }
  printHeading('Policy Access');
  printField('Policy', policyId);
  printField('Buyer', buyer);
  printField('Has access', hasAccess);
}

export async function accessDatasetCommand(options) {
  const datasetId = parseBigIntValue(requireOption(options, 'dataset-id', 'dataset id'), 'dataset-id');
  const buyer = getAddress(requireOption(options, 'buyer', 'buyer address'));
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const hasAccess = await getPublicClient(chain).readContract({
    address: buildPaymentModuleAddress(networkId),
    abi: PAYMENT_MODULE_ABI,
    functionName: 'hasDatasetAccess',
    args: [datasetId, buyer],
  });
  const payload = { buyer, datasetId, hasAccess, network: chain.name };
  if (CLI_RUNTIME.json) {
    emitResult('dataset-access', payload);
    return;
  }
  printHeading('Dataset Access');
  printField('Dataset', datasetId);
  printField('Buyer', buyer);
  printField('Has access', hasAccess);
}

export async function receiptByPolicyCommand(options) {
  const policyId = parseBigIntValue(requireOption(options, 'policy-id', 'policy id'), 'policy-id');
  const buyer = getAddress(requireOption(options, 'buyer', 'buyer address'));
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const receiptTokenId = await getPublicClient(chain).readContract({
    address: buildAccessReceiptAddress(networkId),
    abi: ACCESS_RECEIPT_ABI,
    functionName: 'receiptOfPolicyAndBuyer',
    args: [policyId, buyer],
  });
  const payload = { buyer, network: chain.name, policyId, receiptId: receiptTokenId };
  if (CLI_RUNTIME.json) {
    emitResult('receipt-by-policy', payload);
    return;
  }
  printHeading('Receipt by Policy');
  printField('Policy', policyId);
  printField('Buyer', buyer);
  printField('Receipt', receiptTokenId);
}

export async function receiptByDatasetCommand(options) {
  const datasetId = parseBigIntValue(requireOption(options, 'dataset-id', 'dataset id'), 'dataset-id');
  const buyer = getAddress(requireOption(options, 'buyer', 'buyer address'));
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const receiptTokenId = await getPublicClient(chain).readContract({
    address: buildAccessReceiptAddress(networkId),
    abi: ACCESS_RECEIPT_ABI,
    functionName: 'receiptOfDatasetAndBuyer',
    args: [datasetId, buyer],
  });
  const payload = { buyer, datasetId, network: chain.name, receiptId: receiptTokenId };
  if (CLI_RUNTIME.json) {
    emitResult('receipt-by-dataset', payload);
    return;
  }
  printHeading('Receipt by Dataset');
  printField('Dataset', datasetId);
  printField('Buyer', buyer);
  printField('Receipt', receiptTokenId);
}

export async function getReceiptCommand(options) {
  const receiptId = parseBigIntValue(requireOption(options, ['receipt-id'], 'receipt id'), 'receipt-id');
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const receipt = await getPublicClient(chain).readContract({
    address: buildAccessReceiptAddress(networkId),
    abi: ACCESS_RECEIPT_ABI,
    functionName: 'getReceipt',
    args: [receiptId],
  });
  const payload = { ...serializeReceipt(receiptId, receipt), network: chain.name };
  if (CLI_RUNTIME.json) {
    emitResult('receipt', payload);
    return;
  }
  printHeading(`Receipt ${receiptId} on ${chain.name}`);
  printReceiptSummary(receiptId, receipt);
}

export async function registerIdentityCommand(options) {
  const agentUri = requireOption(options, ['agent-uri'], 'agent URI');
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const identityRegistry = getAddress(readOption(options, ['identity-registry'], buildIdentityRegistryAddress(networkId)));
  if (identityRegistry === zeroAddress) {
    throw new CliError('IDENTITY_REGISTRY_MISSING', `No identity registry configured for ${networkId}.`, 'Provide --identity-registry.');
  }
  const walletClient = getWalletClientForRole({ role: resolveSelectedWalletRole(options, 'agent'), chain });
  const publicClient = getPublicClient(chain);
  const preview = {
    action: 'Register ERC-8004 Identity',
    address: identityRegistry,
    args: [agentUri],
    contract: 'IdentityRegistry',
    functionName: 'register',
    network: chain.name,
    nextCommand: `${CLI_COMMAND} identity register --agent-uri ${agentUri}`,
    valueWei: 0n,
    wallet: walletClient.account.address,
  };
  if (shouldPreview(options)) {
    emitPreview(preview);
    return;
  }
  const hash = await walletClient.writeContract({
    address: identityRegistry,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'register',
    args: [agentUri],
    chain,
    account: walletClient.account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const event = await decodeIndexedEvent({ abi: IDENTITY_REGISTRY_ABI, receipt, eventName: 'Registered' });
  printTransactionResult(createTransactionResult({
    action: 'Identity Registered',
    chain,
    contract: 'IdentityRegistry',
    entityLabel: 'Agent id',
    entityValue: event.args.agentId,
    explorerUrl: buildExplorerUrl(chain, hash),
    nextCommand: `${CLI_COMMAND} policies create-uaid --dataset-id <dataset-id> --agent-id ${event.args.agentId} --required-buyer-uaid <uaid>`,
    secondaryLabel: 'Owner',
    secondaryValue: walletClient.account.address,
    txHash: hash,
    wallet: walletClient.account.address,
  }));
}
