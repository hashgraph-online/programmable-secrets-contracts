#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatEther,
  getAddress,
  http,
  keccak256,
  parseAbi,
  toBytes,
  zeroAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(SCRIPT_DIR, '..');
const DEPLOYMENT_FILES = {
  'robinhood-testnet': resolve(PACKAGE_ROOT, 'deployments/robinhood-testnet.json'),
  'arbitrum-sepolia': resolve(PACKAGE_ROOT, 'deployments/arbitrum-sepolia.json'),
};

const ENV_PATH_CANDIDATES = [
  process.env.PROGRAMMABLE_SECRETS_ENV_PATH?.trim() || null,
  resolve(PACKAGE_ROOT, '.env.local'),
  resolve(PACKAGE_ROOT, '.env'),
].filter(Boolean);

const DEFAULT_REGISTRY_BROKER_BASE_URL = 'http://127.0.0.1:4000/api/v1';
const DEFAULT_REGISTRY_BROKER_API_KEY = 'local-dev-api-key-change-me';
const DEFAULT_NETWORK_ID = 'robinhood-testnet';
const DEFAULT_REGISTRY_NAMESPACE = 'hashgraph-online';
const DEFAULT_COMMUNICATION_PROTOCOL = 'a2a';
const CLI_COMMAND = 'programmable-secret';
const CLI_ALIAS = 'programmable-secrets';
const CLI_CONFIG_DIR = resolve(homedir(), '.config', CLI_COMMAND);
const CLI_CONFIG_PATH = resolve(CLI_CONFIG_DIR, 'config.json');
const DEFAULT_ENV_OUTPUT_PATH = resolve(
  process.env.PROGRAMMABLE_SECRETS_ENV_OUTPUT_PATH?.trim() || resolve(PACKAGE_ROOT, '.env.local'),
);
const DEFAULT_DOCKER_CONTAINERS = ['registry-broker-registry-broker-1'];
const RUNTIME_ENV_CACHE = new Map();
const CLI_RUNTIME = {
  agentSafe: false,
  command: null,
  globalOptions: {},
  interactive: false,
  json: false,
  noColor: false,
  profile: null,
  profileName: null,
  quiet: false,
  yes: false,
};
const DOCKER_ENV_ALIASES = {
  REGISTRY_BROKER_API_KEY: ['API_KEYS'],
  REGISTRY_BROKER_ACCOUNT_ID: ['ETH_ACCOUNT_ID'],
};
const TEMPLATE_REGISTRY = {
  'finance-timebound-dataset': {
    description: 'Dataset registration metadata plus a 24-hour finance policy scaffold.',
    kind: 'dataset-policy-template',
    payload: {
      dataset: {
        providerUaid: 'did:uaid:hol:quantlab?uid=quantlab&registry=hol&proto=hol&nativeId=quantlab',
        metadata: {
          title: 'TSLA volatility surface',
          category: 'premium-market-data',
          mimeType: 'application/json',
        },
      },
      policy: {
        type: 'timebound',
        priceWei: '10000000000000',
        durationHours: 24,
        payout: 'provider-wallet',
      },
    },
  },
  'finance-uaid-policy': {
    description: 'UAID-gated entitlement template for an ERC-8004-backed finance agent.',
    kind: 'policy-template',
    payload: {
      policy: {
        type: 'uaid-erc8004',
        datasetId: 1,
        priceWei: '10000000000000',
        durationHours: 24,
        requiredBuyerUaid: 'uaid:aid:...',
        agentId: 97,
      },
    },
  },
  'krs-local-bundle': {
    description: 'Local-only encrypted payload bundle shape for CLI KRS verification and decryption.',
    kind: 'krs-template',
    payload: {
      bundle: {
        version: 1,
        title: 'TSLA volatility bundle',
        plaintext: 'Put your premium signal JSON here',
      },
    },
  },
};
const COMMAND_TREE = {
  access: ['dataset', 'policy', 'receipt-dataset', 'receipt-policy'],
  contracts: [],
  datasets: ['export', 'get', 'import', 'list', 'register', 'set-active'],
  doctor: [],
  'env-bootstrap': [],
  'flow:broker': [],
  'flow:direct': [],
  help: [],
  identity: ['register'],
  init: [],
  krs: ['decrypt', 'encrypt', 'verify'],
  preview: [],
  profiles: ['init', 'list', 'show'],
  policies: ['allowlist', 'create-uaid', 'create-timebound', 'export', 'get', 'import', 'list', 'update'],
  purchase: [],
  receipts: ['get'],
  start: [],
  templates: ['list', 'show', 'write'],
  completions: ['bash', 'fish', 'zsh'],
};

class CliError extends Error {
  constructor(code, message, remediation = null, details = null) {
    super(message);
    this.code = code;
    this.remediation = remediation;
    this.details = details;
  }
}

const robinhoodTestnet = {
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com/rpc'] } },
  explorerBaseUrl: 'https://explorer.testnet.chain.robinhood.com',
};

const arbitrumSepolia = {
  id: 421614,
  name: 'Arbitrum Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://sepolia-rollup.arbitrum.io/rpc'] } },
  explorerBaseUrl: 'https://sepolia.arbiscan.io',
};

const SUPPORTED_NETWORKS = {
  'arbitrum-sepolia': arbitrumSepolia,
  'robinhood-testnet': robinhoodTestnet,
};
const NETWORK_ALIASES = {
  arbitrum: 'arbitrum-sepolia',
  'erc-8004:arbitrum-sepolia': 'arbitrum-sepolia',
  robinhood: 'robinhood-testnet',
  testnet: 'robinhood-testnet',
  'erc-8004:robinhood-testnet': 'robinhood-testnet',
  'erc-8004:testnet': 'robinhood-testnet',
};

const POLICY_VAULT_ABI = parseAbi([
  'function registerDataset(bytes32 ciphertextHash,bytes32 keyCommitment,bytes32 metadataHash,bytes32 providerUaidHash) returns (uint256 datasetId)',
  'function setDatasetActive(uint256 datasetId,bool active)',
  'function datasetCount() view returns (uint256)',
  'function policyCount() view returns (uint256)',
  'function getPolicy(uint256 policyId) view returns ((address provider,address payout,address paymentToken,uint96 price,uint64 createdAt,uint64 expiresAt,bool active,bool allowlistEnabled,bytes32 ciphertextHash,bytes32 keyCommitment,bytes32 metadataHash,bytes32 providerUaidHash,uint256 datasetId,bytes32 policyType,bytes32 requiredBuyerUaidHash,address identityRegistry,uint256 agentId))',
  'function getDataset(uint256 datasetId) view returns ((address provider,uint64 createdAt,bool active,bytes32 ciphertextHash,bytes32 keyCommitment,bytes32 metadataHash,bytes32 providerUaidHash))',
  'function getDatasetPolicyCount(uint256 datasetId) view returns (uint256)',
  'function getDatasetPolicyIdAt(uint256 datasetId,uint256 index) view returns (uint256)',
  'function getDatasetPolicyIds(uint256 datasetId) view returns (uint256[])',
  'function createTimeboundPolicy(uint256 datasetId,address payout,address paymentToken,uint96 price,uint64 expiresAt,bool allowlistEnabled,bytes32 metadataHash,address[] allowlistAccounts) returns (uint256 policyId)',
  'function createUaidBoundPolicy(uint256 datasetId,address payout,address paymentToken,uint96 price,uint64 expiresAt,bool allowlistEnabled,bytes32 metadataHash,bytes32 requiredBuyerUaidHash,address identityRegistry,uint256 agentId,address[] allowlistAccounts) returns (uint256 policyId)',
  'function createPolicyForDataset(uint256 datasetId,bytes32 policyType,address payout,address paymentToken,uint96 price,uint64 expiresAt,bool allowlistEnabled,bytes32 metadataHash,address[] allowlistAccounts) returns (uint256 policyId)',
  'function updatePolicy(uint256 policyId,uint96 newPrice,uint64 newExpiresAt,bool active,bool allowlistEnabled,bytes32 newMetadataHash)',
  'function setAllowlist(uint256 policyId,address[] accounts,bool allowed)',
  'function isAllowlisted(uint256 policyId,address account) view returns (bool)',
  'function isSupportedPolicyType(bytes32 policyType) view returns (bool)',
  'event DatasetRegistered(uint256 indexed datasetId,address indexed provider,bytes32 ciphertextHash,bytes32 keyCommitment,bytes32 metadataHash,bytes32 providerUaidHash)',
  'event DatasetStatusUpdated(uint256 indexed datasetId,bool active)',
  'event PolicyCreated(uint256 indexed policyId,uint256 indexed datasetId,address indexed provider,address payout,address paymentToken,bytes32 policyType,uint256 price,uint64 expiresAt,bool allowlistEnabled,bytes32 metadataHash,bytes32 datasetMetadataHash)',
  'event PolicyUpdated(uint256 indexed policyId,uint256 indexed datasetId,uint256 price,uint64 expiresAt,bool active,bool allowlistEnabled,bytes32 metadataHash)',
  'event AllowlistUpdated(uint256 indexed policyId,address indexed account,bool allowed)',
]);

const PAYMENT_MODULE_ABI = parseAbi([
  'function purchase(uint256 policyId,address recipient,string buyerUaid) payable returns (uint256 receiptTokenId)',
  'function hasAccess(uint256 policyId,address buyer) view returns (bool)',
  'function hasDatasetAccess(uint256 datasetId,address buyer) view returns (bool)',
  'function receiptOfPolicyAndBuyer(uint256 policyId,address buyer) view returns (uint256)',
]);

const ACCESS_RECEIPT_ABI = parseAbi([
  'function hasAccess(uint256 policyId,address buyer) view returns (bool)',
  'function receiptOfPolicyAndBuyer(uint256 policyId,address buyer) view returns (uint256)',
  'function receiptOfDatasetAndBuyer(uint256 datasetId,address buyer) view returns (uint256)',
  'function getReceipt(uint256 receiptTokenId) view returns ((uint256 policyId,uint256 datasetId,address buyer,address recipient,address paymentToken,uint96 price,uint64 purchasedAt,bytes32 ciphertextHash,bytes32 keyCommitment))',
]);

const IDENTITY_REGISTRY_ABI = parseAbi([
  'function register(string agentURI) returns (uint256 agentId)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'event Registered(uint256 indexed agentId,string agentURI,address indexed owner)',
]);

function loadEnvironment() {
  for (const path of ENV_PATH_CANDIDATES) {
    if (!existsSync(path)) {
      continue;
    }
    loadDotenv({
      path,
      override: false,
    });
  }
}

loadEnvironment();

