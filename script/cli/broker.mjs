import { getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  AIAgentCapability,
  AIAgentType,
  ProfileType,
  RegistryBrokerClient,
} from './registry-broker-client.mjs';
import {
  CLI_COMMAND,
  DEFAULT_COMMUNICATION_PROTOCOL,
  DEFAULT_REGISTRY_NAMESPACE,
} from './constants.mjs';
import { CliError } from './errors.mjs';
import { requireEnvValue, resolveEnvValue, resolvePreferredEnvValue } from './env.mjs';
import { printWarning } from './output.mjs';
import { getSelectedNetworkId, parseErc8004AgentId } from './chain.mjs';

const NOOP_AGENT_HANDLE = {
  async stop() {},
};

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
      capabilities: [AIAgentCapability.TEXT_GENERATION, AIAgentCapability.WORKFLOW_AUTOMATION],
      creator: 'programmable-secrets-contracts',
    },
  };
}

function findAdditionalRegistryResult(entries, registryKey) {
  if (!Array.isArray(entries)) {
    return null;
  }
  return entries.find((entry) => entry?.registryKey === registryKey)
    || entries.find((entry) => entry?.networkId === registryKey.replace(/^erc-8004:/, ''))
    || null;
}

function normalizeAddress(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  try {
    return getAddress(value.trim()).toLowerCase();
  } catch {
    return null;
  }
}

function extractString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseUaidSegments(uaid) {
  if (typeof uaid !== 'string') {
    return new Map();
  }
  const segments = uaid.split(';').slice(1);
  const result = new Map();
  for (const segment of segments) {
    const separator = segment.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = segment.slice(0, separator).trim().toLowerCase();
    const value = segment.slice(separator + 1).trim();
    if (key.length === 0 || value.length === 0) {
      continue;
    }
    result.set(key, value);
  }
  return result;
}

function parseUaidAgentId(uaid) {
  const segments = parseUaidSegments(uaid);
  const candidates = [segments.get('nativeid'), segments.get('uid')];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      return parseErc8004AgentId(candidate);
    } catch {}
  }
  return null;
}

function collectWalletCandidates(hit) {
  const metadata = hit && typeof hit === 'object' && hit.metadata && typeof hit.metadata === 'object'
    ? hit.metadata
    : {};
  const segments = parseUaidSegments(hit.uaid);
  const candidates = [
    metadata.owner,
    metadata.ownerAddress,
    metadata.wallet,
    metadata.walletAddress,
    metadata.account,
    metadata.accountAddress,
    metadata.creatorAddress,
    metadata.eoa,
    metadata.address,
    metadata.registration?.owner,
    metadata.registration?.ownerAddress,
    metadata.registration?.walletAddress,
    metadata.registrationData?.owner,
    metadata.registrationData?.ownerAddress,
    metadata.registrationData?.walletAddress,
    segments.get('uid'),
    segments.get('nativeid'),
    hit.originalId,
  ];
  const resolved = new Set();
  for (const candidate of candidates) {
    const normal = normalizeAddress(candidate);
    if (normal) {
      resolved.add(normal);
    }
  }
  return resolved;
}

function resolveNetworkHints(hit) {
  const metadata = hit && typeof hit === 'object' && hit.metadata && typeof hit.metadata === 'object'
    ? hit.metadata
    : {};
  const segments = parseUaidSegments(hit.uaid);
  const values = [
    metadata.network,
    metadata.networkId,
    metadata.chainNetwork,
    metadata.chainName,
    metadata.registryKey,
    metadata.erc8004NetworkId,
    segments.get('uid'),
    segments.get('nativeid'),
  ]
    .map(extractString)
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  return new Set(values);
}

function resolveRolePrivateKey(role) {
  if (role === 'provider') {
    return requireEnvValue('ETH_PK_2', { description: 'provider wallet private key' }).value;
  }
  return requireEnvValue('ETH_PK', { description: 'agent wallet private key' }).value;
}

