import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAbi } from 'viem';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

export const PACKAGE_ROOT = resolve(SCRIPT_DIR, '..', '..');
export const DEPLOYMENT_FILES = {
  'robinhood-testnet': resolve(PACKAGE_ROOT, 'deployments/robinhood-testnet.json'),
  'arbitrum-sepolia': resolve(PACKAGE_ROOT, 'deployments/arbitrum-sepolia.json'),
};
export const ENV_PATH_CANDIDATES = [
  process.env.PROGRAMMABLE_SECRETS_ENV_PATH?.trim() || null,
  resolve(PACKAGE_ROOT, '.env.local'),
  resolve(PACKAGE_ROOT, '.env'),
].filter(Boolean);
export const DEFAULT_REGISTRY_BROKER_BASE_URL = 'https://hol.org/registry/api/v1';
export const DEFAULT_REGISTRY_BROKER_API_KEY = '';
export const DEFAULT_NETWORK_ID = 'robinhood-testnet';
export const DEFAULT_REGISTRY_NAMESPACE = 'hashgraph-online';
export const DEFAULT_COMMUNICATION_PROTOCOL = 'a2a';
export const CLI_COMMAND = 'programmable-secret';
export const CLI_ALIAS = 'programmable-secrets';
export const CLI_CONFIG_DIR = resolve(homedir(), '.config', CLI_COMMAND);
export const CLI_CONFIG_PATH = resolve(CLI_CONFIG_DIR, 'config.json');
export const DEFAULT_ENV_OUTPUT_PATH = resolve(
  process.env.PROGRAMMABLE_SECRETS_ENV_OUTPUT_PATH?.trim() || resolve(PACKAGE_ROOT, '.env.local'),
);
export const DEFAULT_DOCKER_CONTAINERS = ['registry-broker-registry-broker-1'];
export const DOCKER_ENV_ALIASES = {
  REGISTRY_BROKER_API_KEY: ['API_KEYS'],
  REGISTRY_BROKER_ACCOUNT_ID: ['ETH_ACCOUNT_ID'],
};
export const TEMPLATE_REGISTRY = {
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
export const COMMAND_TREE = {
  access: ['dataset', 'policy', 'receipt-dataset', 'receipt-policy'],
  contracts: [],
  datasets: ['export', 'get', 'import', 'list', 'register', 'set-active'],
  doctor: [],
  'env-bootstrap': [],
  examples: ['list', 'show'],
  'flow:broker': [],
  'flow:direct': [],
  'flow:uaid': [],
  evaluators: ['get', 'list'],
  help: [],
  identity: ['register'],
  init: [],
  krs: ['decrypt', 'encrypt', 'verify'],
  preview: [],
  profiles: ['init', 'list', 'show'],
  policies: ['allowlist', 'create-uaid', 'create-timebound', 'evaluators', 'export', 'get', 'import', 'list', 'update'],
  purchase: [],
  receipts: ['get'],
  start: [],
  templates: ['list', 'show', 'write'],
  completions: ['bash', 'fish', 'zsh'],
};

export const robinhoodTestnet = {
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com/rpc'] } },
  explorerBaseUrl: 'https://explorer.testnet.chain.robinhood.com',
};

export const arbitrumSepolia = {
  id: 421614,
  name: 'Arbitrum Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://sepolia-rollup.arbitrum.io/rpc'] } },
  explorerBaseUrl: 'https://sepolia.arbiscan.io',
};

export const SUPPORTED_NETWORKS = {
  'arbitrum-sepolia': arbitrumSepolia,
  'robinhood-testnet': robinhoodTestnet,
};
export const NETWORK_ALIASES = {
  arbitrum: 'arbitrum-sepolia',
  'erc-8004:arbitrum-sepolia': 'arbitrum-sepolia',
  robinhood: 'robinhood-testnet',
  testnet: 'robinhood-testnet',
  'erc-8004:robinhood-testnet': 'robinhood-testnet',
  'erc-8004:testnet': 'robinhood-testnet',
};

