import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseAbi } from 'viem';
import { CLI_COMMAND, CLI_CONFIG_PATH, COMMAND_TREE, PAYMENT_MODULE_ABI, POLICY_VAULT_ABI, TEMPLATE_REGISTRY } from '../constants.mjs';
import { CliError } from '../errors.mjs';
import { resolveDockerContainer, resolveEnvValue, resolvePreferredEnvValue, writeBootstrapEnvFile } from '../env.mjs';
import { showHelp } from '../help.mjs';
import { emitResult, printField, printHeading, printInfo, printSuccess, printWarning, serializeJson } from '../output.mjs';
import { parseBooleanOption, parseCliArgs, readOption, requireOption, resolveOutputPath } from '../options.mjs';
import { CLI_RUNTIME, getDefaultConfig, loadCliConfig, writeCliConfig } from '../runtime.mjs';
import {
  buildAccessReceiptAddress,
  buildIdentityRegistryAddress,
  buildPaymentModuleAddress,
  buildPolicyVaultAddress,
  getNetworkIdFromOptions,
  getPublicClient,
  getSelectedChain,
  getSelectedNetworkId,
  loadDeployment,
  maybeWriteJsonFile,
} from '../index-support.mjs';
import { EXAMPLE_REGISTRY } from '../examples-data.mjs';

export async function runInitCommand(options) {
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
    envBootstrapSuggested: !existsSync(resolve(process.cwd(), '.env.local')),
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

export async function runProfilesCommand(tokens) {
  const { positionals, options } = parseCliArgs(tokens);
  const subcommand = positionals[0] || 'list';
  const config = loadCliConfig();
  if (subcommand === 'init') {
    writeCliConfig(getDefaultConfig(), CLI_CONFIG_PATH, parseBooleanOption(readOption(options, ['force'], false), false));
    if (CLI_RUNTIME.json) {
      emitResult('profiles-init', { configPath: CLI_CONFIG_PATH });
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
    emitResult('profile', { name: profileName, profile });
    if (!CLI_RUNTIME.json) {
      console.log(serializeJson({ name: profileName, profile }));
    }
    return;
  }
  emitResult('profiles', { configPath: CLI_CONFIG_PATH, defaultProfile: config.defaultProfile, profiles: config.profiles });
  if (!CLI_RUNTIME.json) {
    console.log(serializeJson({ configPath: CLI_CONFIG_PATH, defaultProfile: config.defaultProfile, profiles: config.profiles }));
  }
}

export async function runTemplatesCommand(tokens) {
  const { positionals, options } = parseCliArgs(tokens);
  const subcommand = positionals[0] || 'list';
  if (subcommand === 'list') {
    emitResult('templates', { templates: TEMPLATE_REGISTRY });
    if (!CLI_RUNTIME.json) {
      console.log(serializeJson(TEMPLATE_REGISTRY));
    }
    return;
  }
  const templateName = requireOption(options, ['name', 'template'], 'template name');
  const template = TEMPLATE_REGISTRY[templateName];
  if (!template) {
    throw new CliError('TEMPLATE_MISSING', `Unknown template "${templateName}".`, `Use ${CLI_COMMAND} templates list.`);
  }
  if (subcommand === 'write') {
    const outputPath = resolveOutputPath(options, `${templateName}.json`);
    const writtenPath = maybeWriteJsonFile(outputPath, template, serializeJson);
    if (CLI_RUNTIME.json) {
      emitResult('template-write', { outputPath: writtenPath, template: templateName });
      return;
    }
    printSuccess(`Wrote template to ${writtenPath}`);
    return;
  }
  emitResult('template', { name: templateName, template });
  if (!CLI_RUNTIME.json) {
    console.log(serializeJson({ name: templateName, template }));
  }
}

export function renderCompletionScript(shell) {
  const topLevel = Object.keys(COMMAND_TREE).sort();
  const functionName = `_${CLI_COMMAND.replace(/-/g, '_')}_completions`;
  if (shell === 'bash') {
    return `${functionName}() {\n  local cur prev words cword\n  _init_completion || return\n  if [[ $cword -eq 1 ]]; then\n    COMPREPLY=( $(compgen -W "${topLevel.join(' ')}" -- "$cur") )\n    return\n  fi\n  case "\${words[1]}" in\n${topLevel.map((commandName) => `    ${commandName}) COMPREPLY=( $(compgen -W "${(COMMAND_TREE[commandName] || []).join(' ')}" -- "$cur") ); return ;;`).join('\n')}\n  esac\n}\ncomplete -F ${functionName} ${CLI_COMMAND}`;
  }
  if (shell === 'zsh') {
    return `#compdef ${CLI_COMMAND}\n_arguments '1:command:(${topLevel.join(' ')})' '2:subcommand:->subcmds'\ncase $words[2] in\n${topLevel.map((commandName) => `  ${commandName}) _values 'subcommand' ${(COMMAND_TREE[commandName] || []).join(' ')} ;;`).join('\n')}\nesac`;
  }
  if (shell === 'fish') {
    return topLevel.map((commandName) => `complete -c ${CLI_COMMAND} -f -n '__fish_use_subcommand' -a '${commandName}'`).concat(
      topLevel.flatMap((commandName) => (COMMAND_TREE[commandName] || []).map((subcommand) => `complete -c ${CLI_COMMAND} -f -n '__fish_seen_subcommand_from ${commandName}' -a '${subcommand}'`)),
    ).join('\n');
  }
  throw new CliError('UNSUPPORTED_SHELL', `Unsupported shell "${shell}".`, 'Use bash, zsh, or fish.');
}

