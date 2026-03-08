import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWalletBackedProviderUaid } from '../script/cli/commands/flows.mjs';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(TEST_DIR, '..');

function runCli(args) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', 'script/manage-policies.mjs', ...args],
    {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
    },
  );
}

function parseJsonOutput(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('help exposes the examples command family', () => {
  const result = runCli(['help']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\bexamples\b/);
  assert.match(result.stdout, /\battestations\b/);
});

test('global --help prints top-level help', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Programmable Secrets CLI/);
  assert.match(result.stdout, /\bflow:direct\b/);
});

test('command --help prints topic help', () => {
  const result = runCli(['policies', '--help']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /=== policies ===/);
  assert.match(result.stdout, /\bcreate-timebound\b/);
});

test('attestations help exposes the direct threshold evaluator check', () => {
  const result = runCli(['help', 'attestations']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\bthreshold-check\b/);
});

test('examples list exposes the two-agent sale flow', () => {
  const result = runCli(['examples', 'list', '--json']);
  const payload = parseJsonOutput(result);
  assert.equal(payload.kind, 'examples');
  assert.ok(payload.payload.examples['two-agent-sale']);
  assert.ok(payload.payload.examples['custom-eth-balance-policy']);
  assert.ok(payload.payload.examples['custom-threshold-committee-policy']);
});

test('examples show prints a buyer unlock flow with CLI commands', () => {
  const result = runCli(['examples', 'show', '--name', 'two-agent-sale', '--json']);
  const payload = parseJsonOutput(result);

  assert.equal(payload.kind, 'example');
  assert.equal(payload.payload.name, 'two-agent-sale');
  assert.equal(payload.payload.example.roles.provider.name, 'Agent A');
  assert.equal(payload.payload.example.roles.buyer.name, 'Agent B');
  assert.ok(Array.isArray(payload.payload.example.steps));
  assert.equal(payload.payload.example.steps.length > 0, true);

  const commands = payload.payload.example.steps.flatMap((step) => step.commands);
  assert.equal(commands.some((command) => command.includes('krs encrypt')), true);
  assert.equal(commands.some((command) => command.includes('datasets register')), true);
  assert.equal(commands.some((command) => command.includes('purchase --policy-id')), true);
  assert.equal(commands.some((command) => command.includes('krs decrypt')), true);
});

test('examples show prints the custom evaluator deployment flow', () => {
  const result = runCli(['examples', 'show', '--name', 'custom-eth-balance-policy', '--json']);
  const payload = parseJsonOutput(result);

  assert.equal(payload.kind, 'example');
  assert.equal(payload.payload.name, 'custom-eth-balance-policy');

  const commands = payload.payload.example.steps.flatMap((step) => step.commands);
  assert.equal(commands.some((command) => command.includes('forge create src/EthBalanceCondition.sol:EthBalanceCondition')), true);
  assert.equal(commands.some((command) => command.includes('registerPolicyEvaluator(address,bytes32)')), true);
  assert.equal(commands.some((command) => command.includes('policies import')), true);
});

test('examples show prints the Stylus threshold committee evaluator flow', () => {
  const result = runCli(['examples', 'show', '--name', 'custom-threshold-committee-policy', '--json']);
  const payload = parseJsonOutput(result);

  assert.equal(payload.kind, 'example');
  assert.equal(payload.payload.name, 'custom-threshold-committee-policy');

  const commands = payload.payload.example.steps.flatMap((step) => step.commands);
  assert.equal(commands.some((command) => command.includes('cargo stylus deploy')), true);
  assert.equal(commands.some((command) => command.includes('--endpoint https://sepolia-rollup.arbitrum.io/rpc')), true);
  assert.equal(commands.some((command) => command.includes('--max-fee-per-gas-gwei 1')), true);
  assert.equal(commands.some((command) => command.includes('evaluators register')), true);
  assert.equal(commands.some((command) => command.includes('--network arbitrum-sepolia')), true);
  assert.equal(commands.some((command) => command.includes('attestations threshold-config')), true);
  assert.equal(commands.some((command) => command.includes('attestations threshold-runtime')), true);
  assert.equal(commands.some((command) => command.includes('access policy --network arbitrum-sepolia')), true);
  assert.equal(
    commands.some(
      (command) => command.includes('purchase') && command.includes('--policy-id') && command.includes('--runtime-inputs-file'),
    ),
    true,
  );
});

test('buildWalletBackedProviderUaid derives a deterministic wallet-backed UAID', () => {
  const uaid = buildWalletBackedProviderUaid({
    chainId: 46630,
    walletAddress: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
  });

  assert.match(uaid, /^uaid:/);
  assert.match(uaid, /eip155:46630:/);
  assert.match(uaid.toLowerCase(), /0x8ba1f109551bd432803012645ac136ddd64dba72/);
});

test('.env.example defaults the broker to production hol.org', () => {
  const envExample = readFileSync(resolve(PROJECT_ROOT, '.env.example'), 'utf8');

  assert.match(envExample, /^REGISTRY_BROKER_BASE_URL=https:\/\/hol\.org\/registry\/api\/v1$/m);
  assert.doesNotMatch(envExample, /127\.0\.0\.1:4000|localhost:4000/);
  assert.doesNotMatch(envExample, /REGISTRY_BROKER_API_KEY=local-dev-api-key-change-me/);
});
