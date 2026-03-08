import { Buffer } from 'node:buffer';
import { encodeAbiParameters, formatEther, keccak256, parseAbiParameters, toBytes, zeroAddress } from 'viem';
import { ACCESS_RECEIPT_ABI, CLI_COMMAND, IDENTITY_REGISTRY_ABI, PAYMENT_MODULE_ABI, POLICY_VAULT_ABI } from '../constants.mjs';
import { decryptPayload, encryptPayload, sha256Hex } from '../crypto.mjs';
import { requireEnvValue, resolvePreferredEnvValue } from '../env.mjs';
import { CliError } from '../errors.mjs';
import {
  buildAccessReceiptAddress,
  buildBuyerUaid,
  buildExplorerUrl,
  buildPaymentModuleAddress,
  buildPolicyVaultAddress,
  createTransactionResult,
  decodeIndexedEvent,
  getPublicClient,
  getSelectedChain,
  getSelectedNetworkId,
  getWalletClient,
  parseErc8004AgentId,
  printExplorerLink,
  requireIdentityRegistryAddress,
  resolveConditionEvaluatorAddress,
} from '../index-support.mjs';
import { emitResult, printField, printHeading, printStep, printSuccess } from '../output.mjs';
import { readOption } from '../options.mjs';
import { CLI_RUNTIME } from '../runtime.mjs';
import {
  registerBrokerBackedAgent,
  registerBrokerBackedAgentWithOptions,
  resolveBrokerBackedAgentByWallet,
} from '../broker.mjs';