function loadDeployment(network) {
  const path = DEPLOYMENT_FILES[network];
  if (!path) {
    throw new CliError(
      'UNSUPPORTED_NETWORK',
      `Unsupported deployment network: ${network}`,
      `Use one of: ${Object.keys(DEPLOYMENT_FILES).join(', ')}.`,
    );
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function jsonReplacer(_key, value) {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return `0x${Buffer.from(value).toString('hex')}`;
  }
  return value;
}

function serializeJson(value) {
  return JSON.stringify(value, jsonReplacer, 2);
}

function ensureConfigDir() {
  mkdirSync(CLI_CONFIG_DIR, {
    recursive: true,
  });
}

function getDefaultConfig() {
  return {
    defaultProfile: 'robinhood-agent',
    profiles: {
      'arbitrum-agent': {
        interactive: false,
        network: 'arbitrum-sepolia',
        wallet: 'agent',
      },
      provider: {
        interactive: false,
        network: 'robinhood-testnet',
        payout: 'provider-wallet',
        wallet: 'provider',
      },
      'robinhood-agent': {
        interactive: false,
        network: 'robinhood-testnet',
        wallet: 'agent',
      },
    },
  };
}

function loadCliConfig() {
  if (!existsSync(CLI_CONFIG_PATH)) {
    return getDefaultConfig();
  }
  try {
    const parsed = JSON.parse(readFileSync(CLI_CONFIG_PATH, 'utf8'));
    return {
      ...getDefaultConfig(),
      ...parsed,
      profiles: {
        ...getDefaultConfig().profiles,
        ...(parsed.profiles || {}),
      },
    };
  } catch (error) {
    throw new CliError(
      'CONFIG_INVALID',
      `Unable to parse ${CLI_CONFIG_PATH}.`,
      `Fix the JSON syntax in ${CLI_CONFIG_PATH} or rerun ${CLI_COMMAND} init --force.`,
      error instanceof Error ? error.message : `${error}`,
    );
  }
}

function writeCliConfig(config, outputPath = CLI_CONFIG_PATH, overwrite = false) {
  if (existsSync(outputPath) && !overwrite) {
    throw new CliError(
      'CONFIG_EXISTS',
      `${outputPath} already exists.`,
      `Pass --force or remove the file before rerunning ${CLI_COMMAND} init.`,
    );
  }
  ensureConfigDir();
  writeFileSync(outputPath, `${serializeJson(config)}\n`);
}

function getProfileOptions() {
  return CLI_RUNTIME.profile?.options || CLI_RUNTIME.profile?.settings || CLI_RUNTIME.profile || {};
}

function initializeRuntime(globalOptions, commandName) {
  const config = loadCliConfig();
  const profileName = readOption(globalOptions, ['profile'], config.defaultProfile || null);
  const profile = profileName ? config.profiles?.[profileName] || null : null;
  CLI_RUNTIME.command = commandName;
  CLI_RUNTIME.globalOptions = globalOptions;
  CLI_RUNTIME.profileName = profileName || null;
  CLI_RUNTIME.profile = profile;
  CLI_RUNTIME.agentSafe = parseBooleanOption(readOption(globalOptions, ['agent-safe'], false), false);
  CLI_RUNTIME.json = CLI_RUNTIME.agentSafe || parseBooleanOption(readOption(globalOptions, ['json'], false), false);
  CLI_RUNTIME.quiet = CLI_RUNTIME.agentSafe || parseBooleanOption(readOption(globalOptions, ['quiet'], false), false);
  CLI_RUNTIME.noColor = CLI_RUNTIME.agentSafe || parseBooleanOption(readOption(globalOptions, ['no-color'], false), false);
  CLI_RUNTIME.yes = CLI_RUNTIME.agentSafe || parseBooleanOption(readOption(globalOptions, ['yes'], false), false);
  CLI_RUNTIME.interactive = CLI_RUNTIME.agentSafe
    ? false
    : parseBooleanOption(readOption(globalOptions, ['interactive'], false), false) && Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function emitJson(payload) {
  console.log(serializeJson(payload));
}

function emitResult(kind, payload) {
  if (CLI_RUNTIME.json) {
    emitJson({
      kind,
      payload,
      profile: CLI_RUNTIME.profileName,
      timestamp: new Date().toISOString(),
    });
  }
}

function createReadResult(kind, payload, extra = {}) {
  return {
    ...extra,
    kind,
    network: payload.network || null,
    profile: CLI_RUNTIME.profileName,
    result: payload,
  };
}

function createTransactionResult({
  action,
  chain,
  contract,
  explorerUrl,
  nextCommand = null,
  txHash,
  valueWei = 0n,
  wallet,
  ...rest
}) {
  return {
    action,
    chainId: chain.id,
    contract,
    explorerUrl,
    network: chain.name,
    nextCommand,
    txHash,
    valueWei,
    wallet,
    ...rest,
  };
}

function printTransactionResult(result) {
  if (CLI_RUNTIME.json) {
    emitResult('transaction', result);
    return;
  }
  printHeading(result.action);
  printField('Network', result.network);
  printField('Contract', result.contract);
  printField('Wallet', result.wallet);
  if (result.entityLabel && result.entityValue !== undefined) {
    printField(result.entityLabel, result.entityValue);
  }
  if (result.secondaryLabel && result.secondaryValue !== undefined) {
    printField(result.secondaryLabel, result.secondaryValue);
  }
  if (result.valueWei !== undefined) {
    printField('Value', `${formatEther(BigInt(result.valueWei))} ETH (${result.valueWei} wei)`);
  }
  printField('Tx', result.txHash);
  if (result.explorerUrl) {
    printField('Explorer', result.explorerUrl);
  }
  if (result.nextCommand) {
    printField('Next', result.nextCommand);
  }
}

function buildExplorerUrl(chain, hash, kind = 'tx') {
  if (!chain?.explorerBaseUrl || !hash) {
    return null;
  }
  return `${chain.explorerBaseUrl}/${kind}/${hash}`;
}

function emitPreview(preview) {
  if (CLI_RUNTIME.json) {
    emitResult('preview', preview);
    return true;
  }
  printHeading(`Preview: ${preview.action}`);
  printField('Network', preview.network);
  printField('Contract', preview.contract);
  printField('Address', preview.address);
  printField('Wallet', preview.wallet);
  printField('Function', preview.functionName);
  if (preview.valueWei !== undefined) {
    printField('Value', `${formatEther(BigInt(preview.valueWei))} ETH (${preview.valueWei} wei)`);
  }
  printInfo(`Args: ${serializeJson(preview.args)}`);
  if (preview.nextCommand) {
    printField('Next', preview.nextCommand);
  }
  return true;
}

function shouldPreview(options) {
  return parseBooleanOption(readOption(options, ['preview', 'explain'], false), false);
}

async function promptValue(question, fallback = '') {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const promptSuffix = fallback ? ` [${fallback}]` : '';
    const answer = (await rl.question(`${question}${promptSuffix}: `)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

async function maybePromptOption(options, names, question, fallback = null) {
  const existing = readOption(options, names, null);
  if (existing !== null) {
    return existing;
  }
  if (!CLI_RUNTIME.interactive) {
    return fallback;
  }
  const answer = await promptValue(question, fallback ?? '');
  if (answer) {
    options[Array.isArray(names) ? names[0] : names] = answer;
    return answer;
  }
  return fallback;
}

function printHeading(title) {
  if (CLI_RUNTIME.json || CLI_RUNTIME.quiet) {
    return;
  }
  console.log(`\n=== ${title} ===`);
}

function printField(label, value) {
  if (CLI_RUNTIME.json || CLI_RUNTIME.quiet) {
    return;
  }
  console.log(`${label.padEnd(16)} ${value}`);
}

function printExplorerLink(chain, hash) {
  if (!chain?.explorerBaseUrl) {
    return;
  }
  printField('Explorer', `${chain.explorerBaseUrl}/tx/${hash}`);
}

function printStep(stepNumber, title) {
  if (CLI_RUNTIME.json || CLI_RUNTIME.quiet) {
    return;
  }
  console.log(`\n[${stepNumber}] ${title}`);
}

function printSuccess(message) {
  if (CLI_RUNTIME.json || CLI_RUNTIME.quiet) {
    return;
  }
  console.log(`\n[ok] ${message}`);
}

function printWarning(message) {
  if (CLI_RUNTIME.json || CLI_RUNTIME.quiet) {
    return;
  }
  console.log(`\n[warn] ${message}`);
}

function printInfo(message) {
  if (CLI_RUNTIME.json || CLI_RUNTIME.quiet) {
    return;
  }
  console.log(`\n[i] ${message}`);
}

function printCommandUsage(lines) {
  for (const line of lines) {
    console.log(line);
  }
}

function parseCliArgs(tokens) {
  const positionals = [];
  const options = {};

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split('=');
    const key = rawKey.trim();
    if (!key) {
      continue;
    }
    if (inlineValue !== undefined) {
      options[key] = inlineValue;
      continue;
    }

    const nextToken = tokens[index + 1];
    if (!nextToken || nextToken.startsWith('--')) {
      options[key] = true;
      continue;
    }

    options[key] = nextToken;
    index += 1;
  }

  return { positionals, options };
}

function readOption(options, names, fallback = null) {
  const optionNames = Array.isArray(names) ? names : [names];
  for (const name of optionNames) {
    const value = options[name];
    if (value !== undefined && value !== null && `${value}`.trim() !== '') {
      return `${value}`.trim();
    }
  }
  const profileOptions = getProfileOptions();
  for (const name of optionNames) {
    const value = profileOptions[name];
    if (value !== undefined && value !== null && `${value}`.trim() !== '') {
      return `${value}`.trim();
    }
  }
  return fallback;
}

function requireOption(options, names, description) {
  const value = readOption(options, names);
  if (value !== null) {
    return value;
  }
  const label = Array.isArray(names) ? names.join(' or ') : names;
  throw new CliError(
    'MISSING_OPTION',
    `Missing ${description}.`,
    `Provide --${label} or rerun with --interactive.`,
    {
      description,
      option: label,
    },
  );
}

function parseBooleanOption(value, fallback = false) {
  if (value === null || value === undefined) {
    return fallback;
  }
  const normalized = `${value}`.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }
  throw new CliError(
    'INVALID_BOOLEAN',
    `Invalid boolean value "${value}".`,
    'Expected true or false.',
  );
}

function parseBigIntValue(value, description) {
  try {
    return BigInt(value);
  } catch {
    throw new CliError('INVALID_NUMBER', `Invalid ${description}: "${value}"`);
  }
}

function parseUintValue(value, description) {
  const parsed = Number.parseInt(`${value}`.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new CliError('INVALID_NUMBER', `Invalid ${description}: "${value}"`);
  }
  return parsed;
}

function parseAddressList(value) {
  if (!value) {
    return [];
  }
  return `${value}`
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => getAddress(entry));
}

function normalizeHash(value, description) {
  const trimmed = `${value}`.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed;
  }
  throw new CliError(
    'INVALID_HASH',
    `Invalid ${description}.`,
    'Expected a 32-byte hex string.',
  );
}

function buildHashFromText(value) {
  return keccak256(toBytes(value));
}

function resolveHashOption(options, config) {
  const directHash = readOption(options, config.hashOptionNames ?? [config.hashOption]);
  if (directHash) {
    return normalizeHash(directHash, config.description);
  }

  const directValue = readOption(options, config.valueOptionNames ?? [config.valueOption]);
  if (directValue) {
    return buildHashFromText(directValue);
  }

  const filePath = readOption(options, config.fileOptionNames ?? [config.fileOption]);
  if (filePath) {
    return keccak256(`0x${readFileSync(resolve(filePath)).toString('hex')}`);
  }

  const jsonValue = readOption(options, config.jsonOptionNames ?? [config.jsonOption]);
  if (jsonValue) {
    return buildHashFromText(jsonValue);
  }

  if (config.fallback !== undefined) {
    return config.fallback;
  }

  throw new CliError(
    'MISSING_HASH_SOURCE',
    `Missing ${config.description}.`,
    `Provide ${config.example}.`,
  );
}

function resolveMetadataHash(options) {
  return resolveHashOption(options, {
    description: 'metadata hash',
    hashOptionNames: ['metadata-hash'],
    valueOptionNames: ['metadata'],
    fileOptionNames: ['metadata-file'],
    jsonOptionNames: ['metadata-json'],
    example: '--metadata-hash 0x... or --metadata-json \'{"title":"TSLA"}\'',
  });
}

function resolveDatasetRegistrationHashes(options) {
  return {
    ciphertextHash: resolveHashOption(options, {
      description: 'ciphertext hash',
      hashOptionNames: ['ciphertext-hash'],
      valueOptionNames: ['ciphertext'],
      fileOptionNames: ['ciphertext-file'],
      example: '--ciphertext-hash 0x... or --ciphertext "encrypted payload"',
    }),
    keyCommitment: resolveHashOption(options, {
      description: 'key commitment',
      hashOptionNames: ['key-commitment'],
      valueOptionNames: ['key-material'],
      fileOptionNames: ['key-file'],
      example: '--key-commitment 0x... or --key-material "buyer-bound envelope key"',
    }),
    metadataHash: resolveMetadataHash(options),
    providerUaidHash: resolveHashOption(options, {
      description: 'provider UAID hash',
      hashOptionNames: ['provider-uaid-hash'],
      valueOptionNames: ['provider-uaid'],
      example: '--provider-uaid-hash 0x... or --provider-uaid did:uaid:...',
    }),
  };
}

function resolvePriceWei(options) {
  const priceWei = readOption(options, ['price-wei']);
  if (priceWei) {
    return parseBigIntValue(priceWei, 'price-wei');
  }
  const priceEth = readOption(options, ['price-eth']);
  if (priceEth) {
    const normalized = `${priceEth}`.trim();
    if (!/^\d+(\.\d+)?$/.test(normalized)) {
      throw new CliError('INVALID_PRICE', `Invalid price-eth: "${priceEth}"`);
    }
    const [whole, fractional = ''] = normalized.split('.');
    const paddedFractional = `${fractional}000000000000000000`.slice(0, 18);
    return parseBigIntValue(`${whole}${paddedFractional}`, 'price-eth');
  }
  return parseBigIntValue(
    resolvePreferredEnvValue(
      'PROGRAMMABLE_SECRETS_PRICE_WEI',
      ['DEMO_PRICE_WEI'],
      '10000000000000',
    ).value,
    'price',
  );
}

function resolveExpiryUnix(options) {
  const explicitUnix = readOption(options, ['expires-at-unix']);
  if (explicitUnix) {
    return BigInt(parseUintValue(explicitUnix, 'expires-at-unix'));
  }

  const explicitIso = readOption(options, ['expires-at-iso']);
  if (explicitIso) {
    const parsed = Date.parse(explicitIso);
    if (!Number.isFinite(parsed)) {
      throw new CliError('INVALID_DATE', `Invalid expires-at-iso: "${explicitIso}"`);
    }
    return BigInt(Math.floor(parsed / 1000));
  }

  const durationHours = readOption(options, ['duration-hours']);
  if (durationHours) {
    const parsed = parseUintValue(durationHours, 'duration-hours');
    return BigInt(Math.floor(Date.now() / 1000) + parsed * 60 * 60);
  }

  const envValue = resolvePreferredEnvValue(
    'PROGRAMMABLE_SECRETS_EXPIRES_AT_UNIX',
    ['DEMO_EXPIRES_AT_UNIX'],
    '',
  ).value;
  if (envValue) {
    return BigInt(parseUintValue(envValue, 'PROGRAMMABLE_SECRETS_EXPIRES_AT_UNIX'));
  }

  return BigInt(Math.floor(Date.now() / 1000) + 24 * 60 * 60);
}

function resolveSelectedWalletRole(options, fallback) {
  const role = readOption(options, ['wallet', 'actor'], fallback);
  if (!['agent', 'provider'].includes(role)) {
    throw new CliError(
      'INVALID_WALLET_ROLE',
      `Invalid wallet role "${role}".`,
      'Expected agent or provider.',
    );
  }
  return role;
}

function resolvePreferredEnvValue(primaryName, legacyNames = [], fallback = null) {
  const names = [primaryName, ...legacyNames];
  for (const name of names) {
    const resolved = resolveEnvValue(name, null);
    if (resolved.value) {
      return resolved;
    }
  }
  if (fallback !== null && fallback !== undefined) {
    return { value: fallback, source: 'default' };
  }
  return { value: null, source: 'missing' };
}

function resolveOutputPath(options, fallback = null) {
  return readOption(options, ['output', 'output-file'], fallback);
}

async function completeInteractiveOptions(commandName, subcommand, options) {
  if (!CLI_RUNTIME.interactive) {
    return options;
  }

  if (commandName === 'datasets' && subcommand === 'register') {
    await maybePromptOption(options, ['provider-uaid'], 'Provider UAID');
    await maybePromptOption(options, ['metadata-json'], 'Dataset metadata JSON', '{"title":"TSLA volatility dataset"}');
    await maybePromptOption(options, ['ciphertext'], 'Ciphertext placeholder');
    await maybePromptOption(options, ['key-material'], 'Key material placeholder');
  }

  if (commandName === 'policies' && subcommand === 'create-timebound') {
    await maybePromptOption(options, ['dataset-id'], 'Dataset id');
    await maybePromptOption(options, ['price-eth'], 'Price in ETH', '0.00001');
    await maybePromptOption(options, ['duration-hours'], 'Access duration in hours', '24');
    await maybePromptOption(options, ['metadata-json'], 'Policy metadata JSON', '{"title":"24 hour access"}');
  }

  if (commandName === 'policies' && subcommand === 'create-uaid') {
    await maybePromptOption(options, ['dataset-id'], 'Dataset id');
    await maybePromptOption(options, ['price-eth'], 'Price in ETH', '0.00001');
    await maybePromptOption(options, ['duration-hours'], 'Access duration in hours', '24');
    await maybePromptOption(options, ['required-buyer-uaid'], 'Required buyer UAID');
    await maybePromptOption(options, ['agent-id'], 'ERC-8004 agent id');
    await maybePromptOption(options, ['metadata-json'], 'Policy metadata JSON', '{"title":"UAID-gated access"}');
  }

  if (commandName === 'policies' && subcommand === 'update') {
    await maybePromptOption(options, ['policy-id'], 'Policy id');
  }

  if (commandName === 'policies' && subcommand === 'allowlist') {
    await maybePromptOption(options, ['policy-id'], 'Policy id');
    await maybePromptOption(options, ['accounts'], 'Comma-separated wallet addresses');
    await maybePromptOption(options, ['allowed'], 'Allowlist state', 'true');
  }

  if (commandName === 'purchase') {
    await maybePromptOption(options, ['policy-id'], 'Policy id');
  }

  if (commandName === 'identity' && subcommand === 'register') {
    await maybePromptOption(options, ['agent-uri'], 'Agent URI', 'https://hol.org/agents/volatility-trading-agent-custodian');
  }

  if (commandName === 'krs' && subcommand === 'encrypt') {
    await maybePromptOption(options, ['plaintext'], 'Plaintext payload');
    await maybePromptOption(options, ['title'], 'Bundle title', 'TSLA volatility signal bundle');
  }

  if (commandName === 'krs' && subcommand === 'decrypt') {
    await maybePromptOption(options, ['bundle-file'], 'Bundle file path');
  }

  return options;
}

