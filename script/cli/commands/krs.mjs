import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { keccak256, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ACCESS_RECEIPT_ABI, CLI_COMMAND, PAYMENT_MODULE_ABI, POLICY_VAULT_ABI } from '../constants.mjs';
import { CliError } from '../errors.mjs';
import { decryptPayload, encryptPayload, parseHexBuffer, sha256Hex, toHexString } from '../crypto.mjs';
import { normalizePrivateKey, resolveEnvValue, resolvePreferredEnvValue } from '../env.mjs';
import { CLI_RUNTIME } from '../runtime.mjs';
import { emitResult, printSuccess, serializeJson } from '../output.mjs';
import { buildHashFromText, parseBigIntValue, readOption, requireOption, resolveOutputPath } from '../options.mjs';
import {
  buildAccessReceiptAddress,
  buildPaymentModuleAddress,
  buildPolicyVaultAddress,
  getNetworkIdFromOptions,
  getPublicClient,
  getSelectedChain,
  maybeWriteJsonFile,
  readJsonFile,
  serializePolicy,
  serializeReceipt,
} from '../index-support.mjs';
import { buildWalletBackedUaid, normalizeProviderUaid } from '../provider-uaid.mjs';

function resolvePlaintextBuffer(options) {
  const plaintext = readOption(options, ['plaintext'], null);
  if (plaintext !== null) {
    return Buffer.from(plaintext, 'utf8');
  }
  const filePath = readOption(options, ['plaintext-file', 'file'], null);
  if (filePath !== null) {
    return readFileSync(resolve(filePath));
  }
  throw new CliError('MISSING_PLAINTEXT', 'Missing plaintext payload.', `Provide --plaintext or --plaintext-file, or rerun ${CLI_COMMAND} krs encrypt with --interactive.`);
}

function resolveBundleProviderUaid(options) {
  const explicitProviderUaid = normalizeProviderUaid(readOption(options, ['provider-uaid'], ''), {
    fieldName: 'provider UAID',
  });
  if (explicitProviderUaid) {
    return explicitProviderUaid;
  }
  const configuredProviderUaid = resolvePreferredEnvValue(
    'PROGRAMMABLE_SECRETS_PROVIDER_UAID',
    ['DEMO_PROVIDER_UAID'],
    '',
  ).value;
  const normalizedConfiguredProviderUaid = normalizeProviderUaid(configuredProviderUaid, {
    fieldName: 'configured provider UAID',
  });
  if (normalizedConfiguredProviderUaid) {
    return normalizedConfiguredProviderUaid;
  }
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const providerPrivateKey = resolveEnvValue('ETH_PK_2').value;
  if (providerPrivateKey) {
    const account = privateKeyToAccount(normalizePrivateKey(providerPrivateKey, 'ETH_PK_2'));
    return buildWalletBackedUaid({
      chainId: chain.id,
      walletAddress: account.address,
    });
  }
  return buildWalletBackedUaid({ chainId: chain.id });
}

function buildBundlePayload(options) {
  const plaintextBuffer = resolvePlaintextBuffer(options);
  const encryptedPayload = encryptPayload(plaintextBuffer);
  const title = readOption(options, ['title'], 'Programmable Secrets bundle');
  const metadataJson = readOption(options, ['metadata-json'], JSON.stringify({ title }));
  const providerUaid = resolveBundleProviderUaid(options);
  return {
    bundle: {
      contentKeyHex: toHexString(encryptedPayload.contentKey),
      ciphertextHex: toHexString(encryptedPayload.ciphertext),
      ciphertextHash: keccak256(`0x${encryptedPayload.ciphertext.toString('hex')}`),
      ivHex: toHexString(encryptedPayload.iv),
      keyCommitment: keccak256(`0x${encryptedPayload.contentKey.toString('hex')}`),
      metadata: JSON.parse(metadataJson),
      metadataHash: buildHashFromText(metadataJson),
      plaintextHash: sha256Hex(plaintextBuffer),
      plaintextPreview: plaintextBuffer.toString('utf8').slice(0, 140),
      providerUaid,
      providerUaidHash: buildHashFromText(providerUaid),
      title,
      version: 1,
    },
  };
}