function parseEnvBoolean(value, fallback = false) {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

async function resolveProviderUaid(networkId) {
  const configuredProviderUaid = resolvePreferredEnvValue(
    'PROGRAMMABLE_SECRETS_PROVIDER_UAID',
    ['DEMO_PROVIDER_UAID'],
  ).value;
  if (configuredProviderUaid) {
    return configuredProviderUaid;
  }
  const existingIdentity = await resolveBrokerBackedAgentByWallet({
    networkId,
    requireErc8004: false,
    walletRole: 'provider',
  });
  if (existingIdentity?.uaid) {
    return existingIdentity.uaid;
  }
  const shouldAutoRegister = parseEnvBoolean(
    resolvePreferredEnvValue(
      'PROGRAMMABLE_SECRETS_REGISTER_PROVIDER_AGENT',
      ['DEMO_REGISTER_PROVIDER_AGENT'],
      'true',
    ).value,
    true,
  );
  if (!shouldAutoRegister) {
    throw new CliError(
      'MISSING_PROVIDER_UAID',
      'Provider UAID is required for policy seeding.',
      'Set PROGRAMMABLE_SECRETS_PROVIDER_UAID or enable PROGRAMMABLE_SECRETS_REGISTER_PROVIDER_AGENT=1.',
    );
  }
  const registration = await registerBrokerBackedAgentWithOptions({
    includeErc8004Network: false,
    networkId,
    registerIfMissing: true,
    reuseExisting: false,
    walletRole: 'provider',
  });
  try {
    return registration.brokerUaid;
  } finally {
    await registration.localAgentHandle.stop();
  }
}

async function runUaidPolicyFlow({
  accessReceiptAddress,
  agentId,
  agentWalletClient,
  buyerUaid,
  chain,
  datasetTitle,
  identityRegistryAddress,
  networkId,
  providerWalletClient,
}) {
  const publicClient = getPublicClient(chain);
  const providerUaid = await resolveProviderUaid(networkId);
  const priceWei = BigInt(resolvePreferredEnvValue('PROGRAMMABLE_SECRETS_PRICE_WEI', ['DEMO_PRICE_WEI'], '10000000000000').value);
  const expiresAt = BigInt(Number(resolvePreferredEnvValue('PROGRAMMABLE_SECRETS_EXPIRES_AT_UNIX', ['DEMO_EXPIRES_AT_UNIX'], '').value || '') || Math.floor(Date.now() / 1000) + 24 * 60 * 60);
  const plaintext = JSON.stringify({
    market: 'TSLA',
    strategy: 'volatility-arbitrage',
    signal: 'buy-protective-gamma',
    agentId,
    generatedAt: new Date().toISOString(),
    uaid: buyerUaid,
  }, null, 2);
  const plaintextBuffer = Buffer.from(plaintext, 'utf8');
  const encryptedPayload = encryptPayload(plaintextBuffer);
  const ciphertextHash = keccak256(`0x${encryptedPayload.ciphertext.toString('hex')}`);
  const keyCommitment = keccak256(`0x${encryptedPayload.contentKey.toString('hex')}`);
  const metadataHash = keccak256(toBytes(JSON.stringify({ title: datasetTitle, mimeType: 'application/json', plaintextHash: sha256Hex(plaintextBuffer) })));
  const providerUaidHash = keccak256(toBytes(providerUaid));
  const requiredBuyerUaidHash = keccak256(toBytes(buyerUaid));
  const conditions = [
    {
      evaluator: resolveConditionEvaluatorAddress(networkId, 'timeRangeCondition'),
      configData: encodeAbiParameters(parseAbiParameters('(uint64 notBefore,uint64 notAfter) value'), [{ notBefore: 0n, notAfter: expiresAt }]),
    },
    {
      evaluator: resolveConditionEvaluatorAddress(networkId, 'uaidOwnershipCondition'),
      configData: encodeAbiParameters(
        parseAbiParameters('(bytes32 requiredBuyerUaidHash,address identityRegistry,uint256 agentId) value'),
        [{ requiredBuyerUaidHash, identityRegistry: identityRegistryAddress, agentId: BigInt(agentId) }],
      ),
    },
  ];
  const datasetTx = await providerWalletClient.writeContract({
    address: buildPolicyVaultAddress(networkId),
    abi: POLICY_VAULT_ABI,
    functionName: 'registerDataset',
    args: [ciphertextHash, keyCommitment, metadataHash, providerUaidHash],
    chain,
    account: providerWalletClient.account,
  });
  const datasetReceipt = await publicClient.waitForTransactionReceipt({ hash: datasetTx });
  const datasetEvent = await decodeIndexedEvent({ abi: POLICY_VAULT_ABI, receipt: datasetReceipt, eventName: 'DatasetRegistered' });
  const datasetId = Number(datasetEvent.args.datasetId);
  const createPolicyTx = await providerWalletClient.writeContract({
    address: buildPolicyVaultAddress(networkId),
    abi: POLICY_VAULT_ABI,
    functionName: 'createPolicyForDataset',
    args: [BigInt(datasetId), providerWalletClient.account.address, zeroAddress, priceWei, false, metadataHash, conditions],
    chain,
    account: providerWalletClient.account,
  });
  const createPolicyReceipt = await publicClient.waitForTransactionReceipt({ hash: createPolicyTx });
  const policyEvent = await decodeIndexedEvent({ abi: POLICY_VAULT_ABI, receipt: createPolicyReceipt, eventName: 'PolicyCreated' });
  const policyId = Number(policyEvent.args.policyId);
  const purchaseTx = await agentWalletClient.writeContract({
    address: buildPaymentModuleAddress(networkId),
    abi: PAYMENT_MODULE_ABI,
    functionName: 'purchase',
    args: [BigInt(policyId), agentWalletClient.account.address, ['0x', encodeAbiParameters(parseAbiParameters('string value'), [buyerUaid])]],
    value: priceWei,
    chain,
    account: agentWalletClient.account,
  });
  await publicClient.waitForTransactionReceipt({ hash: purchaseTx });
  const receiptTokenId = await publicClient.readContract({
    address: buildPaymentModuleAddress(networkId),
    abi: PAYMENT_MODULE_ABI,
    functionName: 'receiptOfPolicyAndBuyer',
    args: [BigInt(policyId), agentWalletClient.account.address],
  });
  const hasAccess = await publicClient.readContract({
    address: buildPaymentModuleAddress(networkId),
    abi: PAYMENT_MODULE_ABI,
    functionName: 'hasAccess',
    args: [BigInt(policyId), agentWalletClient.account.address],
  });
  const receipt = await publicClient.readContract({
    address: accessReceiptAddress,
    abi: ACCESS_RECEIPT_ABI,
    functionName: 'getReceipt',
    args: [receiptTokenId],
  });
  return {
    createPolicyTx,
    datasetId,
    datasetTx,
    decryptedPlaintext: decryptPayload({ ciphertext: encryptedPayload.ciphertext, contentKey: encryptedPayload.contentKey, iv: encryptedPayload.iv }).toString('utf8'),
    hasAccess,
    policyId,
    priceWei,
    purchaseTx,
    receipt,
    receiptTokenId,
  };
}

export async function runDirectMarketplaceFlow() {
  const networkId = getSelectedNetworkId();
  const chain = getSelectedChain(networkId);
  const agentWalletClient = getWalletClient({ privateKey: requireEnvValue('ETH_PK', { description: 'agent wallet private key' }).value, chain });
  const providerWalletClient = getWalletClient({ privateKey: requireEnvValue('ETH_PK_2', { description: 'provider wallet private key' }).value, chain });
  const publicClient = getPublicClient(chain);
  const priceWei = BigInt(resolvePreferredEnvValue('PROGRAMMABLE_SECRETS_PRICE_WEI', ['DEMO_PRICE_WEI'], '10000000000000').value);
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 24 * 60 * 60);
  const plaintext = JSON.stringify({ market: 'TSLA', product: 'volatility-surface', strategy: 'volatility-arbitrage', chain: chain.name, generatedAt: new Date().toISOString() }, null, 2);
  const plaintextBuffer = Buffer.from(plaintext, 'utf8');
  const encryptedPayload = encryptPayload(plaintextBuffer);
  const ciphertextHash = keccak256(`0x${encryptedPayload.ciphertext.toString('hex')}`);
  const keyCommitment = keccak256(`0x${encryptedPayload.contentKey.toString('hex')}`);
  const metadataHash = keccak256(toBytes(JSON.stringify({ title: readOption(CLI_RUNTIME.globalOptions, ['dataset-title'], 'TSLA Volatility Model'), mimeType: 'application/json', plaintextHash: sha256Hex(plaintextBuffer) })));
  const providerUaid = await resolveProviderUaid(networkId);
  const providerUaidHash = keccak256(toBytes(providerUaid));
  printHeading('Direct Marketplace Flow');
  printField('Network', chain.name);
  const datasetTx = await providerWalletClient.writeContract({
    address: buildPolicyVaultAddress(networkId),
    abi: POLICY_VAULT_ABI,
    functionName: 'registerDataset',
    args: [ciphertextHash, keyCommitment, metadataHash, providerUaidHash],
    chain,
    account: providerWalletClient.account,
  });
  const datasetReceipt = await publicClient.waitForTransactionReceipt({ hash: datasetTx });
  const datasetEvent = await decodeIndexedEvent({ abi: POLICY_VAULT_ABI, receipt: datasetReceipt, eventName: 'DatasetRegistered' });
  const datasetId = Number(datasetEvent.args.datasetId);
  printStep(1, `Registered dataset #${datasetId}`);
  printField('Dataset tx', datasetTx);
  printExplorerLink(chain, datasetTx);
  const createPolicyTx = await providerWalletClient.writeContract({
    address: buildPolicyVaultAddress(networkId),
    abi: POLICY_VAULT_ABI,
    functionName: 'createPolicyForDataset',
    args: [BigInt(datasetId), providerWalletClient.account.address, zeroAddress, priceWei, false, metadataHash, [{
      evaluator: resolveConditionEvaluatorAddress(networkId, 'timeRangeCondition'),
      configData: encodeAbiParameters(parseAbiParameters('(uint64 notBefore,uint64 notAfter) value'), [{ notBefore: 0n, notAfter: expiresAt }]),
    }]],
    chain,
    account: providerWalletClient.account,
  });
  const createPolicyReceipt = await publicClient.waitForTransactionReceipt({ hash: createPolicyTx });
  const policyEvent = await decodeIndexedEvent({ abi: POLICY_VAULT_ABI, receipt: createPolicyReceipt, eventName: 'PolicyCreated' });
  const policyId = Number(policyEvent.args.policyId);
  printStep(2, `Created policy #${policyId}`);
  printField('Price', `${formatEther(priceWei)} ETH`);
  const purchaseTx = await agentWalletClient.writeContract({
    address: buildPaymentModuleAddress(networkId),
    abi: PAYMENT_MODULE_ABI,
    functionName: 'purchase',
    args: [BigInt(policyId), agentWalletClient.account.address, ['0x']],
    value: priceWei,
    chain,
    account: agentWalletClient.account,
  });
  await publicClient.waitForTransactionReceipt({ hash: purchaseTx });
  const receiptTokenId = await publicClient.readContract({
    address: buildPaymentModuleAddress(networkId),
    abi: PAYMENT_MODULE_ABI,
    functionName: 'receiptOfPolicyAndBuyer',
    args: [BigInt(policyId), agentWalletClient.account.address],
  });
  const receipt = await publicClient.readContract({
    address: buildAccessReceiptAddress(networkId),
    abi: ACCESS_RECEIPT_ABI,
    functionName: 'getReceipt',
    args: [receiptTokenId],
  });
  const decryptedPlaintext = decryptPayload({ ciphertext: encryptedPayload.ciphertext, contentKey: encryptedPayload.contentKey, iv: encryptedPayload.iv }).toString('utf8');
  if (CLI_RUNTIME.json) {
    emitResult('flow-direct', {
      datasetId,
      policyId,
      purchaseTx,
      receipt,
      receiptTokenId,
      decryptedPlaintext,
    });
    return;
  }
  printStep(3, 'Purchased policy and verified local unlock');
  printField('Purchase tx', purchaseTx);
  printField('Receipt token', receiptTokenId);
  console.log(decryptedPlaintext);
  printSuccess('Direct marketplace flow completed.');
}