function showCommandTopic(topic) {
  if (CLI_RUNTIME.json) {
    emitResult('help-topic', {
      command: topic,
      subcommands: COMMAND_TREE[topic] || [],
    });
    return;
  }
  switch (topic) {
    case 'init':
      printHeading('init');
      console.log('Bootstraps a sample CLI config and optionally writes shell completions.');
      console.log(`Run: ${CLI_COMMAND} init --interactive`);
      return;
    case 'doctor':
      printHeading('doctor');
      console.log('Checks env loading, contract connectivity, broker health, and receipt wiring.');
      console.log(`Run: ${CLI_COMMAND} doctor`);
      return;
    case 'env:bootstrap':
      printHeading('env:bootstrap');
      console.log('Writes a local env file from the running Docker broker defaults when available.');
      console.log(`Run: ${CLI_COMMAND} env-bootstrap`);
      console.log(`Optional: PROGRAMMABLE_SECRETS_ENV_OUTPUT_PATH=/tmp/ps.env ${CLI_COMMAND} env-bootstrap`);
      return;
    case 'flow:direct':
      printHeading('flow:direct');
      console.log('Runs the direct ERC-8004 identity purchase flow on the selected network.');
      console.log(`Run: ${CLI_COMMAND} flow:direct`);
      console.log(`Arbitrum override: PROGRAMMABLE_SECRETS_NETWORK=arbitrum-sepolia ${CLI_COMMAND} flow:direct`);
      return;
    case 'flow:broker':
      printHeading('flow:broker');
      console.log('Registers through Registry Broker first, then completes the ERC-8004 identity purchase flow.');
      console.log(`Run: ${CLI_COMMAND} flow:broker`);
      console.log(`Arbitrum override: PROGRAMMABLE_SECRETS_NETWORK=arbitrum-sepolia ${CLI_COMMAND} flow:broker`);
      return;
    case 'profiles':
      printHeading('profiles');
      printCommandUsage([
        `List profiles: ${CLI_COMMAND} profiles list`,
        `Show profile: ${CLI_COMMAND} profiles show --profile provider`,
        `Write sample config: ${CLI_COMMAND} profiles init --force`,
      ]);
      return;
    case 'templates':
      printHeading('templates');
      printCommandUsage([
        `List templates: ${CLI_COMMAND} templates list`,
        `Show template: ${CLI_COMMAND} templates show --name finance-timebound-dataset`,
        `Write template: ${CLI_COMMAND} templates write --name finance-uaid-policy --output finance-uaid-policy.json`,
      ]);
      return;
    case 'krs':
      printHeading('krs');
      printCommandUsage([
        `Encrypt local bundle: ${CLI_COMMAND} krs encrypt --plaintext '{"signal":"buy"}' --output bundle.json`,
        `Decrypt local bundle: ${CLI_COMMAND} krs decrypt --bundle-file bundle.json`,
        `Verify onchain linkage: ${CLI_COMMAND} krs verify --bundle-file bundle.json --policy-id 1 --buyer 0x...`,
      ]);
      return;
    case 'completions':
      printHeading('completions');
      printCommandUsage([
        `Zsh completions: ${CLI_COMMAND} completions zsh --output ~/.zsh/completions/_programmable-secret`,
        `Bash completions: ${CLI_COMMAND} completions bash`,
      ]);
      return;
    case 'datasets':
      printHeading('datasets');
      printCommandUsage([
        `List datasets: ${CLI_COMMAND} datasets list [--network robinhood-testnet]`,
        `Read dataset: ${CLI_COMMAND} datasets get --dataset-id 1`,
        `Export dataset: ${CLI_COMMAND} datasets export --dataset-id 1 --output dataset-1.json`,
        `Import dataset: ${CLI_COMMAND} datasets import --file dataset-1.json`,
        'Register dataset:',
        `  ${CLI_COMMAND} datasets register --provider-uaid did:uaid:hol:quantlab --metadata-json '{"title":"TSLA"}' --ciphertext "encrypted payload" --key-material "wrapped key"`,
        'Set dataset active state:',
        `  ${CLI_COMMAND} datasets set-active --dataset-id 1 --active false`,
      ]);
      return;
    case 'policies':
      printHeading('policies');
      printCommandUsage([
        `List policies: ${CLI_COMMAND} policies list [--dataset-id 1]`,
        `Read policy: ${CLI_COMMAND} policies get --policy-id 1`,
        `Export policy: ${CLI_COMMAND} policies export --policy-id 1 --output policy-1.json`,
        `Import policy: ${CLI_COMMAND} policies import --file policy-1.json`,
        'Create timebound policy:',
        `  ${CLI_COMMAND} policies create-timebound --dataset-id 1 --price-eth 0.00001 --duration-hours 24 --metadata-json '{"title":"TSLA 24h access"}'`,
        'Create UAID-bound policy:',
        `  ${CLI_COMMAND} policies create-uaid --dataset-id 1 --price-eth 0.00001 --required-buyer-uaid uaid:aid:... --agent-id 97`,
        'Update policy:',
        `  ${CLI_COMMAND} policies update --policy-id 1 --price-eth 0.00002 --active true --metadata-json '{"title":"Updated policy"}'`,
        'Set allowlist:',
        `  ${CLI_COMMAND} policies allowlist --policy-id 1 --accounts 0xabc,0xdef --allowed true`,
      ]);
      return;
    case 'purchase':
      printHeading('purchase');
      printCommandUsage([
        `Buy policy: ${CLI_COMMAND} purchase --policy-id 1 [--recipient 0x...] [--buyer-uaid uaid:aid:...]`,
        'The CLI reads the live policy price automatically and sends the purchase from the agent wallet by default.',
      ]);
      return;
    case 'access':
      printHeading('access');
      printCommandUsage([
        `Check policy access: ${CLI_COMMAND} access policy --policy-id 1 --buyer 0x...`,
        `Check dataset access: ${CLI_COMMAND} access dataset --dataset-id 1 --buyer 0x...`,
        `Resolve receipt by policy: ${CLI_COMMAND} access receipt-policy --policy-id 1 --buyer 0x...`,
        `Resolve receipt by dataset: ${CLI_COMMAND} access receipt-dataset --dataset-id 1 --buyer 0x...`,
      ]);
      return;
    case 'receipts':
      printHeading('receipts');
      printCommandUsage([
        `Read receipt: ${CLI_COMMAND} receipts get --receipt-id 1`,
      ]);
      return;
    case 'identity':
      printHeading('identity');
      printCommandUsage([
        `Register ERC-8004 agent: ${CLI_COMMAND} identity register --agent-uri https://hol.org/agents/volatility-trading-agent-custodian`,
      ]);
      return;
    case 'contracts':
      printHeading('contracts');
      printCommandUsage([
        `Show deployed addresses: ${CLI_COMMAND} contracts [--network robinhood-testnet]`,
      ]);
      return;
    default:
      printWarning(`Unknown help topic: ${topic}`);
  }
}

function showHelp(topic = null) {
  if (topic) {
    showCommandTopic(topic);
    return;
  }
  if (CLI_RUNTIME.json) {
    emitResult('help', {
      alias: CLI_ALIAS,
      command: CLI_COMMAND,
      commands: COMMAND_TREE,
    });
    return;
  }
  printHeading('Programmable Secrets CLI');
  console.log(`Usage: ${CLI_COMMAND} <command>`);
  console.log(`Alias: ${CLI_ALIAS} <command>`);
  console.log('Local wrapper: pnpm run cli -- <command>');
  console.log('');
  console.log('Golden path:');
  console.log(`  1. ${CLI_COMMAND} init`);
  console.log(`  2. ${CLI_COMMAND} doctor`);
  console.log(`  3. ${CLI_COMMAND} flow:direct`);
  console.log(`  4. ${CLI_COMMAND} flow:broker`);
  console.log('');
  console.log('Guided commands:');
  console.log(`  ${CLI_COMMAND} init          Bootstrap profiles and optional completions`);
  console.log(`  ${CLI_COMMAND} start         Guided quick start with next-step recommendations`);
  console.log(`  ${CLI_COMMAND} doctor        Check env, RPC, broker, and deployment readiness`);
  console.log(`  ${CLI_COMMAND} env-bootstrap Write a local .env.local from live Docker defaults`);
  console.log(`  ${CLI_COMMAND} flow:direct   Direct ERC-8004 identity flow (Robinhood by default)`);
  console.log(`  ${CLI_COMMAND} flow:broker   Registry Broker-backed identity flow (Robinhood by default)`);
  console.log('');
  console.log('Contract commands:');
  console.log(`  ${CLI_COMMAND} contracts    Show deployed contract addresses`);
  console.log(`  ${CLI_COMMAND} datasets ... Register, inspect, and activate datasets`);
  console.log(`  ${CLI_COMMAND} policies ... Create, inspect, update, and allowlist policies`);
  console.log(`  ${CLI_COMMAND} purchase ... Purchase a policy using the live onchain price`);
  console.log(`  ${CLI_COMMAND} access ...   Check access and resolve receipts by buyer`);
  console.log(`  ${CLI_COMMAND} receipts ... Read receipt details`);
  console.log(`  ${CLI_COMMAND} identity ... Register ERC-8004 agents`);
  console.log(`  ${CLI_COMMAND} krs ...      Encrypt, decrypt, and verify local unlock bundles`);
  console.log(`  ${CLI_COMMAND} profiles ... Manage named operator profiles`);
  console.log(`  ${CLI_COMMAND} templates ... Emit reusable dataset and policy templates`);
  console.log(`  ${CLI_COMMAND} completions  Generate shell completions`);
  console.log(`  ${CLI_COMMAND} preview ...  Preview a state-changing command without sending a transaction`);
  console.log('');
  console.log('Legacy repo helpers:');
  console.log('  pnpm run policies:list');
  console.log('  pnpm run policies:deactivate-all');
  console.log('  pnpm run policies:update-prices');
  console.log('');
  console.log('Global flags: --json --quiet --interactive --profile <name> --preview --yes --agent-safe');
  console.log('Set PROGRAMMABLE_SECRETS_NETWORK=arbitrum-sepolia to target Arbitrum for the identity flow.');
  console.log(`If wallet keys are missing, run ${CLI_COMMAND} env-bootstrap or ${CLI_COMMAND} doctor.`);
  console.log(`Topic help: ${CLI_COMMAND} help datasets`);
}

function runProcess(command, args) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function resolveDockerContainer() {
  const cached = RUNTIME_ENV_CACHE.get('docker-container');
  if (cached) {
    return cached;
  }
  for (const containerName of DEFAULT_DOCKER_CONTAINERS) {
    const result = runProcess('docker', ['ps', '--format', '{{.Names}}']);
    if (result.status !== 0) {
      break;
    }
    const names = result.stdout
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean);
    if (names.includes(containerName)) {
      RUNTIME_ENV_CACHE.set('docker-container', containerName);
      return containerName;
    }
  }
  RUNTIME_ENV_CACHE.set('docker-container', null);
  return null;
}

function readDockerEnv(name) {
  const cacheKey = `docker-env:${name}`;
  if (RUNTIME_ENV_CACHE.has(cacheKey)) {
    return RUNTIME_ENV_CACHE.get(cacheKey);
  }
  const containerName = resolveDockerContainer();
  if (!containerName) {
    RUNTIME_ENV_CACHE.set(cacheKey, null);
    return null;
  }
  const result = runProcess('docker', ['exec', containerName, 'printenv', name]);
  if (result.status !== 0 || !result.stdout.trim()) {
    const aliases = DOCKER_ENV_ALIASES[name] ?? [];
    for (const alias of aliases) {
      const aliasResult = runProcess('docker', ['exec', containerName, 'printenv', alias]);
      if (aliasResult.status === 0 && aliasResult.stdout.trim()) {
        const aliasValue = aliasResult.stdout.trim().split(',')[0].trim();
        RUNTIME_ENV_CACHE.set(cacheKey, aliasValue.length > 0 ? aliasValue : null);
        return RUNTIME_ENV_CACHE.get(cacheKey);
      }
    }
    RUNTIME_ENV_CACHE.set(cacheKey, null);
    return null;
  }
  const value = result.stdout.trim();
  RUNTIME_ENV_CACHE.set(cacheKey, value.length > 0 ? value : null);
  return RUNTIME_ENV_CACHE.get(cacheKey);
}

function resolveEnvValue(name, fallback = null) {
  const direct = process.env[name]?.trim();
  if (direct) {
    return { value: direct, source: 'process-env' };
  }
  const dockerValue = readDockerEnv(name);
  if (dockerValue) {
    process.env[name] = dockerValue;
    return { value: dockerValue, source: 'docker' };
  }
  if (fallback !== null && fallback !== undefined) {
    return { value: fallback, source: 'default' };
  }
  return { value: null, source: 'missing' };
}

function requireEnvValue(name, options = {}) {
  const { fallback = null, description = name } = options;
  const resolved = resolveEnvValue(name, fallback);
  if (resolved.value) {
    return resolved;
  }
  const envPaths = ENV_PATH_CANDIDATES.join(', ');
  const containerName = resolveDockerContainer();
  const dockerHint = containerName
    ? ` or load it from Docker with "docker exec ${containerName} printenv ${name}"`
    : '';
  throw new CliError(
    'MISSING_ENV',
    `Missing ${description} (${name}).`,
    `Checked process env and ${envPaths}${dockerHint}. Run "${CLI_COMMAND} env-bootstrap" or populate .env.local manually.`,
  );
}

function buildBootstrapEnvMap() {
  const agentKey = resolveEnvValue('ETH_PK').value;
  const providerKey = resolveEnvValue('ETH_PK_2').value;
  const brokerAccountId = resolveEnvValue(
    'REGISTRY_BROKER_ACCOUNT_ID',
    agentKey ? privateKeyToAccount(normalizePrivateKey(agentKey, 'ETH_PK')).address : '0xYOUR_AGENT_WALLET_ADDRESS',
  ).value;
  return {
    ETH_PK: agentKey || '0xYOUR_AGENT_WALLET_PRIVATE_KEY',
    ETH_PK_2: providerKey || '0xYOUR_PROVIDER_WALLET_PRIVATE_KEY',
    REGISTRY_BROKER_BASE_URL: resolveEnvValue('REGISTRY_BROKER_BASE_URL', DEFAULT_REGISTRY_BROKER_BASE_URL).value,
    REGISTRY_BROKER_API_KEY: resolveEnvValue('REGISTRY_BROKER_API_KEY', DEFAULT_REGISTRY_BROKER_API_KEY).value,
    REGISTRY_BROKER_ACCOUNT_ID: brokerAccountId,
    REGISTRY_BROKER_ERC8004_NETWORK: resolveEnvValue(
      'REGISTRY_BROKER_ERC8004_NETWORK',
      `erc-8004:${DEFAULT_NETWORK_ID}`,
    ).value,
    PROGRAMMABLE_SECRETS_NETWORK: resolvePreferredEnvValue(
      'PROGRAMMABLE_SECRETS_NETWORK',
      ['DEMO_ERC8004_NETWORK'],
      DEFAULT_NETWORK_ID,
    ).value,
    PROGRAMMABLE_SECRETS_AGENT_URI: resolvePreferredEnvValue(
      'PROGRAMMABLE_SECRETS_AGENT_URI',
      ['DEMO_AGENT_URI'],
      'https://hol.org/agents/volatility-trading-agent-custodian',
    ).value,
    PROGRAMMABLE_SECRETS_PROVIDER_UAID: resolvePreferredEnvValue(
      'PROGRAMMABLE_SECRETS_PROVIDER_UAID',
      ['DEMO_PROVIDER_UAID'],
      'did:uaid:hol:quantlab?uid=quantlab&registry=hol&proto=hol&nativeId=quantlab',
    ).value,
    PROGRAMMABLE_SECRETS_PRICE_WEI: resolvePreferredEnvValue(
      'PROGRAMMABLE_SECRETS_PRICE_WEI',
      ['DEMO_PRICE_WEI'],
      '10000000000000',
    ).value,
  };
}

function writeBootstrapEnvFile() {
  const envMap = buildBootstrapEnvMap();
  if (existsSync(DEFAULT_ENV_OUTPUT_PATH)) {
    printWarning(`${DEFAULT_ENV_OUTPUT_PATH} already exists. Leaving it untouched.`);
    printInfo('Delete or rename the file if you want the CLI to regenerate it.');
    return;
  }
  const lines = Object.entries(envMap).map(([key, value]) => `${key}=${value}`);
  writeFileSync(DEFAULT_ENV_OUTPUT_PATH, `${lines.join('\n')}\n`, 'utf8');
  printSuccess(`Wrote ${DEFAULT_ENV_OUTPUT_PATH}`);
  printInfo('Review the file before running a live workflow command.');
}

