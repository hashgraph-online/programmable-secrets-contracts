#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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
const DEFAULT_ENV_OUTPUT_PATH = resolve(
  process.env.PROGRAMMABLE_SECRETS_ENV_OUTPUT_PATH?.trim() || resolve(PACKAGE_ROOT, '.env.local'),
);
const DEFAULT_DOCKER_CONTAINERS = ['registry-broker-registry-broker-1'];
const RUNTIME_ENV_CACHE = new Map();
const DOCKER_ENV_ALIASES = {
  REGISTRY_BROKER_API_KEY: ['API_KEYS'],
  REGISTRY_BROKER_ACCOUNT_ID: ['ETH_ACCOUNT_ID'],
};

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
    throw new Error(`Unsupported deployment network: ${network}`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function printHeading(title) {
  console.log(`\n=== ${title} ===`);
}

function printField(label, value) {
  console.log(`${label.padEnd(16)} ${value}`);
}

function printExplorerLink(chain, hash) {
  if (!chain?.explorerBaseUrl) {
    return;
  }
  printField('Explorer', `${chain.explorerBaseUrl}/tx/${hash}`);
}

function printStep(stepNumber, title) {
  console.log(`\n[${stepNumber}] ${title}`);
}

function printSuccess(message) {
  console.log(`\n[ok] ${message}`);
}

function printWarning(message) {
  console.log(`\n[warn] ${message}`);
}

function printInfo(message) {
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
  return fallback;
}

function requireOption(options, names, description) {
  const value = readOption(options, names);
  if (value !== null) {
    return value;
  }
  const label = Array.isArray(names) ? names.join(' or ') : names;
  throw new Error(`Missing ${description}. Provide --${label}.`);
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
  throw new Error(`Invalid boolean value "${value}". Expected true/false.`);
}

function parseBigIntValue(value, description) {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`Invalid ${description}: "${value}"`);
  }
}

function parseUintValue(value, description) {
  const parsed = Number.parseInt(`${value}`.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${description}: "${value}"`);
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
  throw new Error(`Invalid ${description}. Expected a 32-byte hex string.`);
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

  throw new Error(
    `Missing ${config.description}. Provide ${config.example}.`,
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
      throw new Error(`Invalid price-eth: "${priceEth}"`);
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
      throw new Error(`Invalid expires-at-iso: "${explicitIso}"`);
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
    throw new Error(`Invalid wallet role "${role}". Expected agent or provider.`);
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

function showCommandTopic(topic) {
  switch (topic) {
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
    case 'datasets':
      printHeading('datasets');
      printCommandUsage([
        `List datasets: ${CLI_COMMAND} datasets list [--network robinhood-testnet]`,
        `Read dataset: ${CLI_COMMAND} datasets get --dataset-id 1`,
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
  printHeading('Programmable Secrets CLI');
  console.log(`Usage: ${CLI_COMMAND} <command>`);
  console.log(`Alias: ${CLI_ALIAS} <command>`);
  console.log('Local wrapper: pnpm run cli -- <command>');
  console.log('');
  console.log('Golden path:');
  console.log(`  1. ${CLI_COMMAND} start`);
  console.log(`  2. ${CLI_COMMAND} doctor`);
  console.log(`  3. ${CLI_COMMAND} flow:direct`);
  console.log(`  4. ${CLI_COMMAND} flow:broker`);
  console.log('');
  console.log('Guided commands:');
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
  console.log('');
  console.log('Legacy repo helpers:');
  console.log('  pnpm run policies:list');
  console.log('  pnpm run policies:deactivate-all');
  console.log('  pnpm run policies:update-prices');
  console.log('');
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
  throw new Error(
    `Missing ${description} (${name}). Checked process env and ${envPaths}${dockerHint}. Run "pnpm run env:bootstrap" or populate .env.local manually.`,
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
  printField('PolicyVault', policyVaultAddress);
  printField('PaymentModule', paymentModuleAddress);
  printField('AccessReceipt', accessReceiptAddress);

  const publicClient = getPublicClient(chain);
  const policyCount = await publicClient.readContract({
    address: policyVaultAddress,
    abi: POLICY_VAULT_ABI,
    functionName: 'policyCount',
  });
  printField('policyCount', `${policyCount}`);

  const receiptPaymentModule = await publicClient.readContract({
    address: accessReceiptAddress,
    abi: parseAbi(['function paymentModule() view returns (address)']),
    functionName: 'paymentModule',
  });
  printField('Receipt wiring', receiptPaymentModule);

  const brokerBaseUrl = resolveEnvValue('REGISTRY_BROKER_BASE_URL', DEFAULT_REGISTRY_BROKER_BASE_URL).value;
  try {
    const response = await fetch(`${brokerBaseUrl}/health`);
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
  printHeading('Programmable Secrets Start');
  printField('Network', chain.name);
  printField('PolicyVault', buildPolicyVaultAddress(networkId));
  printField('PaymentModule', buildPaymentModuleAddress(networkId));
  printField('AccessReceipt', buildAccessReceiptAddress(networkId));

  const agentKey = resolveEnvValue('ETH_PK');
  const providerKey = resolveEnvValue('ETH_PK_2');
  const dockerContainer = resolveDockerContainer();
  printField('Agent key', agentKey.value ? `ready via ${agentKey.source}` : 'missing');
  printField('Provider key', providerKey.value ? `ready via ${providerKey.source}` : 'missing');
  printField('Docker', dockerContainer || 'not found');

  if (!agentKey.value || !providerKey.value) {
    printWarning('Operator keys are missing.');
    console.log(`Recommended next step: ${CLI_COMMAND} env-bootstrap`);
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
    throw new Error(`${label} is required.`);
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
  const requestedNetworkId =
    resolvePreferredEnvValue('PROGRAMMABLE_SECRETS_NETWORK', ['DEMO_ERC8004_NETWORK'], DEFAULT_NETWORK_ID).value;
  const normalizedNetworkId = NETWORK_ALIASES[requestedNetworkId] || requestedNetworkId;
  if (!(normalizedNetworkId in SUPPORTED_NETWORKS)) {
    throw new Error(
      `Unsupported PROGRAMMABLE_SECRETS_NETWORK "${requestedNetworkId}". Expected one of: ${Object.keys(
        SUPPORTED_NETWORKS,
      ).join(', ')}`,
    );
  }
  return normalizedNetworkId;
}

function getSelectedChain(networkId) {
  return SUPPORTED_NETWORKS[networkId];
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
    throw new Error(
      `No ERC-8004 IdentityRegistry is configured for ${network}. Update deployments/${network}.json or switch PROGRAMMABLE_SECRETS_NETWORK.`,
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
    throw new Error('ERC-8004 agent id is required');
  }
  const candidate = trimmed.includes(':')
    ? trimmed.slice(trimmed.lastIndexOf(':') + 1)
    : trimmed;
  const parsed = Number.parseInt(candidate, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Unable to parse ERC-8004 agent id from "${trimmed}"`);
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
    throw new Error(`Expected ${eventName} event was not found`);
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
    throw new Error(
      `Registry Broker does not expose ${registryKey}. ${availableText} Update the local registry-broker configuration or switch PROGRAMMABLE_SECRETS_NETWORK to a supported chain.`,
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
      throw new Error(`Registry Broker registration did not return an ERC-8004 agent id for ${registryKey}.`);
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
    throw new Error(`Unsupported network "${requested}". Expected ${Object.keys(SUPPORTED_NETWORKS).join(', ')}.`);
  }
  return normalized;
}

