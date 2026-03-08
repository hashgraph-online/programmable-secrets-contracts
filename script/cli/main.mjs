import { CLI_COMMAND } from './constants.mjs';
import { CliError } from './errors.mjs';
import { writeBootstrapEnvFile } from './env.mjs';
import { showHelp } from './help.mjs';
import { parseCliArgs, completeInteractiveOptions, readOption, parseBooleanOption } from './options.mjs';
import { emitJson } from './output.mjs';
import { initializeRuntime, CLI_RUNTIME } from './runtime.mjs';
import { runInitCommand, runProfilesCommand, runTemplatesCommand, runCompletionsCommand, runStart, runDoctor, showContracts } from './commands/system.mjs';
import { runExamplesCommand } from './commands/examples.mjs';
import { thresholdConfigCommand, thresholdRuntimeCommand } from './commands/attestations.mjs';
import { listPoliciesLegacyCommand, deactivateAllCommand, updatePricesCommand } from './commands/admin.mjs';
import { listDatasetsCommand, getDatasetCommand, exportDatasetCommand, importDatasetCommand, registerDatasetCommand, setDatasetActiveCommand } from './commands/datasets.mjs';
import { listPoliciesCommand, getPolicyCommand, listEvaluatorsCommand, getEvaluatorCommand, registerEvaluatorCommand } from './commands/policies-read.mjs';
import { createTimeboundPolicyCommand, createUaidPolicyCommand, exportPolicyCommand, importPolicyCommand, setPolicyAllowlistCommand, updatePolicyCommand } from './commands/policies-write.mjs';
import { purchasePolicyCommand, accessPolicyCommand, accessDatasetCommand, receiptByPolicyCommand, receiptByDatasetCommand, getReceiptCommand, registerIdentityCommand } from './commands/access.mjs';
import { encryptBundleCommand, decryptBundleCommand, verifyBundleCommand } from './commands/krs.mjs';
import { runDirectMarketplaceFlow, runDirectUaidFlow, demoBrokerUaidFlow } from './commands/flows.mjs';

async function runDatasetsCommand(tokens) {
  const { positionals, options } = parseCliArgs(tokens);
  const subcommand = positionals[0] || 'list';
  await completeInteractiveOptions('datasets', subcommand, options);
  switch (subcommand) {
    case 'list': return listDatasetsCommand(options);
    case 'get': return getDatasetCommand(options);
    case 'export': return exportDatasetCommand(options);
    case 'import': return importDatasetCommand(options);
    case 'register': return registerDatasetCommand(options);
    case 'set-active': return setDatasetActiveCommand(options);
    default: throw new CliError('UNKNOWN_SUBCOMMAND', `Unknown datasets command "${subcommand}".`, `See "${CLI_COMMAND} help datasets".`);
  }
}

async function runPoliciesCommand(tokens) {
  const { positionals, options } = parseCliArgs(tokens);
  const subcommand = positionals[0] || 'list';
  await completeInteractiveOptions('policies', subcommand, options);
  switch (subcommand) {
    case 'list': return listPoliciesCommand(options);
    case 'get': return getPolicyCommand(options);
    case 'evaluators': return listEvaluatorsCommand(options);
    case 'export': return exportPolicyCommand(options);
    case 'import': return importPolicyCommand(options);
    case 'create-timebound': return createTimeboundPolicyCommand(options);
    case 'create-uaid': return createUaidPolicyCommand(options);
    case 'update': return updatePolicyCommand(options);
    case 'allowlist': return setPolicyAllowlistCommand(options);
    default: throw new CliError('UNKNOWN_SUBCOMMAND', `Unknown policies command "${subcommand}".`, `See "${CLI_COMMAND} help policies".`);
  }
}

async function runAccessCommand(tokens) {
  const { positionals, options } = parseCliArgs(tokens);
  const subcommand = positionals[0] || 'policy';
  switch (subcommand) {
    case 'policy': return accessPolicyCommand(options);
    case 'dataset': return accessDatasetCommand(options);
    case 'receipt-policy': return receiptByPolicyCommand(options);
    case 'receipt-dataset': return receiptByDatasetCommand(options);
    default: throw new CliError('UNKNOWN_SUBCOMMAND', `Unknown access command "${subcommand}".`, `See "${CLI_COMMAND} help access".`);
  }
}

async function runReceiptsCommand(tokens) {
  const { positionals, options } = parseCliArgs(tokens);
  const subcommand = positionals[0] || 'get';
  if (subcommand === 'get') {
    return getReceiptCommand(options);
  }
  throw new CliError('UNKNOWN_SUBCOMMAND', `Unknown receipts command "${subcommand}".`, `See "${CLI_COMMAND} help receipts".`);
}

async function runIdentityCommand(tokens) {
  const { positionals, options } = parseCliArgs(tokens);
  const subcommand = positionals[0] || 'register';
  await completeInteractiveOptions('identity', subcommand, options);
  if (subcommand === 'register') {
    return registerIdentityCommand(options);
  }
  throw new CliError('UNKNOWN_SUBCOMMAND', `Unknown identity command "${subcommand}".`, `See "${CLI_COMMAND} help identity".`);
}

