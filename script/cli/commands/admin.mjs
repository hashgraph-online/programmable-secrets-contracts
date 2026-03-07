import { formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { PAYMENT_MODULE_ABI, POLICY_VAULT_ABI, robinhoodTestnet } from '../constants.mjs';
import { getPublicClient, buildPolicyVaultAddress, getWalletClient } from '../index-support.mjs';
import { requireEnvValue, normalizePrivateKey } from '../env.mjs';

function getDefaultWalletClient() {
  const { value } = requireEnvValue('ETH_PK', { description: 'agent wallet private key' });
  return getWalletClient({
    privateKey: normalizePrivateKey(value, 'ETH_PK'),
    chain: robinhoodTestnet,
  });
}

export async function listPoliciesLegacyCommand() {
  const publicClient = getPublicClient(robinhoodTestnet);
  const policyVaultAddress = buildPolicyVaultAddress('robinhood-testnet');
  const count = await publicClient.readContract({
    address: policyVaultAddress,
    abi: POLICY_VAULT_ABI,
    functionName: 'policyCount',
  });
  console.log(`\nPolicies on ${robinhoodTestnet.name}: ${count}\n`);
  for (let policyId = 1n; policyId <= count; policyId += 1n) {
    const policy = await publicClient.readContract({
      address: policyVaultAddress,
      abi: POLICY_VAULT_ABI,
      functionName: 'getPolicy',
      args: [policyId],
    });
    console.log(`#${policyId} dataset=${policy.datasetId} provider=${policy.provider} active=${policy.active} price=${formatEther(policy.price)} ETH`);
  }
}

export async function deactivateAllCommand() {
  const walletClient = getDefaultWalletClient();
  const publicClient = getPublicClient(robinhoodTestnet);
  const policyVaultAddress = buildPolicyVaultAddress('robinhood-testnet');
  const count = await publicClient.readContract({
    address: policyVaultAddress,
    abi: POLICY_VAULT_ABI,
    functionName: 'policyCount',
  });
  console.log(`\nDeactivating provider-owned policies on ${robinhoodTestnet.name}...\n`);
  for (let i = 1n; i <= count; i += 1n) {
    const policy = await publicClient.readContract({
      address: policyVaultAddress,
      abi: POLICY_VAULT_ABI,
      functionName: 'getPolicy',
      args: [i],
    });
    if (policy.provider.toLowerCase() !== walletClient.account.address.toLowerCase()) {
      console.log(`Policy #${i}: skip — owned by ${policy.provider}`);
      continue;
    }
    if (!policy.active) {
      console.log(`Policy #${i}: already inactive`);
      continue;
    }
    const tx = await walletClient.writeContract({
      address: policyVaultAddress,
      abi: POLICY_VAULT_ABI,
      functionName: 'updatePolicy',
      args: [i, policy.price, false, policy.metadataHash],
      chain: robinhoodTestnet,
      account: walletClient.account,
    });
    console.log(`Policy #${i}: ${tx}`);
    await publicClient.waitForTransactionReceipt({ hash: tx });
    console.log(`Policy #${i}: confirmed`);
  }
}

export async function updatePricesCommand() {
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
  for (let i = 1n; i <= count; i += 1n) {
    const policy = await publicClient.readContract({
      address: policyVaultAddress,
      abi: POLICY_VAULT_ABI,
      functionName: 'getPolicy',
      args: [i],
    });
    if (policy.provider.toLowerCase() !== walletClient.account.address.toLowerCase()) {
      console.log(`Policy #${i}: skip — owned by ${policy.provider}`);
      continue;
    }
    const tx = await walletClient.writeContract({
      address: policyVaultAddress,
      abi: POLICY_VAULT_ABI,
      functionName: 'updatePolicy',
      args: [i, newPrice, policy.active, policy.metadataHash],
      chain: robinhoodTestnet,
      account: walletClient.account,
    });
    console.log(`Policy #${i}: ${formatEther(policy.price)} ETH -> 0.00001 ETH (${tx})`);
    await publicClient.waitForTransactionReceipt({ hash: tx });
  }
}