function getChainFromOptions(options) {
  return getSelectedChain(getNetworkIdFromOptions(options));
}

async function showContracts(options) {
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  printHeading(`Contracts on ${chain.name}`);
  printField('PolicyVault', buildPolicyVaultAddress(networkId));
  printField('PaymentModule', buildPaymentModuleAddress(networkId));
  printField('AccessReceipt', buildAccessReceiptAddress(networkId));
  printField('Identity reg', buildIdentityRegistryAddress(networkId));
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
    console.log('');
    printDatasetSummary(datasetId, dataset);
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

  printHeading('Dataset Registered');
  printField('Dataset', event.args.datasetId);
  printField('Provider', walletClient.account.address);
  printField('Tx', hash);
  printExplorerLink(chain, hash);
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
  const hash = await walletClient.writeContract({
    address: buildPolicyVaultAddress(networkId),
    abi: POLICY_VAULT_ABI,
    functionName: 'setDatasetActive',
    args: [datasetId, active],
    chain,
    account: walletClient.account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  printHeading('Dataset State Updated');
  printField('Dataset', datasetId);
  printField('Active', active);
  printField('Tx', hash);
  printExplorerLink(chain, hash);
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
    console.log('');
    printPolicySummary(policyId, policy);
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
  printHeading('Timebound Policy Created');
  printField('Policy', event.args.policyId);
  printField('Dataset', event.args.datasetId);
  printField('Tx', hash);
  printExplorerLink(chain, hash);
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
  printHeading('UAID Policy Created');
  printField('Policy', event.args.policyId);
  printField('Dataset', event.args.datasetId);
  printField('Tx', hash);
  printExplorerLink(chain, hash);
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

  const hash = await walletClient.writeContract({
    address: buildPolicyVaultAddress(networkId),
    abi: POLICY_VAULT_ABI,
    functionName: 'updatePolicy',
    args: [policyId, nextPrice, nextExpiry, active, allowlistEnabled, metadataHash],
    chain,
    account: walletClient.account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  printHeading('Policy Updated');
  printField('Policy', policyId);
  printField('Tx', hash);
  printExplorerLink(chain, hash);
}

async function setPolicyAllowlistCommand(options) {
  const policyId = parseBigIntValue(requireOption(options, 'policy-id', 'policy id'), 'policy-id');
  const accounts = resolveAllowlistAccounts(options);
  const allowed = parseBooleanOption(requireOption(options, 'allowed', 'allowlist state'));
  if (accounts.length === 0) {
    throw new Error('Provide at least one account with --accounts.');
  }
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const walletClient = getWalletClientForRole({
    role: resolveSelectedWalletRole(options, 'provider'),
    chain,
  });
  const publicClient = getPublicClient(chain);
  const hash = await walletClient.writeContract({
    address: buildPolicyVaultAddress(networkId),
    abi: POLICY_VAULT_ABI,
    functionName: 'setAllowlist',
    args: [policyId, accounts, allowed],
    chain,
    account: walletClient.account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  printHeading('Policy Allowlist Updated');
  printField('Policy', policyId);
  printField('Allowed', allowed);
  printField('Accounts', accounts.join(', '));
  printField('Tx', hash);
  printExplorerLink(chain, hash);
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
  printHeading('Policy Purchased');
  printField('Policy', policyId);
  printField('Receipt', receiptTokenId);
  printField('Price', `${formatEther(policy.price)} ETH (${policy.price} wei)`);
  printField('Tx', hash);
  printExplorerLink(chain, hash);
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
    throw new Error(`No identity registry configured for ${networkId}. Provide --identity-registry.`);
  }
  const walletClient = getWalletClientForRole({
    role: resolveSelectedWalletRole(options, 'agent'),
    chain,
  });
  const publicClient = getPublicClient(chain);
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
  printHeading('Identity Registered');
  printField('Agent id', event.args.agentId);
  printField('Owner', walletClient.account.address);
  printField('Tx', hash);
  printExplorerLink(chain, hash);
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
    console.log(result.decryptedPlaintext);
    printSuccess('Broker-backed identity flow completed.');
  } finally {
    await brokerRegistration.localAgentHandle.stop();
  }
}

async function runDatasetsCommand(tokens) {
  const { positionals, options } = parseCliArgs(tokens);
  const subcommand = positionals[0] || 'list';
  switch (subcommand) {
    case 'list':
      await listDatasetsCommand(options);
      return;
    case 'get':
      await getDatasetCommand(options);
      return;
    case 'register':
      await registerDatasetCommand(options);
      return;
    case 'set-active':
      await setDatasetActiveCommand(options);
      return;
    default:
      throw new Error(`Unknown datasets command "${subcommand}". See "${CLI_COMMAND} help datasets".`);
  }
}

async function runPoliciesCommand(tokens) {
  const { positionals, options } = parseCliArgs(tokens);
  const subcommand = positionals[0] || 'list';
  switch (subcommand) {
    case 'list':
      await listPoliciesCommand(options);
      return;
    case 'get':
      await getPolicyCommand(options);
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
      throw new Error(`Unknown policies command "${subcommand}". See "${CLI_COMMAND} help policies".`);
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
      throw new Error(`Unknown access command "${subcommand}". See "${CLI_COMMAND} help access".`);
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
      throw new Error(`Unknown receipts command "${subcommand}". See "${CLI_COMMAND} help receipts".`);
  }
}

async function runIdentityCommand(tokens) {
  const { positionals, options } = parseCliArgs(tokens);
  const subcommand = positionals[0] || 'register';
  switch (subcommand) {
    case 'register':
      await registerIdentityCommand(options);
      return;
    default:
      throw new Error(`Unknown identity command "${subcommand}". See "${CLI_COMMAND} help identity".`);
  }
}

// ── CLI ──
const rawArgs = process.argv.slice(2).filter((value) => value !== '--');
const command = rawArgs[0] || 'start';
const commandArgs = rawArgs.slice(1);
const commandArg = commandArgs[0] || null;

switch (command) {
  case 'start':
    await runStart();
    break;
  case 'doctor':
    await runDoctor();
    break;
  case 'env-bootstrap':
    writeBootstrapEnvFile();
    break;
  case 'list':
    await listPolicies();
    break;
  case 'deactivate-all':
    await deactivateAll();
    break;
  case 'update-prices':
    await updatePrices();
    break;
  case 'flow:direct':
    await demoUaidFlow();
    break;
  case 'flow:broker':
    await demoBrokerUaidFlow();
    break;
  case 'contracts':
    await showContracts(parseCliArgs(commandArgs).options);
    break;
  case 'datasets':
    await runDatasetsCommand(commandArgs);
    break;
  case 'policies':
    await runPoliciesCommand(commandArgs);
    break;
  case 'purchase':
    await purchasePolicyCommand(parseCliArgs(commandArgs).options);
    break;
  case 'access':
    await runAccessCommand(commandArgs);
    break;
  case 'receipts':
    await runReceiptsCommand(commandArgs);
    break;
  case 'identity':
    await runIdentityCommand(commandArgs);
    break;
  case 'help':
    showHelp(commandArg);
    break;
  default:
    console.log(`Unknown command: ${command}`);
    showHelp();
}