export async function encryptBundleCommand(options) {
  const payload = buildBundlePayload(options);
  const outputPath = resolveOutputPath(options);
  if (outputPath) {
    const writtenPath = maybeWriteJsonFile(outputPath, payload, serializeJson);
    if (CLI_RUNTIME.json) {
      emitResult('krs-encrypt', { outputPath: writtenPath, ...payload });
      return;
    }
    printSuccess(`Wrote encrypted bundle to ${writtenPath}`);
    return;
  }
  emitResult('krs-encrypt', payload);
  if (!CLI_RUNTIME.json) {
    console.log(serializeJson(payload));
  }
}

export async function decryptBundleCommand(options) {
  const inputPath = requireOption(options, ['bundle-file', 'file', 'input'], 'bundle file');
  const payload = readJsonFile(inputPath, 'bundle file');
  const bundle = payload.bundle || payload;
  const plaintext = decryptPayload({
    ciphertext: parseHexBuffer(bundle.ciphertextHex, 'ciphertext hex'),
    contentKey: parseHexBuffer(bundle.contentKeyHex, 'content key hex'),
    iv: parseHexBuffer(bundle.ivHex, 'iv hex'),
  });
  const outputPath = resolveOutputPath(options);
  if (outputPath) {
    const resolvedPath = resolve(outputPath);
    writeFileSync(resolvedPath, plaintext);
    if (CLI_RUNTIME.json) {
      emitResult('krs-decrypt', { outputPath: resolvedPath, plaintextBytes: plaintext.length });
      return;
    }
    printSuccess(`Wrote decrypted payload to ${resolvedPath}`);
    return;
  }
  const plaintextText = plaintext.toString('utf8');
  emitResult('krs-decrypt', { plaintext: plaintextText, plaintextBytes: plaintext.length });
  if (!CLI_RUNTIME.json) {
    console.log(plaintextText);
  }
}

export async function verifyBundleCommand(options) {
  const inputPath = requireOption(options, ['bundle-file', 'file', 'input'], 'bundle file');
  const payload = readJsonFile(inputPath, 'bundle file');
  const bundle = payload.bundle || payload;
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const publicClient = getPublicClient(chain);
  const result = {
    access: null,
    bundleCiphertextHash: bundle.ciphertextHash,
    bundleKeyCommitment: bundle.keyCommitment,
    matchesOnChain: null,
    network: chain.name,
  };
  const policyIdValue = readOption(options, ['policy-id'], null);
  if (policyIdValue !== null) {
    const policyId = parseBigIntValue(policyIdValue, 'policy id');
    const policy = await publicClient.readContract({
      address: buildPolicyVaultAddress(networkId),
      abi: POLICY_VAULT_ABI,
      functionName: 'getPolicy',
      args: [policyId],
    });
    result.policy = serializePolicy(policyId, policy);
    result.policy.receiptSemantics = 'purchase-time evaluator checks, then policy-active and dataset-active status for access resolution';
    result.matchesOnChain = policy.ciphertextHash === bundle.ciphertextHash && policy.keyCommitment === bundle.keyCommitment;
    const buyerValue = readOption(options, ['buyer'], null);
    if (buyerValue !== null) {
      const buyer = getAddress(buyerValue);
      result.access = await publicClient.readContract({
        address: buildPaymentModuleAddress(networkId),
        abi: PAYMENT_MODULE_ABI,
        functionName: 'hasAccess',
        args: [policyId, buyer],
      });
      result.buyer = buyer;
    }
  }
  const receiptIdValue = readOption(options, ['receipt-id'], null);
  if (receiptIdValue !== null) {
    const receiptId = parseBigIntValue(receiptIdValue, 'receipt id');
    const receipt = await publicClient.readContract({
      address: buildAccessReceiptAddress(networkId),
      abi: ACCESS_RECEIPT_ABI,
      functionName: 'getReceipt',
      args: [receiptId],
    });
    result.receipt = serializeReceipt(receiptId, receipt);
    result.matchesReceipt = receipt.ciphertextHash === bundle.ciphertextHash && receipt.keyCommitment === bundle.keyCommitment;
  }
  emitResult('krs-verify', result);
  if (!CLI_RUNTIME.json) {
    console.log(serializeJson(result));
  }
}