async function runEvaluatorsCommand(tokens) {
  const { positionals, options } = parseCliArgs(tokens);
  const subcommand = positionals[0] || 'list';
  switch (subcommand) {
    case 'list': return listEvaluatorsCommand(options);
    case 'get': return getEvaluatorCommand(options);
    case 'register': return registerEvaluatorCommand(options);
    default: throw new CliError('UNKNOWN_SUBCOMMAND', `Unknown evaluators command "${subcommand}".`, `See "${CLI_COMMAND} help evaluators".`);
  }
}

async function runAttestationsCommand(tokens) {
  const { positionals, options } = parseCliArgs(tokens);
  const subcommand = positionals[0] || 'threshold-config';
  switch (subcommand) {
    case 'threshold-config': return thresholdConfigCommand(options);
    case 'threshold-runtime': return thresholdRuntimeCommand(options);
    default: throw new CliError('UNKNOWN_SUBCOMMAND', `Unknown attestations command "${subcommand}".`, `See "${CLI_COMMAND} help attestations".`);
  }
}

async function runKrsCommand(tokens) {
  const { positionals, options } = parseCliArgs(tokens);
  const subcommand = positionals[0] || 'encrypt';
  await completeInteractiveOptions('krs', subcommand, options);
  switch (subcommand) {
    case 'encrypt': return encryptBundleCommand(options);
    case 'decrypt': return decryptBundleCommand(options);
    case 'verify': return verifyBundleCommand(options);
    default: throw new CliError('UNKNOWN_SUBCOMMAND', `Unknown krs command "${subcommand}".`, `See "${CLI_COMMAND} help krs".`);
  }
}

async function dispatchCommand(commandName, tokens, forcePreview = false) {
  const effectiveTokens = forcePreview && !tokens.includes('--preview') ? [...tokens, '--preview'] : tokens;
  const parsed = parseCliArgs(effectiveTokens);
  if (forcePreview) {
    parsed.options.preview = true;
  }
  switch (commandName) {
    case 'start': return runStart();
    case 'doctor': return runDoctor();
    case 'init': return runInitCommand(parsed.options);
    case 'env-bootstrap': return writeBootstrapEnvFile();
    case 'list': return listPoliciesLegacyCommand();
    case 'deactivate-all': return deactivateAllCommand();
    case 'update-prices': return updatePricesCommand();
    case 'flow:direct': return runDirectMarketplaceFlow();
    case 'flow:uaid': return runDirectUaidFlow();
    case 'flow:broker': return demoBrokerUaidFlow();
    case 'contracts': return showContracts(parsed.options);
    case 'attestations': return runAttestationsCommand(effectiveTokens);
    case 'evaluators': return runEvaluatorsCommand(effectiveTokens);
    case 'datasets': return runDatasetsCommand(effectiveTokens);
    case 'policies': return runPoliciesCommand(effectiveTokens);
    case 'purchase':
      await completeInteractiveOptions('purchase', null, parsed.options);
      return purchasePolicyCommand(parsed.options);
    case 'access': return runAccessCommand(effectiveTokens);
    case 'receipts': return runReceiptsCommand(effectiveTokens);
    case 'identity': return runIdentityCommand(effectiveTokens);
    case 'profiles': return runProfilesCommand(effectiveTokens);
    case 'templates': return runTemplatesCommand(effectiveTokens);
    case 'examples': return runExamplesCommand(effectiveTokens, parseCliArgs);
    case 'completions': return runCompletionsCommand(effectiveTokens);
    case 'krs': return runKrsCommand(effectiveTokens);
    case 'help': return showHelp(parsed.positionals[0] || null);
    default: throw new CliError('UNKNOWN_COMMAND', `Unknown command: ${commandName}`, `Run "${CLI_COMMAND} help".`);
  }
}

export async function runCli(rawArgs = process.argv.slice(2).filter((value) => value !== '--')) {
  const command = rawArgs[0] || 'start';
  const commandArgs = rawArgs.slice(1);
  const globalOptions = parseCliArgs(rawArgs).options;
  initializeRuntime({
    commandName: command,
    globalOptions,
    parseBooleanOption,
    readOption,
  });
  try {
    if (command === 'preview' || command === 'explain') {
      const previewCommand = commandArgs[0];
      if (!previewCommand) {
        throw new CliError('MISSING_OPTION', `Missing command after ${command}.`, `Use "${CLI_COMMAND} ${command} purchase --policy-id 1".`);
      }
      await dispatchCommand(previewCommand, commandArgs.slice(1), true);
      return;
    }
    await dispatchCommand(command, commandArgs);
  } catch (error) {
    const normalized = error instanceof CliError ? error : new CliError('UNEXPECTED_ERROR', error instanceof Error ? error.message : `${error}`);
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
}