export async function runDirectUaidFlow() {
  const networkId = getSelectedNetworkId();
  const chain = getSelectedChain(networkId);
  const publicClient = getPublicClient(chain);
  const agentWalletClient = getWalletClient({ privateKey: requireEnvValue('ETH_PK', { description: 'agent wallet private key' }).value, chain });
  const providerWalletClient = getWalletClient({ privateKey: requireEnvValue('ETH_PK_2', { description: 'provider wallet private key' }).value, chain });
  const identityRegistryAddress = requireIdentityRegistryAddress(networkId);
  const registerTx = await agentWalletClient.writeContract({
    address: identityRegistryAddress,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'register',
    args: [resolvePreferredEnvValue('PROGRAMMABLE_SECRETS_AGENT_URI', ['DEMO_AGENT_URI'], 'https://hol.org/agents/volatility-trading-agent-custodian').value],
    chain,
    account: agentWalletClient.account,
  });
  const registerReceipt = await publicClient.waitForTransactionReceipt({ hash: registerTx });
  const registeredEvent = await decodeIndexedEvent({ abi: IDENTITY_REGISTRY_ABI, receipt: registerReceipt, eventName: 'Registered' });
  const agentId = Number(registeredEvent.args.agentId);
  const buyerUaid = buildBuyerUaid({ chainId: chain.id, agentId });
  const result = await runUaidPolicyFlow({
    accessReceiptAddress: buildAccessReceiptAddress(networkId),
    agentId,
    agentWalletClient,
    buyerUaid,
    chain,
    datasetTitle: 'UAID Gated Volatility Dataset',
    identityRegistryAddress,
    networkId,
    providerWalletClient,
  });
  if (CLI_RUNTIME.json) {
    emitResult('flow-uaid', { registerTx, ...result });
    return;
  }
  printHeading('Direct Identity Flow');
  printField('UAID', buyerUaid);
  printField('Receipt token', result.receiptTokenId);
  console.log(result.decryptedPlaintext);
  printSuccess('Direct identity flow completed.');
}