export const POLICY_VAULT_ABI = parseAbi([
  'function registerPolicyEvaluator(address evaluator,bytes32 metadataHash) payable',
  'function registerDataset(bytes32 ciphertextHash,bytes32 keyCommitment,bytes32 metadataHash,bytes32 providerUaidHash) returns (uint256 datasetId)',
  'function setDatasetActive(uint256 datasetId,bool active)',
  'function datasetCount() view returns (uint256)',
  'function policyCount() view returns (uint256)',
  'function getPolicy(uint256 policyId) view returns ((address provider,address payout,address paymentToken,uint96 price,uint64 createdAt,bool active,bool receiptTransferable,bool allowlistEnabled,bytes32 ciphertextHash,bytes32 keyCommitment,bytes32 metadataHash,bytes32 providerUaidHash,uint256 datasetId,bytes32 conditionsHash,uint32 conditionCount))',
  'function getDataset(uint256 datasetId) view returns ((address provider,uint64 createdAt,bool active,bytes32 ciphertextHash,bytes32 keyCommitment,bytes32 metadataHash,bytes32 providerUaidHash))',
  'function getDatasetPolicyCount(uint256 datasetId) view returns (uint256)',
  'function getDatasetPolicyIdAt(uint256 datasetId,uint256 index) view returns (uint256)',
  'function getDatasetPolicyIds(uint256 datasetId) view returns (uint256[])',
  'function createPolicyForDataset(uint256 datasetId,address payout,address paymentToken,uint96 price,bool receiptTransferable,bytes32 metadataHash,(address evaluator,bytes configData)[] conditions) returns (uint256 policyId)',
  'function updatePolicy(uint256 policyId,uint96 newPrice,bool active,bytes32 newMetadataHash)',
  'function getPolicyConditionCount(uint256 policyId) view returns (uint256)',
  'function getPolicyCondition(uint256 policyId,uint256 index) view returns (address evaluator,bytes configData,bytes32 configHash)',
  'function getPolicyEvaluator(address evaluator) view returns ((address registrant,bytes32 metadataHash,uint64 registeredAt,bool active,bool builtIn))',
  'function getPolicyEvaluatorCount() view returns (uint256)',
  'function getPolicyEvaluatorAt(uint256 index) view returns (address evaluator)',
  'function evaluatorRegistrationFee() view returns (uint256)',
  'function evaluatorFeeRecipient() view returns (address)',
  'event PolicyEvaluatorRegistered(address indexed evaluator,address indexed registrant,bytes32 metadataHash,uint64 registeredAt,bool builtIn)',
  'event DatasetRegistered(uint256 indexed datasetId,address indexed provider,bytes32 ciphertextHash,bytes32 keyCommitment,bytes32 metadataHash,bytes32 providerUaidHash)',
  'event DatasetStatusUpdated(uint256 indexed datasetId,bool active)',
  'event PolicyCreated(uint256 indexed policyId,uint256 indexed datasetId,address indexed provider,address payout,address paymentToken,uint256 price,bool receiptTransferable,bytes32 conditionsHash,uint32 conditionCount,bytes32 metadataHash,bytes32 datasetMetadataHash)',
  'event PolicyUpdated(uint256 indexed policyId,uint256 indexed datasetId,uint256 newPrice,bool active,bytes32 newMetadataHash)',
]);

export const PAYMENT_MODULE_ABI = parseAbi([
  'function purchase(uint256 policyId,address recipient,bytes[] conditionRuntimeInputs) payable returns (uint256 receiptTokenId)',
  'function hasAccess(uint256 policyId,address buyer) view returns (bool)',
  'function hasDatasetAccess(uint256 datasetId,address buyer) view returns (bool)',
  'function receiptOfPolicyAndBuyer(uint256 policyId,address buyer) view returns (uint256)',
]);

export const ACCESS_RECEIPT_ABI = parseAbi([
  'function hasAccess(uint256 policyId,address buyer) view returns (bool)',
  'function receiptOfPolicyAndBuyer(uint256 policyId,address buyer) view returns (uint256)',
  'function receiptOfPolicyAndHolder(uint256 policyId,address holder) view returns (uint256)',
  'function receiptOfDatasetAndBuyer(uint256 datasetId,address buyer) view returns (uint256)',
  'function receiptOfDatasetAndHolder(uint256 datasetId,address holder) view returns (uint256)',
  'function getReceipt(uint256 receiptTokenId) view returns ((uint256 policyId,uint256 datasetId,address buyer,address recipient,address paymentToken,uint96 price,uint64 purchasedAt,bool receiptTransferable,bytes32 ciphertextHash,bytes32 keyCommitment))',
]);

export const IDENTITY_REGISTRY_ABI = parseAbi([
  'function register(string agentURI) returns (uint256 agentId)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'event Registered(uint256 indexed agentId,string agentURI,address indexed owner)',
]);