function resolveWalletAddressForRole(role) {
  const privateKey = resolveRolePrivateKey(role);
  return privateKeyToAccount(
    privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`,
  ).address;
}

function resolveBrokerAccountIdForRole(role) {
  const derivedAccountId = resolveWalletAddressForRole(role);
  if (role === 'provider') {
    const providerSpecific = resolveEnvValue('REGISTRY_BROKER_PROVIDER_ACCOUNT_ID', null).value;
    if (providerSpecific) {
      return providerSpecific;
    }
  }
  return resolveEnvValue('REGISTRY_BROKER_ACCOUNT_ID', derivedAccountId).value;
}

function resolveBrokerClientConfig(role) {
  const baseUrl = resolveEnvValue('REGISTRY_BROKER_BASE_URL', 'https://hol.org/registry/api/v1').value;
  const apiKey = resolveEnvValue('REGISTRY_BROKER_API_KEY', '').value;
  assertProductionBrokerBaseUrl(baseUrl);
  const accountId = resolveBrokerAccountIdForRole(role);
  return {
    accountId,
    apiKey,
    baseUrl,
  };
}

function resolveAliasForRole(role, walletAddress = null) {
  const primary = role === 'provider'
    ? 'PROGRAMMABLE_SECRETS_PROVIDER_AGENT_ALIAS'
    : 'PROGRAMMABLE_SECRETS_AGENT_ALIAS';
  const fallback = role === 'provider'
    ? ['DEMO_PROVIDER_AGENT_ALIAS', 'DEMO_AGENT_ALIAS']
    : ['DEMO_AGENT_ALIAS'];
  const configured = resolvePreferredEnvValue(primary, fallback).value;
  if (configured) {
    return configured;
  }
  const normalizedWallet = normalizeAddress(walletAddress);
  if (normalizedWallet) {
    return `programmable-secrets-${role}-${normalizedWallet}`;
  }
  return `programmable-secrets-${role}-${Date.now().toString(36)}`;
}

function assertProductionBrokerBaseUrl(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'hol.org') {
      throw new CliError(
        'BROKER_PRODUCTION_REQUIRED',
        `Registry Broker base URL must use production hol.org, received "${baseUrl}".`,
        'Set REGISTRY_BROKER_BASE_URL=https://hol.org/registry/api/v1.',
      );
    }
    if (!parsed.pathname.startsWith('/registry')) {
      throw new CliError(
        'BROKER_PRODUCTION_REQUIRED',
        `Registry Broker base URL must point at /registry, received "${baseUrl}".`,
        'Set REGISTRY_BROKER_BASE_URL=https://hol.org/registry/api/v1.',
      );
    }
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw new CliError(
      'BROKER_URL_INVALID',
      `Invalid REGISTRY_BROKER_BASE_URL "${baseUrl}".`,
      'Set REGISTRY_BROKER_BASE_URL=https://hol.org/registry/api/v1.',
    );
  }
}

function resolveConfiguredEndpoint(role) {
  const roleSpecific = role === 'provider'
    ? resolvePreferredEnvValue(
      'PROGRAMMABLE_SECRETS_PROVIDER_AGENT_ENDPOINT',
      ['PROGRAMMABLE_SECRETS_PROVIDER_ENDPOINT'],
    ).value
    : resolvePreferredEnvValue(
      'PROGRAMMABLE_SECRETS_AGENT_ENDPOINT',
      ['PROGRAMMABLE_SECRETS_AGENT_PUBLIC_URL'],
    ).value;
  if (roleSpecific) {
    return roleSpecific;
  }
  return resolvePreferredEnvValue(
    'PROGRAMMABLE_SECRETS_BROKER_AGENT_ENDPOINT',
    ['PROGRAMMABLE_SECRETS_BROKER_ENDPOINT'],
  ).value;
}

async function resolveRegistrationEndpoint({ alias, baseUrl, walletRole }) {
  void alias;
  void baseUrl;
  const configuredEndpoint = resolveConfiguredEndpoint(walletRole);
  if (configuredEndpoint) {
    return {
      endpoint: configuredEndpoint,
      localAgentHandle: NOOP_AGENT_HANDLE,
    };
  }
  throw new CliError(
    'BROKER_ENDPOINT_REQUIRED',
    'Agent registration requires an explicit public endpoint URL.',
    'Set PROGRAMMABLE_SECRETS_AGENT_ENDPOINT, PROGRAMMABLE_SECRETS_PROVIDER_AGENT_ENDPOINT, or PROGRAMMABLE_SECRETS_BROKER_AGENT_ENDPOINT.',
  );
}

function resolveRegistryKeyForNetwork(networkId, { suppressWarning = false } = {}) {
  const selectedRegistryKey = `erc-8004:${networkId}`;
  const configuredRegistryKey = resolveEnvValue('REGISTRY_BROKER_ERC8004_NETWORK', selectedRegistryKey).value;
  if (!suppressWarning && configuredRegistryKey !== selectedRegistryKey) {
    printWarning(`Ignoring REGISTRY_BROKER_ERC8004_NETWORK=${configuredRegistryKey} and using ${selectedRegistryKey} to match the selected chain.`);
  }
  return selectedRegistryKey;
}

function doesHitMatchWallet(hit, walletAddress) {
  const normalizedWallet = normalizeAddress(walletAddress);
  if (!normalizedWallet) {
    return false;
  }
  return collectWalletCandidates(hit).has(normalizedWallet);
}

function doesHitMatchNetwork(hit, { networkId, registryKey, requireErc8004 }) {
  if (requireErc8004 && hit.registry !== 'erc-8004') {
    return false;
  }
  if (!requireErc8004) {
    return true;
  }
  if (!networkId) {
    return true;
  }
  const hints = resolveNetworkHints(hit);
  if (hints.has(networkId.toLowerCase()) || hints.has(registryKey.toLowerCase())) {
    return true;
  }
  const prefix = `${networkId.toLowerCase()}:`;
  for (const hint of hints) {
    if (hint.startsWith(prefix) || hint.includes(prefix)) {
      return true;
    }
  }
  return false;
}

function pickBestIdentityHit(hits, { networkId, registryKey }) {
  let best = null;
  let bestScore = -1;
  for (const hit of hits) {
    let score = 0;
    if (hit.registry === 'erc-8004') {
      score += 10;
    }
    const hints = resolveNetworkHints(hit);
    if (hints.has(networkId.toLowerCase()) || hints.has(registryKey.toLowerCase())) {
      score += 8;
    }
    if (Array.isArray(hit.protocols) && hit.protocols.length > 0) {
      score += 2;
    }
    if (hit.available === true) {
      score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = hit;
    }
  }
  return best;
}

function parseAgentIdFromHit(hit) {
  const metadata = hit && typeof hit === 'object' && hit.metadata && typeof hit.metadata === 'object'
    ? hit.metadata
    : {};
  const metadataCandidates = [
    metadata.agentId,
    metadata.agentID,
    metadata.erc8004AgentId,
    metadata.nativeAgentId,
    metadata.nativeId,
    metadata.uid,
    metadata.registration?.agentId,
    metadata.registrationData?.agentId,
  ];
  for (const candidate of metadataCandidates) {
    if (candidate === undefined || candidate === null) {
      continue;
    }
    try {
      return parseErc8004AgentId(`${candidate}`);
    } catch {}
  }
  return parseUaidAgentId(hit.uaid);
}

export async function resolveBrokerBackedAgentByWallet({
  networkId = getSelectedNetworkId(),
  registryKey,
  requireErc8004 = false,
  walletAddress,
  walletRole = 'provider',
} = {}) {
  const effectiveRegistryKey = registryKey ?? resolveRegistryKeyForNetwork(
    networkId,
    { suppressWarning: !requireErc8004 },
  );
  const selectedWalletAddress = extractString(walletAddress)
    ?? resolveWalletAddressForRole(walletRole);
  const normalizedWallet = normalizeAddress(selectedWalletAddress);
  if (!normalizedWallet) {
    throw new CliError(
      'INVALID_WALLET_ADDRESS',
      `Unable to normalize wallet address "${selectedWalletAddress}".`,
      `Provide a checksum wallet address or configure ${walletRole === 'provider' ? 'ETH_PK_2' : 'ETH_PK'}.`,
    );
  }
  const clientConfig = resolveBrokerClientConfig(walletRole);
  const client = new RegistryBrokerClient({
    baseUrl: clientConfig.baseUrl,
    accountId: clientConfig.accountId,
    ...(clientConfig.apiKey ? { apiKey: clientConfig.apiKey } : {}),
  });
  const searchResult = await client.search({
    limit: 100,
    q: selectedWalletAddress,
    ...(requireErc8004 ? { registry: 'erc-8004' } : {}),
  });
  const walletMatched = searchResult.hits.filter((hit) => doesHitMatchWallet(hit, normalizedWallet));
  const networkMatched = walletMatched.filter((hit) => doesHitMatchNetwork(hit, {
    networkId,
    registryKey: effectiveRegistryKey,
    requireErc8004,
  }));
  const selectedHit = pickBestIdentityHit(networkMatched, { networkId, registryKey: effectiveRegistryKey });
  if (!selectedHit) {
    return null;
  }
  return {
    agentId: parseAgentIdFromHit(selectedHit),
    hit: selectedHit,
    uaid: selectedHit.uaid,
    walletAddress: selectedWalletAddress,
  };
}

export async function registerBrokerBackedAgent() {
  return registerBrokerBackedAgentWithOptions({});
}

export async function registerBrokerBackedAgentWithOptions({
  includeErc8004Network = true,
  networkId = getSelectedNetworkId(),
  registerIfMissing = true,
  reuseExisting = true,
  walletRole = 'agent',
} = {}) {
  const clientConfig = resolveBrokerClientConfig(walletRole);
  const registryKey = resolveRegistryKeyForNetwork(
    networkId,
    { suppressWarning: !includeErc8004Network },
  );
  const walletAddress = resolveWalletAddressForRole(walletRole);
  const alias = resolveAliasForRole(walletRole, walletAddress);
  if (reuseExisting) {
    const existing = await resolveBrokerBackedAgentByWallet({
      networkId,
      registryKey,
      requireErc8004: includeErc8004Network,
      walletRole,
    });
    if (existing) {
      const parsedAgentId = existing.agentId;
      if (includeErc8004Network && !parsedAgentId) {
        throw new CliError(
          'BROKER_AGENT_ID_MISSING',
          `Found broker UAID ${existing.uaid} but could not resolve an ERC-8004 agent id for ${registryKey}.`,
          'Re-run with a broker registration that includes the selected ERC-8004 network.',
        );
      }
      return {
        accountId: clientConfig.accountId,
        alias,
        baseUrl: clientConfig.baseUrl,
        brokerAgentId: existing.hit.id ?? existing.hit.uaid,
        brokerUaid: existing.uaid,
        erc8004AgentId: parsedAgentId ? `${networkId}:${parsedAgentId}` : null,
        erc8004ChainId: existing.hit?.metadata?.chainId ?? null,
        erc8004NetworkId: networkId,
        erc8004RegistryKey: includeErc8004Network ? registryKey : null,
        localAgentHandle: NOOP_AGENT_HANDLE,
        progress: null,
        selectedNetwork: null,
        parsedAgentId,
      };
    }
  }
  if (!registerIfMissing) {
    throw new CliError(
      'BROKER_UAID_NOT_FOUND',
      `No broker-backed UAID exists for the ${walletRole} wallet on ${networkId}.`,
      `Enable registration and retry: ${CLI_COMMAND} flow:broker`,
    );
  }
  const client = new RegistryBrokerClient({
    baseUrl: clientConfig.baseUrl,
    accountId: clientConfig.accountId,
    ...(clientConfig.apiKey ? { apiKey: clientConfig.apiKey } : {}),
  });
  let selectedNetwork = null;
  if (includeErc8004Network) {
    const additionalCatalog = await client.getAdditionalRegistries();
    const erc8004Registry = additionalCatalog.registries.find((entry) => entry?.id === 'erc-8004');
    selectedNetwork = erc8004Registry?.networks.find((entry) => entry?.key === registryKey) ?? null;
    if (!selectedNetwork) {
      const availableNetworks = (erc8004Registry?.networks ?? []).map((entry) => entry?.key).filter(Boolean);
      const availableText = availableNetworks.length > 0 ? `Available broker networks: ${availableNetworks.join(', ')}.` : 'The broker did not return any ERC-8004 networks.';
      throw new CliError('BROKER_NETWORK_UNAVAILABLE', `Registry Broker does not expose ${registryKey}. ${availableText}`, 'Update the local registry-broker configuration or switch PROGRAMMABLE_SECRETS_NETWORK to a supported chain.');
    }
  }
  const registrationEndpoint = await resolveRegistrationEndpoint({
    alias,
    baseUrl: clientConfig.baseUrl,
    walletRole,
  });
  const localAgentHandle = registrationEndpoint.localAgentHandle;
  try {
    const endpoint = registrationEndpoint.endpoint;
    const registrationPayload = {
      profile: buildBrokerProfile({ alias, endpoint, AIAgentCapability, AIAgentType, ProfileType }),
      communicationProtocol: DEFAULT_COMMUNICATION_PROTOCOL,
      registry: DEFAULT_REGISTRY_NAMESPACE,
      additionalRegistries: includeErc8004Network ? [registryKey] : [],
      metadata: {
        ownerAddress: walletAddress,
        provider: 'programmable-secrets-contracts',
        source: 'contracts-cli',
        walletAddress,
      },
      endpoint,
    };
    const registered = await client.registerAgent(registrationPayload);
    let progress = null;
    let additionalResult = includeErc8004Network
      ? findAdditionalRegistryResult(registered.additionalRegistries, registryKey)
      : null;
    if (
      includeErc8004Network
      && (!additionalResult?.agentId || additionalResult.status === 'pending')
      && registered.attemptId
    ) {
      progress = await client.waitForRegistrationCompletion(registered.attemptId, { timeoutMs: 180000, intervalMs: 2000 });
      additionalResult = findAdditionalRegistryResult(Object.values(progress.additionalRegistries ?? {}), registryKey);
    }
    if (includeErc8004Network && !additionalResult?.agentId) {
      throw new CliError('BROKER_AGENT_ID_MISSING', `Registry Broker registration did not return an ERC-8004 agent id for ${registryKey}.`, 'Inspect the registration attempt in the broker and confirm the additional registry completed successfully.');
    }
    const parsedAgentId = additionalResult?.agentId
      ? parseErc8004AgentId(additionalResult.agentId)
      : null;
    return {
      accountId: clientConfig.accountId,
      alias,
      baseUrl: clientConfig.baseUrl,
      brokerAgentId: registered.agentId,
      brokerUaid: registered.uaid,
      erc8004AgentId: additionalResult?.agentId ?? null,
      erc8004ChainId: additionalResult?.chainId ?? selectedNetwork?.chainId ?? null,
      erc8004NetworkId: additionalResult?.networkId ?? selectedNetwork?.networkId ?? null,
      erc8004RegistryKey: additionalResult?.registryKey ?? (includeErc8004Network ? registryKey : null),
      localAgentHandle,
      progress,
      selectedNetwork,
      parsedAgentId,
    };
  } catch (error) {
    await localAgentHandle.stop();
    throw error;
  }
}