export async function demoBrokerUaidFlow() {
  const networkId = getSelectedNetworkId();
  const chain = getSelectedChain(networkId);
  const agentWalletClient = getWalletClient({ privateKey: requireEnvValue('ETH_PK', { description: 'agent wallet private key' }).value, chain });
  const providerWalletClient = getWalletClient({ privateKey: requireEnvValue('ETH_PK_2', { description: 'provider wallet private key' }).value, chain });
  const accessReceiptAddress = buildAccessReceiptAddress(networkId);
  const identityRegistryAddress = requireIdentityRegistryAddress(networkId);
  const brokerRegistration = await registerBrokerBackedAgent();
  try {
    const result = await runUaidPolicyFlow({
      accessReceiptAddress,
      agentId: brokerRegistration.parsedAgentId,
      agentWalletClient,
      buyerUaid: brokerRegistration.brokerUaid,
      chain,
      datasetTitle: 'Broker-issued UAID Volatility Dataset',
      identityRegistryAddress,
      networkId,
      providerWalletClient,
    });
    if (CLI_RUNTIME.json) {
      emitResult('flow-broker', { ...result, brokerAgentId: brokerRegistration.brokerAgentId, brokerUaid: brokerRegistration.brokerUaid });
      return;
    }
    printHeading('Broker-backed Identity Flow');
    printField('Broker agent', brokerRegistration.brokerAgentId);
    printField('Receipt token', result.receiptTokenId);
    console.log(result.decryptedPlaintext);
    printSuccess('Broker-backed identity flow completed.');
  } finally {
    await brokerRegistration.localAgentHandle.stop();
  }
}
