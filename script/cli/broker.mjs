import { privateKeyToAccount } from 'viem/accounts';
import {
  CLI_COMMAND,
  DEFAULT_COMMUNICATION_PROTOCOL,
  DEFAULT_REGISTRY_NAMESPACE,
} from './constants.mjs';
import { CliError } from './errors.mjs';
import { requireEnvValue, resolveEnvValue, resolvePreferredEnvValue } from './env.mjs';
import { printWarning } from './output.mjs';
import { getSelectedNetworkId, parseErc8004AgentId } from './chain.mjs';

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

export async function registerBrokerBackedAgent() {
  const { RegistryBrokerClient, AIAgentCapability, AIAgentType, ProfileType } = await import('../../standards-sdk/src/index.ts');
  const { startLocalA2AAgent } = await import('../../standards-sdk/demo/utils/local-a2a-agent.ts');
  const baseUrl = resolveEnvValue('REGISTRY_BROKER_BASE_URL', 'http://127.0.0.1:4000/api/v1').value;
  const apiKey = resolveEnvValue('REGISTRY_BROKER_API_KEY', 'local-dev-api-key-change-me').value;
  const agentKey = requireEnvValue('ETH_PK', { description: 'agent wallet private key' });
  const derivedAccountId = privateKeyToAccount(agentKey.value.startsWith('0x') ? agentKey.value : `0x${agentKey.value}`).address;
  const accountId = resolveEnvValue('REGISTRY_BROKER_ACCOUNT_ID', derivedAccountId).value;
  const selectedNetworkId = getSelectedNetworkId();
  const selectedRegistryKey = `erc-8004:${selectedNetworkId}`;
  const configuredRegistryKey = resolveEnvValue('REGISTRY_BROKER_ERC8004_NETWORK', selectedRegistryKey).value;
  const registryKey = configuredRegistryKey === selectedRegistryKey ? configuredRegistryKey : selectedRegistryKey;
  const alias = resolvePreferredEnvValue('PROGRAMMABLE_SECRETS_AGENT_ALIAS', ['DEMO_AGENT_ALIAS']).value || `programmable-secrets-${Date.now().toString(36)}`;
  if (configuredRegistryKey !== selectedRegistryKey) {
    printWarning(`Ignoring REGISTRY_BROKER_ERC8004_NETWORK=${configuredRegistryKey} and using ${selectedRegistryKey} to match the selected chain.`);
  }
  const client = new RegistryBrokerClient({ baseUrl, accountId, ...(apiKey ? { apiKey } : {}) });
  const additionalCatalog = await client.getAdditionalRegistries();
  const erc8004Registry = additionalCatalog.registries.find((entry) => entry?.id === 'erc-8004');
  const selectedNetwork = erc8004Registry?.networks.find((entry) => entry?.key === registryKey);
  if (!selectedNetwork) {
    const availableNetworks = (erc8004Registry?.networks ?? []).map((entry) => entry?.key).filter(Boolean);
    const availableText = availableNetworks.length > 0 ? `Available broker networks: ${availableNetworks.join(', ')}.` : 'The broker did not return any ERC-8004 networks.';
    throw new CliError('BROKER_NETWORK_UNAVAILABLE', `Registry Broker does not expose ${registryKey}. ${availableText}`, 'Update the local registry-broker configuration or switch PROGRAMMABLE_SECRETS_NETWORK to a supported chain.');
  }
  const localAgentHandle = await startLocalA2AAgent({ agentId: alias });
  try {
    const endpoint = localAgentHandle.publicUrl ?? localAgentHandle.a2aEndpoint;
    const registrationPayload = {
      profile: buildBrokerProfile({ alias, endpoint, AIAgentCapability, AIAgentType, ProfileType }),
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
    let additionalResult = findAdditionalRegistryResult(registered.additionalRegistries, registryKey);
    if ((!additionalResult?.agentId || additionalResult.status === 'pending') && registered.attemptId) {
      progress = await client.waitForRegistrationCompletion(registered.attemptId, { timeoutMs: 180000, intervalMs: 2000 });
      additionalResult = findAdditionalRegistryResult(Object.values(progress.additionalRegistries ?? {}), registryKey);
    }
    if (!additionalResult?.agentId) {
      throw new CliError('BROKER_AGENT_ID_MISSING', `Registry Broker registration did not return an ERC-8004 agent id for ${registryKey}.`, 'Inspect the registration attempt in the broker and confirm the additional registry completed successfully.');
    }
    return {
      accountId,
      alias,
      baseUrl,
      brokerAgentId: registered.agentId,
      brokerUaid: registered.uaid,
      erc8004AgentId: additionalResult.agentId,
      erc8004ChainId: additionalResult.chainId ?? selectedNetwork.chainId,
      erc8004NetworkId: additionalResult.networkId ?? selectedNetwork.networkId,
      erc8004RegistryKey: additionalResult.registryKey ?? registryKey,
      localAgentHandle,
      progress,
      selectedNetwork,
      parsedAgentId: parseErc8004AgentId(additionalResult.agentId),
    };
  } catch (error) {
    await localAgentHandle.stop();
    throw error;
  }
}