async function runDoctor() {
  const networkId = getSelectedNetworkId();
  const chain = getSelectedChain(networkId);
  const brokerRegistryKey = `erc-8004:${networkId}`;
  let brokerSupportsSelectedNetwork = false;
  const payload = {
    accessReceipt: null,
    brokerHealth: 'unreachable',
    brokerNetworks: [],
    brokerSupportsSelectedNetwork: false,
    dockerSource: resolveDockerContainer() || 'not found',
    envFiles: ENV_PATH_CANDIDATES,
    network: chain.name,
    paymentModule: null,
    policyCount: null,
    policyVault: null,
    receiptPaymentModule: null,
  };
  printHeading('Programmable Secrets Doctor');
  printField('Selected net', chain.name);
  printField('Env files', ENV_PATH_CANDIDATES.join(', '));
  printField('Docker source', resolveDockerContainer() || 'not found');

  const checks = [
    ['ETH_PK', resolveEnvValue('ETH_PK').source],
    ['ETH_PK_2', resolveEnvValue('ETH_PK_2').source],
    [
      'PS network',
      resolvePreferredEnvValue('PROGRAMMABLE_SECRETS_NETWORK', ['DEMO_ERC8004_NETWORK'], DEFAULT_NETWORK_ID).source,
    ],
    ['REGISTRY_BROKER_BASE_URL', resolveEnvValue('REGISTRY_BROKER_BASE_URL', DEFAULT_REGISTRY_BROKER_BASE_URL).source],
    ['REGISTRY_BROKER_API_KEY', resolveEnvValue('REGISTRY_BROKER_API_KEY', DEFAULT_REGISTRY_BROKER_API_KEY).source],
  ];
  for (const [name, source] of checks) {
    printField(name, source === 'missing' ? 'missing' : `available via ${source}`);
  }

  const policyVaultAddress = buildPolicyVaultAddress(networkId);
  const paymentModuleAddress = buildPaymentModuleAddress(networkId);
  const accessReceiptAddress = buildAccessReceiptAddress(networkId);
  payload.policyVault = policyVaultAddress;
  payload.paymentModule = paymentModuleAddress;
  payload.accessReceipt = accessReceiptAddress;
  printField('PolicyVault', policyVaultAddress);
  printField('PaymentModule', paymentModuleAddress);
  printField('AccessReceipt', accessReceiptAddress);

  const publicClient = getPublicClient(chain);
  const policyCount = await publicClient.readContract({
    address: policyVaultAddress,
    abi: POLICY_VAULT_ABI,
    functionName: 'policyCount',
  });
  payload.policyCount = policyCount;
  printField('policyCount', `${policyCount}`);

  const receiptPaymentModule = await publicClient.readContract({
    address: accessReceiptAddress,
    abi: parseAbi(['function paymentModule() view returns (address)']),
    functionName: 'paymentModule',
  });
  payload.receiptPaymentModule = receiptPaymentModule;
  printField('Receipt wiring', receiptPaymentModule);

  const brokerBaseUrl = resolveEnvValue('REGISTRY_BROKER_BASE_URL', DEFAULT_REGISTRY_BROKER_BASE_URL).value;
  try {
    const response = await fetch(`${brokerBaseUrl}/health`);
    payload.brokerHealth = response.ok ? 'ok' : `${response.status}`;
    printField('Broker health', response.ok ? 'ok' : `${response.status}`);
  } catch {
    printField('Broker health', 'unreachable');
  }

  try {
    const { RegistryBrokerClient } = await import('../../standards-sdk/src/index.ts');
    const brokerApiKey = resolveEnvValue('REGISTRY_BROKER_API_KEY', DEFAULT_REGISTRY_BROKER_API_KEY).value;
    const brokerAccountId = resolveEnvValue('REGISTRY_BROKER_ACCOUNT_ID', '0x0000000000000000000000000000000000000000').value;
    const client = new RegistryBrokerClient({
      baseUrl: brokerBaseUrl,
      accountId: brokerAccountId,
      ...(brokerApiKey ? { apiKey: brokerApiKey } : {}),
    });
    const additionalCatalog = await client.getAdditionalRegistries();
    const erc8004Registry = additionalCatalog.registries.find(
      (entry) => entry?.id === 'erc-8004',
    );
    const availableNetworks = (erc8004Registry?.networks ?? [])
      .map((entry) => entry?.key)
      .filter(Boolean);
    brokerSupportsSelectedNetwork = availableNetworks.includes(brokerRegistryKey);
    payload.brokerNetworks = availableNetworks;
    payload.brokerSupportsSelectedNetwork = brokerSupportsSelectedNetwork;
    printField(
      'Broker ERC-8004',
      brokerSupportsSelectedNetwork ? `ready for ${brokerRegistryKey}` : `missing ${brokerRegistryKey}`,
    );
    if (availableNetworks.length > 0) {
      printField('Broker nets', availableNetworks.join(', '));
    }
  } catch {
    printField('Broker ERC-8004', 'unverified');
  }

  if (CLI_RUNTIME.json) {
    emitResult('doctor', payload);
    return;
  }

  if (!resolveEnvValue('ETH_PK').value || !resolveEnvValue('ETH_PK_2').value) {
    printWarning('Wallet keys are still missing for live workflow execution.');
    printInfo(`Run "${CLI_COMMAND} env-bootstrap" to generate a local env file from Docker defaults.`);
  } else if (!brokerSupportsSelectedNetwork) {
    printWarning('Core contract checks passed, but the Registry Broker is not ready for the selected chain.');
    printInfo('Use the direct flow on the selected chain or switch PROGRAMMABLE_SECRETS_NETWORK to a broker-supported chain.');
  } else {
    printSuccess('Doctor checks passed for the selected network.');
  }
}

async function runStart() {
  const networkId = getSelectedNetworkId();
  const chain = getSelectedChain(networkId);
  const payload = {
    accessReceipt: buildAccessReceiptAddress(networkId),
    docker: resolveDockerContainer() || 'not found',
    network: chain.name,
    paymentModule: buildPaymentModuleAddress(networkId),
    policyVault: buildPolicyVaultAddress(networkId),
  };
  printHeading('Programmable Secrets Start');
  printField('Network', chain.name);
  printField('PolicyVault', payload.policyVault);
  printField('PaymentModule', payload.paymentModule);
  printField('AccessReceipt', payload.accessReceipt);

  const agentKey = resolveEnvValue('ETH_PK');
  const providerKey = resolveEnvValue('ETH_PK_2');
  printField('Agent key', agentKey.value ? `ready via ${agentKey.source}` : 'missing');
  printField('Provider key', providerKey.value ? `ready via ${providerKey.source}` : 'missing');
  printField('Docker', payload.docker);
  payload.agentKeySource = agentKey.value ? agentKey.source : 'missing';
  payload.providerKeySource = providerKey.value ? providerKey.source : 'missing';

  if (!agentKey.value || !providerKey.value) {
    if (CLI_RUNTIME.json) {
      emitResult('start', {
        ...payload,
        next: `${CLI_COMMAND} env-bootstrap`,
        ready: false,
      });
      return;
    }
    printWarning('Operator keys are missing.');
    console.log(`Recommended next step: ${CLI_COMMAND} env-bootstrap`);
    return;
  }

  if (CLI_RUNTIME.json) {
    emitResult('start', {
      ...payload,
      next: [`${CLI_COMMAND} doctor`, `${CLI_COMMAND} flow:direct`, `${CLI_COMMAND} flow:broker`],
      ready: true,
    });
    return;
  }
  printSuccess('Environment looks ready for live workflow execution.');
  console.log('Recommended next steps:');
  console.log(`  ${CLI_COMMAND} doctor`);
  console.log(`  ${CLI_COMMAND} flow:direct`);
  console.log(`  ${CLI_COMMAND} flow:broker`);
}

function normalizePrivateKey(value, label) {
  if (!value) {
    throw new CliError('MISSING_PRIVATE_KEY', `${label} is required.`);
  }
  return value.startsWith('0x') ? value : `0x${value}`;
}

function getWalletClient({ privateKey, chain }) {
  const normalizedPrivateKey = normalizePrivateKey(privateKey, 'privateKey');
  const account = privateKeyToAccount(normalizedPrivateKey);
  return createWalletClient({
    account,
    chain,
    transport: http(chain.rpcUrls.default.http[0]),
  });
}

function getDefaultWalletClient() {
  const { value } = requireEnvValue('ETH_PK', {
    description: 'agent wallet private key',
  });
  const account = privateKeyToAccount(normalizePrivateKey(value, 'ETH_PK'));
  console.log(`Using account: ${account.address}`);
  return createWalletClient({
    account,
    chain: robinhoodTestnet,
    transport: http(robinhoodTestnet.rpcUrls.default.http[0]),
  });
}

function getPublicClient(chain) {
  return createPublicClient({
    chain,
    transport: http(chain.rpcUrls.default.http[0]),
  });
}

function getSelectedNetworkId() {
  const requestedNetworkId = readOption(
    CLI_RUNTIME.globalOptions,
    ['network'],
    resolvePreferredEnvValue('PROGRAMMABLE_SECRETS_NETWORK', ['DEMO_ERC8004_NETWORK'], DEFAULT_NETWORK_ID).value,
  );
  const normalizedNetworkId = NETWORK_ALIASES[requestedNetworkId] || requestedNetworkId;
  if (!(normalizedNetworkId in SUPPORTED_NETWORKS)) {
    throw new CliError(
      'UNSUPPORTED_NETWORK',
      `Unsupported PROGRAMMABLE_SECRETS_NETWORK "${requestedNetworkId}".`,
      `Expected one of: ${Object.keys(SUPPORTED_NETWORKS).join(', ')}`,
    );
  }
  return normalizedNetworkId;
}

function getSelectedChain(networkId) {
  const chain = SUPPORTED_NETWORKS[networkId];
  if (!chain) {
    throw new CliError(
      'UNSUPPORTED_NETWORK',
      `Unsupported network "${networkId}".`,
      `Use one of: ${Object.keys(SUPPORTED_NETWORKS).join(', ')}`,
    );
  }
  return chain;
}

function buildPolicyVaultAddress(network) {
  return getAddress(loadDeployment(network).entrypoints.policyVaultAddress);
}

function buildPaymentModuleAddress(network) {
  return getAddress(loadDeployment(network).entrypoints.paymentModuleAddress);
}

function buildAccessReceiptAddress(network) {
  return getAddress(loadDeployment(network).entrypoints.accessReceiptAddress);
}

function buildIdentityRegistryAddress(network) {
  return getAddress(loadDeployment(network).entrypoints.agentIdentityRegistryAddress);
}

function requireIdentityRegistryAddress(network) {
  const identityRegistryAddress = buildIdentityRegistryAddress(network);
  if (identityRegistryAddress === zeroAddress) {
    throw new CliError(
      'IDENTITY_REGISTRY_MISSING',
      `No ERC-8004 IdentityRegistry is configured for ${network}.`,
      `Update deployments/${network}.json, pass --identity-registry, or switch PROGRAMMABLE_SECRETS_NETWORK.`,
    );
  }
  return identityRegistryAddress;
}

function getWalletKeyForRole(role) {
  if (role === 'provider') {
    return requireSecondWallet();
  }
  return requireEnvValue('ETH_PK', {
    description: 'agent wallet private key',
  }).value;
}

function getWalletClientForRole({ role, chain }) {
  return getWalletClient({
    privateKey: getWalletKeyForRole(role),
    chain,
  });
}

function formatTimestamp(unixSeconds) {
  if (!unixSeconds || Number(unixSeconds) === 0) {
    return 'none';
  }
  return new Date(Number(unixSeconds) * 1000).toISOString();
}

function decodePolicyTypeLabel(policyType) {
  if (policyType === keccak256(toBytes('TIMEBOUND_V1'))) {
    return 'timebound';
  }
  if (policyType === keccak256(toBytes('UAID_ERC8004_V1'))) {
    return 'uaid-erc8004';
  }
  return policyType;
}

function printDatasetSummary(datasetId, dataset) {
  printField('Dataset', datasetId);
  printField('Provider', dataset.provider);
  printField('Active', dataset.active);
  printField('Created', formatTimestamp(dataset.createdAt));
  printField('Ciphertext', dataset.ciphertextHash);
  printField('Key commit', dataset.keyCommitment);
  printField('Metadata', dataset.metadataHash);
  printField('Prov UAID', dataset.providerUaidHash);
}

function printPolicySummary(policyId, policy) {
  printField('Policy', policyId);
  printField('Dataset', policy.datasetId);
  printField('Provider', policy.provider);
  printField('Payout', policy.payout);
  printField('Price', `${formatEther(policy.price)} ETH (${policy.price} wei)`);
  printField('Type', decodePolicyTypeLabel(policy.policyType));
  printField('Active', policy.active);
  printField('Allowlist', policy.allowlistEnabled);
  printField('Expires', formatTimestamp(policy.expiresAt));
  printField('Created', formatTimestamp(policy.createdAt));
  printField('Metadata', policy.metadataHash);
  if (policy.requiredBuyerUaidHash !== zeroHash()) {
    printField('Req UAID', policy.requiredBuyerUaidHash);
    printField('Identity reg', policy.identityRegistry);
    printField('Agent id', policy.agentId);
  }
}