export async function runCompletionsCommand(tokens) {
  const { positionals, options } = parseCliArgs(tokens);
  const shell = positionals[0] || readOption(options, ['shell'], 'zsh');
  const script = renderCompletionScript(shell);
  const outputPath = resolveOutputPath(options);
  if (outputPath) {
    const resolvedPath = resolve(outputPath);
    writeFileSync(resolvedPath, `${script}\n`);
    if (CLI_RUNTIME.json) {
      emitResult('completions', { outputPath: resolvedPath, shell });
      return;
    }
    printSuccess(`Wrote ${shell} completions to ${resolvedPath}`);
    return;
  }
  console.log(script);
}

export async function runStart() {
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
      emitResult('start', { ...payload, next: `${CLI_COMMAND} env-bootstrap`, ready: false });
      return;
    }
    printWarning('Operator keys are missing.');
    console.log(`Recommended next step: ${CLI_COMMAND} env-bootstrap`);
    return;
  }
  if (CLI_RUNTIME.json) {
    emitResult('start', {
      ...payload,
      next: [`${CLI_COMMAND} doctor`, `${CLI_COMMAND} flow:direct`, `${CLI_COMMAND} flow:uaid`, `${CLI_COMMAND} flow:broker`, `${CLI_COMMAND} examples show --name two-agent-sale`],
      ready: true,
    });
    return;
  }
  printSuccess('Environment looks ready for live workflow execution.');
}

export async function runDoctor() {
  const networkId = getSelectedNetworkId();
  const chain = getSelectedChain(networkId);
  const payload = {
    accessReceipt: buildAccessReceiptAddress(networkId),
    brokerHealth: 'unreachable',
    dockerSource: resolveDockerContainer() || 'not found',
    envFiles: [],
    network: chain.name,
    paymentModule: buildPaymentModuleAddress(networkId),
    policyCount: null,
    policyVault: buildPolicyVaultAddress(networkId),
    receiptPaymentModule: null,
  };
  const publicClient = getPublicClient(chain);
  payload.policyCount = await publicClient.readContract({
    address: payload.policyVault,
    abi: POLICY_VAULT_ABI,
    functionName: 'policyCount',
  });
  payload.receiptPaymentModule = await publicClient.readContract({
    address: payload.accessReceipt,
    abi: parseAbi(['function paymentModule() view returns (address)']),
    functionName: 'paymentModule',
  });
  if (CLI_RUNTIME.json) {
    emitResult('doctor', payload);
    return;
  }
  printHeading('Programmable Secrets Doctor');
  printField('Selected net', chain.name);
  printField('PolicyVault', payload.policyVault);
  printField('PaymentModule', payload.paymentModule);
  printField('AccessReceipt', payload.accessReceipt);
  printField('policyCount', payload.policyCount);
  printField('Receipt wiring', payload.receiptPaymentModule);
}

export async function showContracts(options) {
  const networkId = getNetworkIdFromOptions(options);
  const chain = getSelectedChain(networkId);
  const publicClient = getPublicClient(chain);
  const policyVault = buildPolicyVaultAddress(networkId);
  const paymentModule = buildPaymentModuleAddress(networkId);
  const accessReceipt = buildAccessReceiptAddress(networkId);
  const deployment = loadDeployment(networkId);
  const builtInEvaluators = Object.entries(deployment.contracts?.builtInPolicyEvaluators || {}).map(([kind, entry]) => ({
    address: entry.address,
    kind,
  }));
  const payload = {
    accessReceipt,
    builtInEvaluators,
    identityRegistry: buildIdentityRegistryAddress(networkId),
    network: chain.name,
    onchain: {
      datasetCount: null,
      paymentModulePolicyVault: null,
      policyCount: null,
      receiptPaymentModule: null,
    },
    paymentModule,
    policyVault,
  };
  try {
    payload.onchain.policyCount = await publicClient.readContract({ address: policyVault, abi: POLICY_VAULT_ABI, functionName: 'policyCount' });
    payload.onchain.datasetCount = await publicClient.readContract({ address: policyVault, abi: POLICY_VAULT_ABI, functionName: 'datasetCount' });
    payload.onchain.paymentModulePolicyVault = await publicClient.readContract({ address: paymentModule, abi: parseAbi(['function policyVault() view returns (address)']), functionName: 'policyVault' });
    payload.onchain.receiptPaymentModule = await publicClient.readContract({ address: accessReceipt, abi: parseAbi(['function paymentModule() view returns (address)']), functionName: 'paymentModule' });
  } catch (error) {
    payload.onchain.error = error instanceof Error ? error.message : `${error}`;
  }
  if (CLI_RUNTIME.json) {
    emitResult('contracts', payload);
    return;
  }
  printHeading(`Contracts on ${chain.name}`);
  printField('PolicyVault', policyVault);
  printField('PaymentModule', paymentModule);
  printField('AccessReceipt', accessReceipt);
  printField('Identity reg', payload.identityRegistry);
  if (payload.onchain.error) {
    printWarning(`Unable to resolve onchain wiring: ${payload.onchain.error}`);
    return;
  }
  printField('datasetCount', payload.onchain.datasetCount);
  printField('policyCount', payload.onchain.policyCount);
  printField('PM->Vault', payload.onchain.paymentModulePolicyVault);
  printField('Receipt->PM', payload.onchain.receiptPaymentModule);
}

export async function runHelpCommand(tokens) {
  const { positionals } = parseCliArgs(tokens);
  showHelp(positionals[0] || null);
}
