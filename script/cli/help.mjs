import { CLI_ALIAS, CLI_COMMAND, COMMAND_TREE, TEMPLATE_REGISTRY } from './constants.mjs';
import { EXAMPLE_REGISTRY } from './examples-data.mjs';
import { emitResult, printCommandUsage, printHeading, printWarning } from './output.mjs';
import { CLI_RUNTIME } from './runtime.mjs';

function showCommandTopic(topic) {
  if (CLI_RUNTIME.json) {
    emitResult('help-topic', { command: topic, subcommands: COMMAND_TREE[topic] || [] });
    return;
  }
  switch (topic) {
    case 'datasets':
      printHeading('datasets');
      printCommandUsage([
        `List datasets: ${CLI_COMMAND} datasets list [--network robinhood-testnet]`,
        `Read dataset: ${CLI_COMMAND} datasets get --dataset-id 1`,
        `Export dataset: ${CLI_COMMAND} datasets export --dataset-id 1 --output dataset-1.json`,
        `Import dataset: ${CLI_COMMAND} datasets import --file dataset-1.json`,
        `Register dataset: ${CLI_COMMAND} datasets register --provider-uaid did:uaid:hol:quantlab --metadata-json '{"title":"TSLA"}' --ciphertext "encrypted payload" --key-material "wrapped key"`,
        `Set dataset active state: ${CLI_COMMAND} datasets set-active --dataset-id 1 --active false`,
      ]);
      return;
    case 'policies':
      printHeading('policies');
      printCommandUsage([
        `List policies: ${CLI_COMMAND} policies list [--dataset-id 1]`,
        `Read policy: ${CLI_COMMAND} policies get --policy-id 1`,
        `List registered evaluators: ${CLI_COMMAND} policies evaluators`,
        `Export policy: ${CLI_COMMAND} policies export --policy-id 1 --output policy-1.json`,
        `Import policy: ${CLI_COMMAND} policies import --file policy-1.json`,
        `Create timebound policy: ${CLI_COMMAND} policies create-timebound --dataset-id 1 --price-eth 0.00001 --duration-hours 24 --metadata-json '{"title":"TSLA 24h access"}'`,
        `Create UAID-bound policy: ${CLI_COMMAND} policies create-uaid --dataset-id 1 --price-eth 0.00001 --required-buyer-uaid uaid:aid:... --agent-id 97`,
        `Update policy: ${CLI_COMMAND} policies update --policy-id 1 --price-eth 0.00002 --active true --metadata-json '{"title":"Updated policy"}'`,
      ]);
      return;
    case 'examples':
      printHeading('examples');
      printCommandUsage([
        `List examples: ${CLI_COMMAND} examples list`,
        `Show the two-agent flow: ${CLI_COMMAND} examples show --name two-agent-sale`,
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
    default:
      printWarning(`Unknown help topic: ${topic}`);
  }
}

export function showHelp(topic = null) {
  if (topic) {
    showCommandTopic(topic);
    return;
  }
  if (CLI_RUNTIME.json) {
    emitResult('help', { alias: CLI_ALIAS, command: CLI_COMMAND, commands: COMMAND_TREE });
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
  console.log(`  4. ${CLI_COMMAND} examples show --name two-agent-sale`);
  console.log('');
  console.log('Guided commands:');
  console.log(`  ${CLI_COMMAND} init          Bootstrap profiles and optional completions`);
  console.log(`  ${CLI_COMMAND} start         Guided quick start with next-step recommendations`);
  console.log(`  ${CLI_COMMAND} doctor        Check env, RPC, broker, and deployment readiness`);
  console.log(`  ${CLI_COMMAND} env-bootstrap Write a local .env.local from live Docker defaults`);
  console.log(`  ${CLI_COMMAND} flow:direct   Robinhood marketplace flow with timebound access and local unlock proof`);
  console.log(`  ${CLI_COMMAND} flow:uaid     Direct ERC-8004 identity flow on a chain with IdentityRegistry support`);
  console.log(`  ${CLI_COMMAND} flow:broker   Registry Broker-backed ERC-8004 identity flow`);
  console.log(`  ${CLI_COMMAND} examples ...  Print end-to-end command walkthroughs such as the two-agent sale flow`);
  console.log('');
  console.log('Contract commands:');
  console.log(`  ${CLI_COMMAND} contracts    Show deployed contract addresses`);
  console.log(`  ${CLI_COMMAND} evaluators   Inspect registered evaluator modules and trust metadata`);
  console.log(`  ${CLI_COMMAND} datasets ... Register, inspect, and activate datasets`);
  console.log(`  ${CLI_COMMAND} policies ... Create, inspect, update, and export/import evaluator-backed policies`);
  console.log(`  ${CLI_COMMAND} purchase ... Purchase a policy using the live onchain price`);
  console.log(`  ${CLI_COMMAND} access ...   Check access and resolve receipts by buyer`);
  console.log(`  ${CLI_COMMAND} receipts ... Read receipt details`);
  console.log(`  ${CLI_COMMAND} identity ... Register ERC-8004 agents`);
  console.log(`  ${CLI_COMMAND} krs ...      Encrypt, decrypt, and verify local unlock bundles`);
  console.log(`  ${CLI_COMMAND} profiles ... Manage named operator profiles`);
  console.log(`  ${CLI_COMMAND} templates ... Emit reusable dataset and policy templates (${Object.keys(TEMPLATE_REGISTRY).length} built in)`);
  console.log(`  ${CLI_COMMAND} completions  Generate shell completions`);
  console.log(`  ${CLI_COMMAND} preview ...  Preview a state-changing command without sending a transaction`);
  console.log('');
  console.log('Topic help:');
  console.log(`  ${CLI_COMMAND} help datasets`);
  console.log(`  ${CLI_COMMAND} help policies`);
  console.log(`  ${CLI_COMMAND} help examples`);
}