function printReceiptSummary(receiptTokenId, receipt) {
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

function serializeDataset(datasetId, dataset, policyIds = []) {
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

function serializePolicy(policyId, policy) {
  return {
    active: policy.active,
    agentId: policy.agentId,
    allowlistEnabled: policy.allowlistEnabled,
    createdAt: policy.createdAt,
    ciphertextHash: policy.ciphertextHash,
    datasetId: policy.datasetId,
    expiresAt: policy.expiresAt,
    identityRegistry: policy.identityRegistry,
    keyCommitment: policy.keyCommitment,
    metadataHash: policy.metadataHash,
    paymentToken: policy.paymentToken,
    payout: policy.payout,
    policyId,
    policyType: policy.policyType,
    priceWei: policy.price,
    provider: policy.provider,
    providerUaidHash: policy.providerUaidHash,
    requiredBuyerUaidHash: policy.requiredBuyerUaidHash,
  };
}

function serializeReceipt(receiptTokenId, receipt) {
  return {
    buyer: receipt.buyer,
    ciphertextHash: receipt.ciphertextHash,
    datasetId: receipt.datasetId,
    keyCommitment: receipt.keyCommitment,
    paymentToken: receipt.paymentToken,
    policyId: receipt.policyId,
    priceWei: receipt.price,
    purchasedAt: receipt.purchasedAt,
    receiptId: receiptTokenId,
    recipient: receipt.recipient,
  };
}

function toHexString(buffer) {
  return `0x${Buffer.from(buffer).toString('hex')}`;
}

function parseHexBuffer(value, description) {
  const trimmed = `${value}`.trim();
  if (!/^0x[0-9a-fA-F]*$/.test(trimmed) || trimmed.length % 2 !== 0) {
    throw new CliError('INVALID_HEX', `Invalid ${description}.`, 'Expected a 0x-prefixed even-length hex string.');
  }
  return Buffer.from(trimmed.slice(2), 'hex');
}

function maybeWriteJsonFile(outputPath, payload) {
  const resolvedPath = resolve(outputPath);
  writeFileSync(resolvedPath, `${serializeJson(payload)}\n`);
  return resolvedPath;
}

function readJsonFile(inputPath, description) {
  try {
    return JSON.parse(readFileSync(resolve(inputPath), 'utf8'));
  } catch (error) {
    throw new CliError(
      'JSON_READ_FAILED',
      `Unable to read ${description} from ${inputPath}.`,
      'Confirm the file exists and contains valid JSON.',
      error instanceof Error ? error.message : `${error}`,
    );
  }
}

function zeroHash() {
  return `0x${'0'.repeat(64)}`;
}

function sha256Hex(value) {
  return `0x${createHash('sha256').update(value).digest('hex')}`;
}

function encryptPayload(plaintextBuffer) {
  const contentKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', contentKey, iv);
  const ciphertextBody = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    contentKey,
    iv,
    ciphertext: Buffer.concat([ciphertextBody, tag]),
  };
}

function decryptPayload({ ciphertext, contentKey, iv }) {
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const body = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', contentKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

function requireSecondWallet() {
  return requireEnvValue('ETH_PK_2', {
    description: 'provider wallet private key',
  }).value;
}

function buildBuyerUaid({ chainId, agentId }) {
  const provided = resolvePreferredEnvValue(
    'PROGRAMMABLE_SECRETS_BUYER_UAID',
    ['DEMO_BUYER_UAID'],
  ).value;
  if (provided) {
    return provided;
  }
  return `uaid:aid:volatility-agent;uid=${chainId}:${agentId};registry=erc-8004;proto=erc-8004;nativeId=${chainId}:${agentId}`;
}

function parseErc8004AgentId(value) {
  const trimmed = `${value ?? ''}`.trim();
  if (!trimmed) {
    throw new CliError(
      'MISSING_AGENT_ID',
      'ERC-8004 agent id is required.',
      `Provide --agent-id or rerun ${CLI_COMMAND} identity register with --interactive.`,
    );
  }
  const candidate = trimmed.includes(':')
    ? trimmed.slice(trimmed.lastIndexOf(':') + 1)
    : trimmed;
  const parsed = Number.parseInt(candidate, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliError(
      'INVALID_AGENT_ID',
      `Unable to parse ERC-8004 agent id from "${trimmed}".`,
      'Use a positive integer or a chain-qualified value such as 421614:97.',
    );
  }
  return parsed;
}

async function decodeIndexedEvent({ abi, receipt, eventName }) {
  const log = receipt.logs.find((candidate) => {
    try {
      const decoded = decodeEventLog({
        abi,
        data: candidate.data,
        topics: candidate.topics,
      });
      return decoded.eventName === eventName;
    } catch {
      return false;
    }
  });

  if (!log) {
    throw new CliError(
      'EVENT_NOT_FOUND',
      `Expected ${eventName} event was not found.`,
      'Inspect the transaction receipt and confirm the contract emitted the expected event.',
    );
  }

  return decodeEventLog({
    abi,
    data: log.data,
    topics: log.topics,
  });
}

function buildBrokerProfile({ alias, endpoint, AIAgentCapability, AIAgentType, ProfileType }) {
  return {
    version: '1.0',
    type: ProfileType.AI_AGENT,
    display_name: alias,
    alias,
    bio: `Programmable Secrets agent ${alias}`,
    properties: {
      tags: ['programmable-secrets', 'finance-agent', 'erc-8004', 'policy-access'],
      agentFactsUrl: `${endpoint.replace(/\/$/, '')}/.well-known/agent.json`,
    },
    aiAgent: {
      type: AIAgentType.MANUAL,
      model: 'programmable-secrets-agent-model',
      capabilities: [
        AIAgentCapability.TEXT_GENERATION,
        AIAgentCapability.WORKFLOW_AUTOMATION,
      ],
      creator: 'programmable-secrets-contracts',
    },
  };
}

function findAdditionalRegistryResult(entries, registryKey) {
  if (!Array.isArray(entries)) {
    return null;
  }
  return (
    entries.find((entry) => entry?.registryKey === registryKey)
    || entries.find((entry) => entry?.networkId === registryKey.replace(/^erc-8004:/, ''))
    || null
  );
}

async function registerBrokerBackedAgent() {
  const { RegistryBrokerClient, AIAgentCapability, AIAgentType, ProfileType } = await import(
    '../../standards-sdk/src/index.ts'
  );
  const { startLocalA2AAgent } = await import(
    '../../standards-sdk/demo/utils/local-a2a-agent.ts'
  );

  const baseUrl = resolveEnvValue('REGISTRY_BROKER_BASE_URL', DEFAULT_REGISTRY_BROKER_BASE_URL).value;
  const apiKey = resolveEnvValue('REGISTRY_BROKER_API_KEY', DEFAULT_REGISTRY_BROKER_API_KEY).value;
  const agentKey = requireEnvValue('ETH_PK', {
    description: 'agent wallet private key',
  });
  const derivedAccountId = privateKeyToAccount(normalizePrivateKey(agentKey.value, 'ETH_PK')).address;
  const accountId = resolveEnvValue('REGISTRY_BROKER_ACCOUNT_ID', derivedAccountId).value;
  const selectedNetworkId = getSelectedNetworkId();
  const selectedRegistryKey = `erc-8004:${selectedNetworkId}`;
  const configuredRegistryKey = resolveEnvValue(
    'REGISTRY_BROKER_ERC8004_NETWORK',
    selectedRegistryKey,
  ).value;
  const registryKey = configuredRegistryKey === selectedRegistryKey
    ? configuredRegistryKey
    : selectedRegistryKey;
  const alias =
    resolvePreferredEnvValue('PROGRAMMABLE_SECRETS_AGENT_ALIAS', ['DEMO_AGENT_ALIAS']).value
    || `programmable-secrets-${Date.now().toString(36)}`;

  if (configuredRegistryKey !== selectedRegistryKey) {
    printWarning(
      `Ignoring REGISTRY_BROKER_ERC8004_NETWORK=${configuredRegistryKey} and using ${selectedRegistryKey} to match the selected chain.`,
    );
  }

  const client = new RegistryBrokerClient({
    baseUrl,
    accountId,
    ...(apiKey ? { apiKey } : {}),
  });
  const additionalCatalog = await client.getAdditionalRegistries();
  const erc8004Registry = additionalCatalog.registries.find(
    (entry) => entry?.id === 'erc-8004'
  );
  const selectedNetwork = erc8004Registry?.networks.find(
    (entry) => entry?.key === registryKey
  );
  if (!selectedNetwork) {
    const availableNetworks = (erc8004Registry?.networks ?? [])
      .map((entry) => entry?.key)
      .filter(Boolean);
    const availableText = availableNetworks.length > 0
      ? `Available broker networks: ${availableNetworks.join(', ')}.`
      : 'The broker did not return any ERC-8004 networks.';
    throw new CliError(
      'BROKER_NETWORK_UNAVAILABLE',
      `Registry Broker does not expose ${registryKey}. ${availableText}`,
      'Update the local registry-broker configuration or switch PROGRAMMABLE_SECRETS_NETWORK to a supported chain.',
    );
  }

  const localAgentHandle = await startLocalA2AAgent({
    agentId: alias,
  });

  try {
    const endpoint = localAgentHandle.publicUrl ?? localAgentHandle.a2aEndpoint;
    const profile = buildBrokerProfile({
      alias,
      endpoint,
      AIAgentCapability,
      AIAgentType,
      ProfileType,
    });
    const registrationPayload = {
      profile,
      communicationProtocol: DEFAULT_COMMUNICATION_PROTOCOL,
      registry: DEFAULT_REGISTRY_NAMESPACE,
      additionalRegistries: [registryKey],
      metadata: {
        provider: 'programmable-secrets-contracts',
        source: 'contracts-cli',
      },
      endpoint,
    };

    const registered = await client.registerAgent(registrationPayload);
    let progress = null;
    let additionalResult = findAdditionalRegistryResult(
      registered.additionalRegistries,
      registryKey,
    );

    if ((!additionalResult?.agentId || additionalResult.status === 'pending') && registered.attemptId) {
      progress = await client.waitForRegistrationCompletion(registered.attemptId, {
        timeoutMs: 180000,
        intervalMs: 2000,
      });
      additionalResult = findAdditionalRegistryResult(
        Object.values(progress.additionalRegistries ?? {}),
        registryKey,
      );
    }

    if (!additionalResult?.agentId) {
      throw new CliError(
        'BROKER_AGENT_ID_MISSING',
        `Registry Broker registration did not return an ERC-8004 agent id for ${registryKey}.`,
        'Inspect the registration attempt in the broker and confirm the additional registry completed successfully.',
      );
    }

    return {
      alias,
      baseUrl,
      accountId,
      brokerUaid: registered.uaid,
      brokerAgentId: registered.agentId,
      erc8004AgentId: additionalResult.agentId,
      erc8004NetworkId: additionalResult.networkId ?? selectedNetwork.networkId,
      erc8004ChainId: additionalResult.chainId ?? selectedNetwork.chainId,
      erc8004RegistryKey: additionalResult.registryKey ?? registryKey,
      localAgentHandle,
      progress,
      selectedNetwork,
    };
  } catch (error) {
    await localAgentHandle.stop();
    throw error;
  }
}

async function listPolicies() {
  const publicClient = getPublicClient(robinhoodTestnet);
  const policyVaultAddress = buildPolicyVaultAddress('robinhood-testnet');
  const count = await publicClient.readContract({
    address: policyVaultAddress,
    abi: POLICY_VAULT_ABI,
    functionName: 'policyCount',
  });
  console.log(`\nTotal policies on-chain: ${count}\n`);

  for (let i = 1n; i <= count; i++) {
    try {
      const p = await publicClient.readContract({
        address: policyVaultAddress,
        abi: POLICY_VAULT_ABI,
        functionName: 'getPolicy',
        args: [i],
      });
      console.log(`Policy #${i}:`);
      console.log(`  Provider:  ${p.provider}`);
      console.log(`  Price:     ${formatEther(p.price)} ETH (${p.price} wei)`);
      console.log(`  Active:    ${p.active}`);
      console.log(`  ExpiresAt: ${new Date(Number(p.expiresAt) * 1000).toISOString()}`);
      console.log(`  DatasetID: ${p.datasetId}`);
      console.log(`  MetaHash:  ${p.metadataHash}`);
      console.log('');
    } catch (e) {
      console.log(`Policy #${i}: error reading — ${e.message}\n`);
    }
  }
}

async function deactivateAll() {
  const walletClient = getDefaultWalletClient();
  const publicClient = getPublicClient(robinhoodTestnet);
  const policyVaultAddress = buildPolicyVaultAddress('robinhood-testnet');
  const count = await publicClient.readContract({
    address: policyVaultAddress,
    abi: POLICY_VAULT_ABI,
    functionName: 'policyCount',
  });
  console.log(`\nDeactivating all ${count} policies...\n`);

  for (let i = 1n; i <= count; i++) {
    try {
      const p = await publicClient.readContract({
        address: policyVaultAddress,
        abi: POLICY_VAULT_ABI,
        functionName: 'getPolicy',
        args: [i],
      });

      if (p.provider.toLowerCase() !== walletClient.account.address.toLowerCase()) {
        console.log(`Policy #${i}: skip — owned by ${p.provider} (not you)`);
        continue;
      }
      if (!p.active) {
        console.log(`Policy #${i}: already inactive`);
        continue;
      }

      const tx = await walletClient.writeContract({
        address: policyVaultAddress,
        abi: POLICY_VAULT_ABI,
        functionName: 'updatePolicy',
        args: [i, p.price, p.expiresAt, false, p.allowlistEnabled, p.metadataHash],
      });
      console.log(`Policy #${i}: deactivated — tx ${tx}`);
      await publicClient.waitForTransactionReceipt({ hash: tx });
      console.log(`  ✓ confirmed`);
    } catch (e) {
      console.error(`Policy #${i}: error — ${e.message}`);
    }
  }
  console.log('\nDone!');
}

function normalizeNetworkId(rawValue) {
  const candidate = `${rawValue}`.trim();
  return NETWORK_ALIASES[candidate] || candidate;
}

function getNetworkIdFromOptions(options) {
  const requested = readOption(options, ['network'], null);
  if (!requested) {
    return getSelectedNetworkId();
  }
  const normalized = normalizeNetworkId(requested);
  if (!(normalized in SUPPORTED_NETWORKS)) {
    throw new CliError(
      'UNSUPPORTED_NETWORK',
      `Unsupported network "${requested}".`,
      `Expected one of: ${Object.keys(SUPPORTED_NETWORKS).join(', ')}.`,
    );
  }
  return normalized;
}

function getChainFromOptions(options) {
  return getSelectedChain(getNetworkIdFromOptions(options));
}

async function showContracts(options) {
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const payload = {
    accessReceipt: buildAccessReceiptAddress(networkId),
    identityRegistry: buildIdentityRegistryAddress(networkId),
    network: chain.name,
    paymentModule: buildPaymentModuleAddress(networkId),
    policyVault: buildPolicyVaultAddress(networkId),
  };
  if (CLI_RUNTIME.json) {
    emitResult('contracts', payload);
    return;
  }
  printHeading(`Contracts on ${chain.name}`);
  printField('PolicyVault', payload.policyVault);
  printField('PaymentModule', payload.paymentModule);
  printField('AccessReceipt', payload.accessReceipt);
  printField('Identity reg', payload.identityRegistry);
}

async function listDatasetsCommand(options) {
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

  const providerFilter = readOption(options, ['provider']);
  for (let datasetId = 1n; datasetId <= datasetCount; datasetId += 1n) {
    const dataset = await publicClient.readContract({
      address: policyVaultAddress,
      abi: POLICY_VAULT_ABI,
      functionName: 'getDataset',
      args: [datasetId],
    });
    if (providerFilter && dataset.provider.toLowerCase() !== providerFilter.toLowerCase()) {
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
    if (CLI_RUNTIME.json) {
      continue;
    }
    console.log('');
    printDatasetSummary(datasetId, dataset);
  }
  if (CLI_RUNTIME.json) {
    emitResult('datasets', {
      count: datasetCount,
      items: datasets,
      network: chain.name,
    });
  }
}

async function getDatasetCommand(options) {
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
  const payload = {
    ...serializeDataset(datasetId, dataset, policyIds),
    network: chain.name,
  };
  if (CLI_RUNTIME.json) {
    emitResult('dataset', payload);
    return;
  }
  printHeading(`Dataset ${datasetId} on ${chain.name}`);
  printDatasetSummary(datasetId, dataset);
  printField('Policies', policyIds.length > 0 ? policyIds.join(', ') : 'none');
}

async function registerDatasetCommand(options) {
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const walletRole = resolveSelectedWalletRole(options, 'provider');
  const walletClient = getWalletClientForRole({ role: walletRole, chain });
  const publicClient = getPublicClient(chain);
  const policyVaultAddress = buildPolicyVaultAddress(networkId);
  const hashes = resolveDatasetRegistrationHashes(options);
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
  if (shouldPreview(options)) {
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
  const event = await decodeIndexedEvent({
    abi: POLICY_VAULT_ABI,
    receipt,
    eventName: 'DatasetRegistered',
  });

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

async function setDatasetActiveCommand(options) {
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

async function listPoliciesCommand(options) {
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
    items.push({
      ...serializePolicy(policyId, policy),
      network: chain.name,
    });
    if (CLI_RUNTIME.json) {
      continue;
    }
    console.log('');
    printPolicySummary(policyId, policy);
  }
  if (CLI_RUNTIME.json) {
    emitResult('policies', {
      count: policyCount,
      items,
      network: chain.name,
    });
  }
}

async function getPolicyCommand(options) {
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
  const payload = {
    ...serializePolicy(policyId, policy),
    network: chain.name,
  };
  if (CLI_RUNTIME.json) {
    emitResult('policy', payload);
    return;
  }
  printHeading(`Policy ${policyId} on ${chain.name}`);
  printPolicySummary(policyId, policy);
}

function resolveAllowlistAccounts(options) {
  return parseAddressList(readOption(options, ['accounts', 'allowlist'], ''));
}

async function createTimeboundPolicyCommand(options) {
  const datasetId = parseBigIntValue(requireOption(options, 'dataset-id', 'dataset id'), 'dataset-id');
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const walletClient = getWalletClientForRole({
    role: resolveSelectedWalletRole(options, 'provider'),
    chain,
  });
  const publicClient = getPublicClient(chain);
  const payout = getAddress(readOption(options, ['payout'], walletClient.account.address));
  const priceWei = resolvePriceWei(options);
  const expiresAt = resolveExpiryUnix(options);
  const allowlistEnabled = parseBooleanOption(readOption(options, ['allowlist-enabled'], false), false);
  const metadataHash = resolveMetadataHash(options);
  const allowlistAccounts = resolveAllowlistAccounts(options);
  const preview = {
    action: 'Create Timebound Policy',
    address: buildPolicyVaultAddress(networkId),
    args: [
      datasetId,
      payout,
      zeroAddress,
      priceWei,
      expiresAt,
      allowlistEnabled,
      metadataHash,
      allowlistAccounts,
    ],
    contract: 'PolicyVault',
    functionName: 'createTimeboundPolicy',
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
    functionName: 'createTimeboundPolicy',
    args: [
      datasetId,
      payout,
      zeroAddress,
      priceWei,
      expiresAt,
      allowlistEnabled,
      metadataHash,
      allowlistAccounts,
    ],
    chain,
    account: walletClient.account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const event = await decodeIndexedEvent({
    abi: POLICY_VAULT_ABI,
    receipt,
    eventName: 'PolicyCreated',
  });
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

async function createUaidPolicyCommand(options) {
  const datasetId = parseBigIntValue(requireOption(options, 'dataset-id', 'dataset id'), 'dataset-id');
  const requiredBuyerUaid = requireOption(options, ['required-buyer-uaid'], 'required buyer UAID');
  const agentId = parseBigIntValue(requireOption(options, ['agent-id'], 'ERC-8004 agent id'), 'agent-id');
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const walletClient = getWalletClientForRole({
    role: resolveSelectedWalletRole(options, 'provider'),
    chain,
  });
  const publicClient = getPublicClient(chain);
  const payout = getAddress(readOption(options, ['payout'], walletClient.account.address));
  const priceWei = resolvePriceWei(options);
  const expiresAt = resolveExpiryUnix(options);
  const allowlistEnabled = parseBooleanOption(readOption(options, ['allowlist-enabled'], false), false);
  const metadataHash = resolveMetadataHash(options);
  const allowlistAccounts = resolveAllowlistAccounts(options);
  const identityRegistry = getAddress(
    readOption(options, ['identity-registry'], buildIdentityRegistryAddress(networkId)),
  );
  const preview = {
    action: 'Create UAID Policy',
    address: buildPolicyVaultAddress(networkId),
    args: [
      datasetId,
      payout,
      zeroAddress,
      priceWei,
      expiresAt,
      allowlistEnabled,
      metadataHash,
      buildHashFromText(requiredBuyerUaid),
      identityRegistry,
      agentId,
      allowlistAccounts,
    ],
    contract: 'PolicyVault',
    functionName: 'createUaidBoundPolicy',
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
    functionName: 'createUaidBoundPolicy',
    args: [
      datasetId,
      payout,
      zeroAddress,
      priceWei,
      expiresAt,
      allowlistEnabled,
      metadataHash,
      buildHashFromText(requiredBuyerUaid),
      identityRegistry,
      agentId,
      allowlistAccounts,
    ],
    chain,
    account: walletClient.account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const event = await decodeIndexedEvent({
    abi: POLICY_VAULT_ABI,
    receipt,
    eventName: 'PolicyCreated',
  });
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

async function updatePolicyCommand(options) {
  const policyId = parseBigIntValue(requireOption(options, 'policy-id', 'policy id'), 'policy-id');
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const walletClient = getWalletClientForRole({
    role: resolveSelectedWalletRole(options, 'provider'),
    chain,
  });
  const publicClient = getPublicClient(chain);
  const existing = await publicClient.readContract({
    address: buildPolicyVaultAddress(networkId),
    abi: POLICY_VAULT_ABI,
    functionName: 'getPolicy',
    args: [policyId],
  });

  const nextPrice = readOption(options, ['price-wei', 'price-eth']) ? resolvePriceWei(options) : existing.price;
  const nextExpiry = readOption(options, ['expires-at-unix', 'expires-at-iso', 'duration-hours'])
    ? resolveExpiryUnix(options)
    : existing.expiresAt;
  const active = readOption(options, ['active']) !== null
    ? parseBooleanOption(readOption(options, ['active']))
    : existing.active;
  const allowlistEnabled = readOption(options, ['allowlist-enabled']) !== null
    ? parseBooleanOption(readOption(options, ['allowlist-enabled']))
    : existing.allowlistEnabled;
  const metadataHash = readOption(options, ['metadata-hash', 'metadata', 'metadata-file', 'metadata-json']) !== null
    ? resolveMetadataHash(options)
    : existing.metadataHash;

  const preview = {
    action: 'Update Policy',
    address: buildPolicyVaultAddress(networkId),
    args: [policyId, nextPrice, nextExpiry, active, allowlistEnabled, metadataHash],
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
    args: [policyId, nextPrice, nextExpiry, active, allowlistEnabled, metadataHash],
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

async function setPolicyAllowlistCommand(options) {
  const policyId = parseBigIntValue(requireOption(options, 'policy-id', 'policy id'), 'policy-id');
  const accounts = resolveAllowlistAccounts(options);
  const allowed = parseBooleanOption(requireOption(options, 'allowed', 'allowlist state'));
  if (accounts.length === 0) {
    throw new CliError(
      'MISSING_ALLOWLIST_ACCOUNTS',
      'Provide at least one account with --accounts.',
      `Example: ${CLI_COMMAND} policies allowlist --policy-id ${policyId} --accounts 0xabc,0xdef --allowed true`,
    );
  }
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const walletClient = getWalletClientForRole({
    role: resolveSelectedWalletRole(options, 'provider'),
    chain,
  });
  const publicClient = getPublicClient(chain);
  const preview = {
    action: 'Update Policy Allowlist',
    address: buildPolicyVaultAddress(networkId),
    args: [policyId, accounts, allowed],
    contract: 'PolicyVault',
    functionName: 'setAllowlist',
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
    functionName: 'setAllowlist',
    args: [policyId, accounts, allowed],
    chain,
    account: walletClient.account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  printTransactionResult(createTransactionResult({
    action: 'Policy Allowlist Updated',
    chain,
    contract: 'PolicyVault',
    entityLabel: 'Policy',
    entityValue: policyId,
    explorerUrl: buildExplorerUrl(chain, hash),
    nextCommand: `${CLI_COMMAND} policies get --policy-id ${policyId}`,
    secondaryLabel: 'Allowed',
    secondaryValue: allowed,
    txHash: hash,
    wallet: walletClient.account.address,
  }));
}

async function purchasePolicyCommand(options) {
  const policyId = parseBigIntValue(requireOption(options, 'policy-id', 'policy id'), 'policy-id');
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const walletClient = getWalletClientForRole({
    role: resolveSelectedWalletRole(options, 'agent'),
    chain,
  });
  const publicClient = getPublicClient(chain);
  const policyVaultAddress = buildPolicyVaultAddress(networkId);
  const paymentModuleAddress = buildPaymentModuleAddress(networkId);
  const policy = await publicClient.readContract({
    address: policyVaultAddress,
    abi: POLICY_VAULT_ABI,
    functionName: 'getPolicy',
    args: [policyId],
  });
  const recipient = readOption(options, ['recipient'], zeroAddress);
  const buyerUaid = readOption(options, ['buyer-uaid'], '');
  const preview = {
    action: 'Purchase Policy',
    address: paymentModuleAddress,
    args: [policyId, recipient === zeroAddress ? zeroAddress : getAddress(recipient), buyerUaid],
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
    address: paymentModuleAddress,
    abi: PAYMENT_MODULE_ABI,
    functionName: 'purchase',
    args: [policyId, recipient === zeroAddress ? zeroAddress : getAddress(recipient), buyerUaid],
    value: policy.price,
    chain,
    account: walletClient.account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  const receiptTokenId = await publicClient.readContract({
    address: paymentModuleAddress,
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

async function accessPolicyCommand(options) {
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

async function accessDatasetCommand(options) {
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

async function receiptByPolicyCommand(options) {
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

async function receiptByDatasetCommand(options) {
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

async function getReceiptCommand(options) {
  const receiptId = parseBigIntValue(requireOption(options, ['receipt-id'], 'receipt id'), 'receipt-id');
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const receipt = await getPublicClient(chain).readContract({
    address: buildAccessReceiptAddress(networkId),
    abi: ACCESS_RECEIPT_ABI,
    functionName: 'getReceipt',
    args: [receiptId],
  });
  const payload = {
    ...serializeReceipt(receiptId, receipt),
    network: chain.name,
  };
  if (CLI_RUNTIME.json) {
    emitResult('receipt', payload);
    return;
  }
  printHeading(`Receipt ${receiptId} on ${chain.name}`);
  printReceiptSummary(receiptId, receipt);
}

async function registerIdentityCommand(options) {
  const agentUri = requireOption(options, ['agent-uri'], 'agent URI');
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const identityRegistry = getAddress(
    readOption(options, ['identity-registry'], buildIdentityRegistryAddress(networkId)),
  );
  if (identityRegistry === zeroAddress) {
    throw new CliError(
      'IDENTITY_REGISTRY_MISSING',
      `No identity registry configured for ${networkId}.`,
      'Provide --identity-registry.',
    );
  }
  const walletClient = getWalletClientForRole({
    role: resolveSelectedWalletRole(options, 'agent'),
    chain,
  });
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
  const event = await decodeIndexedEvent({
    abi: IDENTITY_REGISTRY_ABI,
    receipt,
    eventName: 'Registered',
  });
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

async function exportDatasetCommand(options) {
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
    const writtenPath = maybeWriteJsonFile(outputPath, payload);
    if (CLI_RUNTIME.json) {
      emitResult('dataset-export', {
        outputPath: writtenPath,
        ...payload,
      });
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

async function importDatasetCommand(options) {
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
    normalizeHash(dataset.ciphertextHash, 'ciphertext hash'),
    normalizeHash(dataset.keyCommitment, 'key commitment'),
    normalizeHash(dataset.metadataHash, 'metadata hash'),
    normalizeHash(dataset.providerUaidHash, 'provider UAID hash'),
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
  const event = await decodeIndexedEvent({
    abi: POLICY_VAULT_ABI,
    receipt,
    eventName: 'DatasetRegistered',
  });
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

async function exportPolicyCommand(options) {
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
  const payload = {
    exportedAt: new Date().toISOString(),
    network: networkId,
    version: 1,
    policy: serializePolicy(policyId, policy),
  };
  const outputPath = resolveOutputPath(options);
  if (outputPath) {
    const writtenPath = maybeWriteJsonFile(outputPath, payload);
    if (CLI_RUNTIME.json) {
      emitResult('policy-export', {
        outputPath: writtenPath,
        ...payload,
      });
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

async function importPolicyCommand(options) {
  const inputPath = requireOption(options, ['file', 'input'], 'policy import file');
  const payload = readJsonFile(inputPath, 'policy import');
  const policy = payload.policy || payload;
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const walletClient = getWalletClientForRole({
    role: resolveSelectedWalletRole(options, 'provider'),
    chain,
  });
  const publicClient = getPublicClient(chain);
  const datasetId = parseBigIntValue(`${policy.datasetId}`, 'dataset id');
  const payout = getAddress(policy.payout || walletClient.account.address);
  const priceWei = parseBigIntValue(`${policy.priceWei ?? policy.price ?? 0}`, 'price');
  const expiresAt = parseBigIntValue(`${policy.expiresAt ?? 0}`, 'expiresAt');
  const metadataHash = normalizeHash(policy.metadataHash, 'metadata hash');
  const allowlistAccounts = policy.allowlistAccounts ? policy.allowlistAccounts.map((entry) => getAddress(entry)) : [];
  const allowlistEnabled = Boolean(policy.allowlistEnabled);
  const policyTypeLabel = decodePolicyTypeLabel(policy.policyType || zeroHash());
  if (policyTypeLabel === 'unknown') {
    throw new CliError(
      'POLICY_IMPORT_UNSUPPORTED',
      'Unable to infer policy type from import payload.',
      'Use an exported policy file or set policy.policyType to the exported onchain value.',
    );
  }

  if (policyTypeLabel === 'timebound') {
    const args = [datasetId, payout, zeroAddress, priceWei, expiresAt, allowlistEnabled, metadataHash, allowlistAccounts];
    const preview = {
      action: 'Import Timebound Policy',
      address: buildPolicyVaultAddress(networkId),
      args,
      contract: 'PolicyVault',
      functionName: 'createTimeboundPolicy',
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
      functionName: 'createTimeboundPolicy',
      args,
      chain,
      account: walletClient.account,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const event = await decodeIndexedEvent({
      abi: POLICY_VAULT_ABI,
      receipt,
      eventName: 'PolicyCreated',
    });
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
    return;
  }

  const requiredBuyerUaidHash = policy.requiredBuyerUaid
    ? buildHashFromText(policy.requiredBuyerUaid)
    : normalizeHash(policy.requiredBuyerUaidHash, 'required buyer UAID hash');
  const identityRegistry = getAddress(policy.identityRegistry || buildIdentityRegistryAddress(networkId));
  const agentId = parseBigIntValue(`${policy.agentId}`, 'agent id');
  const args = [
    datasetId,
    payout,
    zeroAddress,
    priceWei,
    expiresAt,
    allowlistEnabled,
    metadataHash,
    requiredBuyerUaidHash,
    identityRegistry,
    agentId,
    allowlistAccounts,
  ];
  const preview = {
    action: 'Import UAID Policy',
    address: buildPolicyVaultAddress(networkId),
    args,
    contract: 'PolicyVault',
    functionName: 'createUaidBoundPolicy',
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
    functionName: 'createUaidBoundPolicy',
    args,
    chain,
    account: walletClient.account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const event = await decodeIndexedEvent({
    abi: POLICY_VAULT_ABI,
    receipt,
    eventName: 'PolicyCreated',
  });
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

function resolvePlaintextBuffer(options) {
  const plaintext = readOption(options, ['plaintext'], null);
  if (plaintext !== null) {
    return Buffer.from(plaintext, 'utf8');
  }
  const filePath = readOption(options, ['plaintext-file', 'file'], null);
  if (filePath !== null) {
    return readFileSync(resolve(filePath));
  }
  throw new CliError(
    'MISSING_PLAINTEXT',
    'Missing plaintext payload.',
    `Provide --plaintext or --plaintext-file, or rerun ${CLI_COMMAND} krs encrypt with --interactive.`,
  );
}

function buildBundlePayload(options) {
  const plaintextBuffer = resolvePlaintextBuffer(options);
  const encryptedPayload = encryptPayload(plaintextBuffer);
  const title = readOption(options, ['title'], 'Programmable Secrets bundle');
  const metadataJson = readOption(options, ['metadata-json'], JSON.stringify({ title }));
  const metadataHash = buildHashFromText(metadataJson);
  const providerUaid = readOption(options, ['provider-uaid'], 'did:uaid:hol:provider');
  return {
    bundle: {
      contentKeyHex: toHexString(encryptedPayload.contentKey),
      ciphertextHex: toHexString(encryptedPayload.ciphertext),
      ciphertextHash: keccak256(`0x${encryptedPayload.ciphertext.toString('hex')}`),
      ivHex: toHexString(encryptedPayload.iv),
      keyCommitment: keccak256(`0x${encryptedPayload.contentKey.toString('hex')}`),
      metadata: JSON.parse(metadataJson),
      metadataHash,
      plaintextHash: sha256Hex(plaintextBuffer),
      plaintextPreview: plaintextBuffer.toString('utf8').slice(0, 140),
      providerUaid,
      providerUaidHash: buildHashFromText(providerUaid),
      title,
      version: 1,
    },
  };
}

async function encryptBundleCommand(options) {
  const payload = buildBundlePayload(options);
  const outputPath = resolveOutputPath(options);
  if (outputPath) {
    const writtenPath = maybeWriteJsonFile(outputPath, payload);
    if (CLI_RUNTIME.json) {
      emitResult('krs-encrypt', {
        outputPath: writtenPath,
        ...payload,
      });
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

async function decryptBundleCommand(options) {
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
      emitResult('krs-decrypt', {
        outputPath: resolvedPath,
        plaintextBytes: plaintext.length,
      });
      return;
    }
    printSuccess(`Wrote decrypted payload to ${resolvedPath}`);
    return;
  }
  const plaintextText = plaintext.toString('utf8');
  emitResult('krs-decrypt', {
    plaintext: plaintextText,
    plaintextBytes: plaintext.length,
  });
  if (!CLI_RUNTIME.json) {
    console.log(plaintextText);
  }
}

async function verifyBundleCommand(options) {
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
    result.matchesOnChain = policy.ciphertextHash === bundle.ciphertextHash
      && policy.keyCommitment === bundle.keyCommitment;
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
    result.matchesReceipt = receipt.ciphertextHash === bundle.ciphertextHash
      && receipt.keyCommitment === bundle.keyCommitment;
  }

  emitResult('krs-verify', result);
  if (!CLI_RUNTIME.json) {
    console.log(serializeJson(result));
  }
}

async function runInitCommand(options) {
  const force = parseBooleanOption(readOption(options, ['force'], false), false);
  const wroteConfig = !existsSync(CLI_CONFIG_PATH);
  if (wroteConfig || force) {
    writeCliConfig(getDefaultConfig(), CLI_CONFIG_PATH, force);
  }
  const shell = readOption(options, ['write-completion'], null);
  let completionPath = null;
  if (shell) {
    completionPath = resolve(resolveOutputPath(options, `${CLI_COMMAND}.${shell}`));
    writeFileSync(completionPath, `${renderCompletionScript(shell)}\n`);
  }
  const payload = {
    completionPath,
    configPath: CLI_CONFIG_PATH,
    envBootstrapSuggested: !existsSync(DEFAULT_ENV_OUTPUT_PATH),
    wroteConfig: wroteConfig || force,
  };
  if (CLI_RUNTIME.json) {
    emitResult('init', payload);
    return;
  }
  printHeading('Programmable Secrets Init');
  printField('Config', CLI_CONFIG_PATH);
  printField('Completion', completionPath || 'not requested');
  printField('Env bootstrap', payload.envBootstrapSuggested ? `${CLI_COMMAND} env-bootstrap` : 'already present');
  printField('Next', `${CLI_COMMAND} doctor`);
}

async function runProfilesCommand(tokens) {
  const { positionals, options } = parseCliArgs(tokens);
  const subcommand = positionals[0] || 'list';
  const config = loadCliConfig();
  if (subcommand === 'init') {
    const force = parseBooleanOption(readOption(options, ['force'], false), false);
    writeCliConfig(getDefaultConfig(), CLI_CONFIG_PATH, force);
    if (CLI_RUNTIME.json) {
      emitResult('profiles-init', {
        configPath: CLI_CONFIG_PATH,
      });
      return;
    }
    printSuccess(`Wrote sample profiles to ${CLI_CONFIG_PATH}`);
    return;
  }
  if (subcommand === 'show') {
    const profileName = readOption(options, ['profile'], CLI_RUNTIME.profileName || config.defaultProfile);
    const profile = config.profiles?.[profileName];
    if (!profile) {
      throw new CliError('PROFILE_MISSING', `Profile "${profileName}" was not found.`, `Run ${CLI_COMMAND} profiles list.`);
    }
    emitResult('profile', {
      name: profileName,
      profile,
    });
    if (!CLI_RUNTIME.json) {
      console.log(serializeJson({
        name: profileName,
        profile,
      }));
    }
    return;
  }
  emitResult('profiles', {
    configPath: CLI_CONFIG_PATH,
    defaultProfile: config.defaultProfile,
    profiles: config.profiles,
  });
  if (!CLI_RUNTIME.json) {
    console.log(serializeJson({
      configPath: CLI_CONFIG_PATH,
      defaultProfile: config.defaultProfile,
      profiles: config.profiles,
    }));
  }
}

async function runTemplatesCommand(tokens) {
  const { positionals, options } = parseCliArgs(tokens);
  const subcommand = positionals[0] || 'list';
  if (subcommand === 'list') {
    emitResult('templates', {
      templates: TEMPLATE_REGISTRY,
    });
    if (!CLI_RUNTIME.json) {
      console.log(serializeJson(TEMPLATE_REGISTRY));
    }
    return;
  }
  const templateName = requireOption(options, ['name', 'template'], 'template name');
  const template = TEMPLATE_REGISTRY[templateName];
  if (!template) {
    throw new CliError(
      'TEMPLATE_MISSING',
      `Unknown template "${templateName}".`,
      `Use ${CLI_COMMAND} templates list.`,
    );
  }
  if (subcommand === 'write') {
    const outputPath = resolveOutputPath(options, `${templateName}.json`);
    const writtenPath = maybeWriteJsonFile(outputPath, template);
    if (CLI_RUNTIME.json) {
      emitResult('template-write', {
        outputPath: writtenPath,
        template: templateName,
      });
      return;
    }
    printSuccess(`Wrote template to ${writtenPath}`);
    return;
  }
  emitResult('template', {
    name: templateName,
    template,
  });
  if (!CLI_RUNTIME.json) {
    console.log(serializeJson({
      name: templateName,
      template,
    }));
  }
}

function renderCompletionScript(shell) {
  const topLevel = Object.keys(COMMAND_TREE).sort();
  const functionName = `_${CLI_COMMAND.replace(/-/g, '_')}_completions`;
  if (shell === 'bash') {
    return `${functionName}() {\n  local cur prev words cword\n  _init_completion || return\n  if [[ $cword -eq 1 ]]; then\n    COMPREPLY=( $(compgen -W "${topLevel.join(' ')}" -- "$cur") )\n    return\n  fi\n  case "\${words[1]}" in\n${topLevel
    .map((commandName) => `    ${commandName}) COMPREPLY=( $(compgen -W "${(COMMAND_TREE[commandName] || []).join(' ')}" -- "$cur") ); return ;;`)
    .join('\n')}\n  esac\n}\ncomplete -F ${functionName} ${CLI_COMMAND} ${CLI_ALIAS}`;
  }
  if (shell === 'zsh') {
    return `#compdef ${CLI_COMMAND} ${CLI_ALIAS}\n_arguments '1:command:(${topLevel.join(' ')})' '2:subcommand:->subcmds'\ncase $words[2] in\n${topLevel
    .map((commandName) => `  ${commandName}) _values 'subcommand' ${(COMMAND_TREE[commandName] || []).join(' ')} ;;`)
    .join('\n')}\nesac`;
  }
  if (shell === 'fish') {
    return topLevel
      .map((commandName) => `complete -c ${CLI_COMMAND} -f -n '__fish_use_subcommand' -a '${commandName}'`)
      .concat(
        topLevel.flatMap((commandName) => (COMMAND_TREE[commandName] || []).map(
          (subcommand) => `complete -c ${CLI_COMMAND} -f -n '__fish_seen_subcommand_from ${commandName}' -a '${subcommand}'`,
        )),
      )
      .join('\n');
  }
  throw new CliError(
    'UNSUPPORTED_SHELL',
    `Unsupported shell "${shell}".`,
    'Use bash, zsh, or fish.',
  );
}

async function runCompletionsCommand(tokens) {
  const { positionals, options } = parseCliArgs(tokens);
  const shell = positionals[0] || readOption(options, ['shell'], 'zsh');
  const script = renderCompletionScript(shell);
  const outputPath = resolveOutputPath(options);
  if (outputPath) {
    const resolvedPath = resolve(outputPath);
    writeFileSync(resolvedPath, `${script}\n`);
    if (CLI_RUNTIME.json) {
      emitResult('completions', {
        outputPath: resolvedPath,
        shell,
      });
      return;
    }
    printSuccess(`Wrote ${shell} completions to ${resolvedPath}`);
    return;
  }
  console.log(script);
}

async function updatePrices() {
  const walletClient = getDefaultWalletClient();
  const publicClient = getPublicClient(robinhoodTestnet);
  const policyVaultAddress = buildPolicyVaultAddress('robinhood-testnet');
  const count = await publicClient.readContract({
    address: policyVaultAddress,
    abi: POLICY_VAULT_ABI,
    functionName: 'policyCount',
  });
  console.log(`\nUpdating prices on ${count} policies to 0.00001 ETH...\n`);

  const newPrice = 10000000000000n;

  for (let i = 1n; i <= count; i++) {
    try {
      const p = await publicClient.readContract({
        address: policyVaultAddress,
        abi: POLICY_VAULT_ABI,
        functionName: 'getPolicy',
        args: [i],
      });

      if (p.provider.toLowerCase() !== walletClient.account.address.toLowerCase()) {
        console.log(`Policy #${i}: skip — owned by ${p.provider}`);
        continue;
      }

      const currentPriceEth = formatEther(p.price);
      console.log(`Policy #${i}: ${currentPriceEth} ETH → 0.00001 ETH`);

      const tx = await walletClient.writeContract({
        address: policyVaultAddress,
        abi: POLICY_VAULT_ABI,
        functionName: 'updatePolicy',
        args: [i, newPrice, p.expiresAt, p.active, p.allowlistEnabled, p.metadataHash],
      });
      console.log(`  tx: ${tx}`);

      await publicClient.waitForTransactionReceipt({ hash: tx });
      console.log(`  ✓ confirmed — now 0.00001 ETH`);
    } catch (e) {
      console.error(`Policy #${i}: error — ${e.message}`);
    }
  }
  console.log('\nDone!');
}

async function runUaidPolicyFlow({
  networkId,
  chain,
  agentWalletClient,
  providerWalletClient,
  accessReceiptAddress,
  identityRegistryAddress,
  buyerUaid,
  agentId,
  datasetTitle,
}) {
  const publicClient = getPublicClient(chain);
  const policyVaultAddress = buildPolicyVaultAddress(networkId);
  const paymentModuleAddress = buildPaymentModuleAddress(networkId);
  const providerUaid = resolvePreferredEnvValue(
    'PROGRAMMABLE_SECRETS_PROVIDER_UAID',
    ['DEMO_PROVIDER_UAID'],
  ).value
    || 'did:uaid:hol:quantlab?uid=quantlab&registry=hol&proto=hol&nativeId=quantlab';
  const priceWei = BigInt(
    resolvePreferredEnvValue(
      'PROGRAMMABLE_SECRETS_PRICE_WEI',
      ['DEMO_PRICE_WEI'],
      '10000000000000',
    ).value,
  );
  const expiresAt = BigInt(
    Number(
      resolvePreferredEnvValue(
        'PROGRAMMABLE_SECRETS_EXPIRES_AT_UNIX',
        ['DEMO_EXPIRES_AT_UNIX'],
        '',
      ).value || '',
    )
      || Math.floor(Date.now() / 1000) + 24 * 60 * 60,
  );
  const plaintext = JSON.stringify(
    {
      market: 'TSLA',
      strategy: 'volatility-arbitrage',
      signal: 'buy-protective-gamma',
      agentId,
      uaid: buyerUaid,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  );
  const plaintextBuffer = Buffer.from(plaintext, 'utf8');
  const encryptedPayload = encryptPayload(plaintextBuffer);
  const ciphertextHash = keccak256(`0x${encryptedPayload.ciphertext.toString('hex')}`);
  const keyCommitment = keccak256(`0x${encryptedPayload.contentKey.toString('hex')}`);
  const metadataHash = keccak256(
    toBytes(
      JSON.stringify({
        title: datasetTitle,
        mimeType: 'application/json',
        plaintextHash: sha256Hex(plaintextBuffer),
      }),
    ),
  );
  const providerUaidHash = keccak256(toBytes(providerUaid));
  const requiredBuyerUaidHash = keccak256(toBytes(buyerUaid));

  const datasetTx = await providerWalletClient.writeContract({
    address: policyVaultAddress,
    abi: POLICY_VAULT_ABI,
    functionName: 'registerDataset',
    args: [ciphertextHash, keyCommitment, metadataHash, providerUaidHash],
    chain,
    account: providerWalletClient.account,
  });
  const datasetReceipt = await publicClient.waitForTransactionReceipt({
    hash: datasetTx,
  });
  const datasetEvent = await decodeIndexedEvent({
    abi: POLICY_VAULT_ABI,
    receipt: datasetReceipt,
    eventName: 'DatasetRegistered',
  });
  const datasetId = Number(datasetEvent.args.datasetId);

  const createPolicyTx = await providerWalletClient.writeContract({
    address: policyVaultAddress,
    abi: POLICY_VAULT_ABI,
    functionName: 'createUaidBoundPolicy',
    args: [
      BigInt(datasetId),
      providerWalletClient.account.address,
      '0x0000000000000000000000000000000000000000',
      priceWei,
      expiresAt,
      false,
      metadataHash,
      requiredBuyerUaidHash,
      identityRegistryAddress,
      BigInt(agentId),
      [],
    ],
    chain,
    account: providerWalletClient.account,
  });
  const createPolicyReceipt = await publicClient.waitForTransactionReceipt({
    hash: createPolicyTx,
  });
  const policyEvent = await decodeIndexedEvent({
    abi: POLICY_VAULT_ABI,
    receipt: createPolicyReceipt,
    eventName: 'PolicyCreated',
  });
  const policyId = Number(policyEvent.args.policyId);

  const purchaseTx = await agentWalletClient.writeContract({
    address: paymentModuleAddress,
    abi: PAYMENT_MODULE_ABI,
    functionName: 'purchase',
    args: [BigInt(policyId), agentWalletClient.account.address, buyerUaid],
    value: priceWei,
    chain,
    account: agentWalletClient.account,
  });
  await publicClient.waitForTransactionReceipt({
    hash: purchaseTx,
  });

  const receiptTokenId = await publicClient.readContract({
    address: paymentModuleAddress,
    abi: PAYMENT_MODULE_ABI,
    functionName: 'receiptOfPolicyAndBuyer',
    args: [BigInt(policyId), agentWalletClient.account.address],
  });
  const hasAccess = await publicClient.readContract({
    address: paymentModuleAddress,
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
    datasetId,
    policyId,
    datasetTx,
    createPolicyTx,
    purchaseTx,
    receiptTokenId,
    hasAccess,
    receipt,
    decryptedPlaintext: decryptPayload({
      ciphertext: encryptedPayload.ciphertext,
      contentKey: encryptedPayload.contentKey,
      iv: encryptedPayload.iv,
    }).toString('utf8'),
    priceWei,
  };
}

async function demoUaidFlow() {
  const networkId = getSelectedNetworkId();
  const chain = getSelectedChain(networkId);
  const agentKey = requireEnvValue('ETH_PK', {
    description: 'agent wallet private key',
  });
  const providerKey = requireEnvValue('ETH_PK_2', {
    description: 'provider wallet private key',
  });
  const publicClient = getPublicClient(chain);
  const agentWalletClient = getWalletClient({
    privateKey: agentKey.value,
    chain,
  });
  const providerWalletClient = getWalletClient({
    privateKey: providerKey.value,
    chain,
  });
  const policyVaultAddress = buildPolicyVaultAddress(networkId);
  const paymentModuleAddress = buildPaymentModuleAddress(networkId);
  const accessReceiptAddress = buildAccessReceiptAddress(networkId);
  const identityRegistryAddress = requireIdentityRegistryAddress(networkId);

  printHeading('Direct Identity Flow');
  printField('Network', chain.name);
  printField('Agent wallet', agentWalletClient.account.address);
  printField('Provider wallet', providerWalletClient.account.address);
  printField('PolicyVault', policyVaultAddress);
  printField('PaymentModule', paymentModuleAddress);
  printField('AccessReceipt', accessReceiptAddress);
  printField('IdentityRegistry', identityRegistryAddress);
  printField('Agent key src', agentKey.source);
  printField('Provider src', providerKey.source);

  const registerTx = await agentWalletClient.writeContract({
    address: identityRegistryAddress,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'register',
    args: [
      resolvePreferredEnvValue(
        'PROGRAMMABLE_SECRETS_AGENT_URI',
        ['DEMO_AGENT_URI'],
        'https://hol.org/agents/volatility-trading-agent-custodian',
      ).value,
    ],
    chain,
    account: agentWalletClient.account,
  });
  const registerReceipt = await publicClient.waitForTransactionReceipt({
    hash: registerTx,
  });
  const registeredEvent = await decodeIndexedEvent({
    abi: IDENTITY_REGISTRY_ABI,
    receipt: registerReceipt,
    eventName: 'Registered',
  });
  const agentId = Number(registeredEvent.args.agentId);
  const buyerUaid = buildBuyerUaid({
    chainId: chain.id,
    agentId,
  });

  printStep(1, `Registered ERC-8004 agent #${agentId}`);
  printField('UAID', buyerUaid);
  printField('Register tx', registerTx);
  printExplorerLink(chain, registerTx);

  const result = await runUaidPolicyFlow({
    networkId,
    chain,
    agentWalletClient,
    providerWalletClient,
    accessReceiptAddress,
    identityRegistryAddress,
    buyerUaid,
    agentId,
    datasetTitle: 'UAID Gated Volatility Dataset',
  });

  printStep(2, `Created gated dataset #${result.datasetId} and policy #${result.policyId}`);
  printField('Dataset tx', result.datasetTx);
  printExplorerLink(chain, result.datasetTx);
  printField('Policy tx', result.createPolicyTx);
  printExplorerLink(chain, result.createPolicyTx);
  printField('Price', `${formatEther(result.priceWei)} ETH`);

  printStep(3, 'Purchased policy and unlocked payload');
  printField('Purchase tx', result.purchaseTx);
  printExplorerLink(chain, result.purchaseTx);
  printField('Receipt token', result.receiptTokenId);
  printField('Has access', result.hasAccess);
  printField('Receipt buyer', result.receipt.buyer);
  printField('Receipt policy', result.receipt.policyId);
  printField('Decrypted bytes', Buffer.byteLength(result.decryptedPlaintext, 'utf8'));
  if (CLI_RUNTIME.json) {
    emitResult('flow-direct', {
      datasetId: result.datasetId,
      decryptedPlaintext: result.decryptedPlaintext,
      hasAccess: result.hasAccess,
      network: chain.name,
      policyId: result.policyId,
      purchaseTx: result.purchaseTx,
      receipt: serializeReceipt(result.receiptTokenId, result.receipt),
      registerTx,
    });
    return;
  }
  console.log(result.decryptedPlaintext);
  printSuccess('Direct identity flow completed.');
}

async function demoBrokerUaidFlow() {
  const networkId = getSelectedNetworkId();
  const chain = getSelectedChain(networkId);
  const agentKey = requireEnvValue('ETH_PK', {
    description: 'agent wallet private key',
  });
  const providerKey = requireEnvValue('ETH_PK_2', {
    description: 'provider wallet private key',
  });
  const agentWalletClient = getWalletClient({
    privateKey: agentKey.value,
    chain,
  });
  const providerWalletClient = getWalletClient({
    privateKey: providerKey.value,
    chain,
  });
  const accessReceiptAddress = buildAccessReceiptAddress(networkId);
  const identityRegistryAddress = requireIdentityRegistryAddress(networkId);

  printHeading('Broker-backed Identity Flow');
  printField('Network', chain.name);
  printField('Agent wallet', agentWalletClient.account.address);
  printField('Provider wallet', providerWalletClient.account.address);
  printField('Agent key src', agentKey.source);
  printField('Provider src', providerKey.source);

  const brokerRegistration = await registerBrokerBackedAgent();

  try {
    printStep(1, `Registered agent in Registry Broker and linked ${chain.name}`);
    printField('Broker URL', brokerRegistration.baseUrl);
    printField('Broker acct', brokerRegistration.accountId);
    printField('HOL UAID', brokerRegistration.brokerUaid);
    printField('Broker agent', brokerRegistration.brokerAgentId);
    printField('ERC-8004 key', brokerRegistration.erc8004RegistryKey);
    printField('ERC-8004 agent', brokerRegistration.erc8004AgentId);

    const result = await runUaidPolicyFlow({
      networkId,
      chain,
      agentWalletClient,
      providerWalletClient,
      accessReceiptAddress,
      identityRegistryAddress,
      buyerUaid: brokerRegistration.brokerUaid,
      agentId: parseErc8004AgentId(brokerRegistration.erc8004AgentId),
      datasetTitle: 'Broker-issued UAID Volatility Dataset',
    });

    printStep(2, `Created gated dataset #${result.datasetId} and policy #${result.policyId}`);
    printField('Dataset tx', result.datasetTx);
    printExplorerLink(chain, result.datasetTx);
    printField('Policy tx', result.createPolicyTx);
    printExplorerLink(chain, result.createPolicyTx);

    printStep(3, 'Purchased policy with the broker-issued UAID');
    printField('Purchase tx', result.purchaseTx);
    printExplorerLink(chain, result.purchaseTx);
    printField('Receipt token', result.receiptTokenId);
    printField('Has access', result.hasAccess);
    printField('Receipt buyer', result.receipt.buyer);
    printField('Receipt policy', result.receipt.policyId);
    if (CLI_RUNTIME.json) {
      emitResult('flow-broker', {
        brokerAgentId: brokerRegistration.brokerAgentId,
        brokerUaid: brokerRegistration.brokerUaid,
        datasetId: result.datasetId,
        decryptedPlaintext: result.decryptedPlaintext,
        erc8004AgentId: brokerRegistration.erc8004AgentId,
        hasAccess: result.hasAccess,
        network: chain.name,
        policyId: result.policyId,
        purchaseTx: result.purchaseTx,
        receipt: serializeReceipt(result.receiptTokenId, result.receipt),
      });
      return;
    }
    console.log(result.decryptedPlaintext);
    printSuccess('Broker-backed identity flow completed.');
  } finally {
    await brokerRegistration.localAgentHandle.stop();
  }
}

async function runDatasetsCommand(tokens) {
  const { positionals, options } = parseCliArgs(tokens);
  const subcommand = positionals[0] || 'list';
  await completeInteractiveOptions('datasets', subcommand, options);
  switch (subcommand) {
    case 'list':
      await listDatasetsCommand(options);
      return;
    case 'get':
      await getDatasetCommand(options);
      return;
    case 'export':
      await exportDatasetCommand(options);
      return;
    case 'import':
      await importDatasetCommand(options);
      return;
    case 'register':
      await registerDatasetCommand(options);
      return;
    case 'set-active':
      await setDatasetActiveCommand(options);
      return;
    default:
      throw new CliError(
        'UNKNOWN_SUBCOMMAND',
        `Unknown datasets command "${subcommand}".`,
        `See "${CLI_COMMAND} help datasets".`,
      );
  }
}

async function runPoliciesCommand(tokens) {
  const { positionals, options } = parseCliArgs(tokens);
  const subcommand = positionals[0] || 'list';
  await completeInteractiveOptions('policies', subcommand, options);
  switch (subcommand) {
    case 'list':
      await listPoliciesCommand(options);
      return;
    case 'get':
      await getPolicyCommand(options);
      return;
    case 'export':
      await exportPolicyCommand(options);
      return;
    case 'import':
      await importPolicyCommand(options);
      return;
    case 'create-timebound':
      await createTimeboundPolicyCommand(options);
      return;
    case 'create-uaid':
      await createUaidPolicyCommand(options);
      return;
    case 'update':
      await updatePolicyCommand(options);
      return;
    case 'allowlist':
      await setPolicyAllowlistCommand(options);
      return;
    default:
      throw new CliError(
        'UNKNOWN_SUBCOMMAND',
        `Unknown policies command "${subcommand}".`,
        `See "${CLI_COMMAND} help policies".`,
      );
  }
}

async function runAccessCommand(tokens) {
  const { positionals, options } = parseCliArgs(tokens);
  const subcommand = positionals[0] || 'policy';
  switch (subcommand) {
    case 'policy':
      await accessPolicyCommand(options);
      return;
    case 'dataset':
      await accessDatasetCommand(options);
      return;
    case 'receipt-policy':
      await receiptByPolicyCommand(options);
      return;
    case 'receipt-dataset':
      await receiptByDatasetCommand(options);
      return;
    default:
      throw new CliError(
        'UNKNOWN_SUBCOMMAND',
        `Unknown access command "${subcommand}".`,
        `See "${CLI_COMMAND} help access".`,
      );
  }
}

async function runReceiptsCommand(tokens) {
  const { positionals, options } = parseCliArgs(tokens);
  const subcommand = positionals[0] || 'get';
  switch (subcommand) {
    case 'get':
      await getReceiptCommand(options);
      return;
    default:
      throw new CliError(
        'UNKNOWN_SUBCOMMAND',
        `Unknown receipts command "${subcommand}".`,
        `See "${CLI_COMMAND} help receipts".`,
      );
  }
}

async function runIdentityCommand(tokens) {
  const { positionals, options } = parseCliArgs(tokens);
  const subcommand = positionals[0] || 'register';
  await completeInteractiveOptions('identity', subcommand, options);
  switch (subcommand) {
    case 'register':
      await registerIdentityCommand(options);
      return;
    default:
      throw new CliError(
        'UNKNOWN_SUBCOMMAND',
        `Unknown identity command "${subcommand}".`,
        `See "${CLI_COMMAND} help identity".`,
      );
  }
}

async function runKrsCommand(tokens) {
  const { positionals, options } = parseCliArgs(tokens);
  const subcommand = positionals[0] || 'encrypt';
  await completeInteractiveOptions('krs', subcommand, options);
  switch (subcommand) {
    case 'encrypt':
      await encryptBundleCommand(options);
      return;
    case 'decrypt':
      await decryptBundleCommand(options);
      return;
    case 'verify':
      await verifyBundleCommand(options);
      return;
    default:
      throw new CliError(
        'UNKNOWN_SUBCOMMAND',
        `Unknown krs command "${subcommand}".`,
        `See "${CLI_COMMAND} help krs".`,
      );
  }
}

async function dispatchCommand(commandName, tokens, forcePreview = false) {
  const effectiveTokens = forcePreview && !tokens.includes('--preview') ? [...tokens, '--preview'] : tokens;
  const parsed = parseCliArgs(effectiveTokens);
  if (forcePreview) {
    parsed.options.preview = true;
  }

  switch (commandName) {
    case 'start':
      await runStart();
      return;
    case 'doctor':
      await runDoctor();
      return;
    case 'init':
      await runInitCommand(parsed.options);
      return;
    case 'env-bootstrap':
      writeBootstrapEnvFile();
      return;
    case 'list':
      await listPolicies();
      return;
    case 'deactivate-all':
      await deactivateAll();
      return;
    case 'update-prices':
      await updatePrices();
      return;
    case 'flow:direct':
      await demoUaidFlow();
      return;
    case 'flow:broker':
      await demoBrokerUaidFlow();
      return;
    case 'contracts':
      await showContracts(parsed.options);
      return;
    case 'datasets':
      await runDatasetsCommand(effectiveTokens);
      return;
    case 'policies':
      await runPoliciesCommand(effectiveTokens);
      return;
    case 'purchase':
      await completeInteractiveOptions('purchase', null, parsed.options);
      await purchasePolicyCommand(parsed.options);
      return;
    case 'access':
      await runAccessCommand(effectiveTokens);
      return;
    case 'receipts':
      await runReceiptsCommand(effectiveTokens);
      return;
    case 'identity':
      await runIdentityCommand(effectiveTokens);
      return;
    case 'profiles':
      await runProfilesCommand(effectiveTokens);
      return;
    case 'templates':
      await runTemplatesCommand(effectiveTokens);
      return;
    case 'completions':
      await runCompletionsCommand(effectiveTokens);
      return;
    case 'krs':
      await runKrsCommand(effectiveTokens);
      return;
    case 'help':
      showHelp(parsed.positionals[0] || null);
      return;
    default:
      throw new CliError(
        'UNKNOWN_COMMAND',
        `Unknown command: ${commandName}`,
        `Run "${CLI_COMMAND} help".`,
      );
  }
}

// ── CLI ──
const rawArgs = process.argv.slice(2).filter((value) => value !== '--');
const command = rawArgs[0] || 'start';
const commandArgs = rawArgs.slice(1);
const globalOptions = parseCliArgs(rawArgs).options;
initializeRuntime(globalOptions, command);

try {
  if (command === 'preview' || command === 'explain') {
    const previewCommand = commandArgs[0];
    if (!previewCommand) {
      throw new CliError(
        'MISSING_OPTION',
        `Missing command after ${command}.`,
        `Use "${CLI_COMMAND} ${command} purchase --policy-id 1".`,
      );
    }
    await dispatchCommand(previewCommand, commandArgs.slice(1), true);
  } else {
    await dispatchCommand(command, commandArgs);
  }
} catch (error) {
  const normalized = error instanceof CliError
    ? error
    : new CliError('UNEXPECTED_ERROR', error instanceof Error ? error.message : `${error}`);
  if (CLI_RUNTIME.json) {
    emitJson({
      code: normalized.code,
      details: normalized.details || null,
      error: normalized.message,
      remediation: normalized.remediation || null,
      timestamp: new Date().toISOString(),
    });
  } else {
    console.error(`\n[error] ${normalized.code}: ${normalized.message}`);
    if (normalized.remediation) {
      console.error(`[hint] ${normalized.remediation}`);
    }
  }
  process.exitCode = 1;
}
