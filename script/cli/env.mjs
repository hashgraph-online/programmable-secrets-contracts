import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';
import {
  CLI_COMMAND,
  DEFAULT_DOCKER_CONTAINERS,
  DEFAULT_ENV_OUTPUT_PATH,
  DEFAULT_NETWORK_ID,
  DEFAULT_REGISTRY_BROKER_API_KEY,
  DEFAULT_REGISTRY_BROKER_BASE_URL,
  DOCKER_ENV_ALIASES,
  ENV_PATH_CANDIDATES,
} from './constants.mjs';
import { CliError } from './errors.mjs';
import { printInfo, printSuccess, printWarning } from './output.mjs';

const RUNTIME_ENV_CACHE = new Map();

function runProcess(command, args) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function resolveDockerContainer() {
  const cached = RUNTIME_ENV_CACHE.get('docker-container');
  if (cached !== undefined) {
    return cached;
  }
  for (const containerName of DEFAULT_DOCKER_CONTAINERS) {
    const result = runProcess('docker', ['ps', '--format', '{{.Names}}']);
    if (result.status !== 0) {
      break;
    }
    const names = result.stdout.split('\n').map((value) => value.trim()).filter(Boolean);
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

export function resolveEnvValue(name, fallback = null) {
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

export function resolvePreferredEnvValue(primaryName, legacyNames = [], fallback = null) {
  for (const name of [primaryName, ...legacyNames]) {
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

export function requireEnvValue(name, options = {}) {
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

export function normalizePrivateKey(value, label) {
  if (!value) {
    throw new CliError('MISSING_PRIVATE_KEY', `${label} is required.`);
  }
  return value.startsWith('0x') ? value : `0x${value}`;
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
    REGISTRY_BROKER_ERC8004_NETWORK: resolveEnvValue('REGISTRY_BROKER_ERC8004_NETWORK', `erc-8004:${DEFAULT_NETWORK_ID}`).value,
    PROGRAMMABLE_SECRETS_NETWORK: resolvePreferredEnvValue('PROGRAMMABLE_SECRETS_NETWORK', ['DEMO_ERC8004_NETWORK'], DEFAULT_NETWORK_ID).value,
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
    PROGRAMMABLE_SECRETS_PRICE_WEI: resolvePreferredEnvValue('PROGRAMMABLE_SECRETS_PRICE_WEI', ['DEMO_PRICE_WEI'], '10000000000000').value,
  };
}

export function writeBootstrapEnvFile() {
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
