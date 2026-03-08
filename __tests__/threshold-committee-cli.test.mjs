import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeAbiParameters, parseAbiParameters, verifyMessage } from 'viem';
import { hexToBytes } from 'viem/utils';
import {
  buildThresholdCommitteeConfig,
  buildThresholdCommitteeRuntime,
} from '../script/cli/threshold-committee.mjs';

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

function parseCliJson(args) {
  const result = runCli([...args, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('buildThresholdCommitteeConfig sorts the committee and encodes config data', () => {
  const payload = buildThresholdCommitteeConfig({
    committee:
      '0x0000000000000000000000000000000000000003,0x0000000000000000000000000000000000000001,0x0000000000000000000000000000000000000002',
    maxDeadlineUnix: 1_800_000_000n,
    policyContextHash:
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    threshold: 2,
  });

  assert.deepEqual(payload.committee, [
    '0x0000000000000000000000000000000000000001',
    '0x0000000000000000000000000000000000000002',
    '0x0000000000000000000000000000000000000003',
  ]);

  const decoded = decodeAbiParameters(
    parseAbiParameters('bytes32 policyContextHash,uint64 maxDeadline,uint8 threshold,address[] committee'),
    payload.configData,
  );
  assert.equal(decoded[2], 2);
  assert.equal(decoded[1], 1_800_000_000n);
  assert.deepEqual(decoded[3], payload.committee);
});

test('attestations threshold-config emits a sorted CLI payload', () => {
  const payload = parseCliJson([
    'attestations',
    'threshold-config',
    '--committee',
    '0x0000000000000000000000000000000000000003,0x0000000000000000000000000000000000000001,0x0000000000000000000000000000000000000002',
    '--threshold',
    '2',
    '--policy-context-text',
    'committee-release-v1',
    '--max-deadline-unix',
    '1800000000',
  ]);

  assert.equal(payload.kind, 'threshold-committee-config');
  assert.deepEqual(payload.payload.committee, [
    '0x0000000000000000000000000000000000000001',
    '0x0000000000000000000000000000000000000002',
    '0x0000000000000000000000000000000000000003',
  ]);
});

test('buildThresholdCommitteeRuntime signs the message and pads runtime inputs', async () => {
  const payload = await buildThresholdCommitteeRuntime({
    buyer: '0x00000000000000000000000000000000000000b1',
    chainId: 46630,
    committeePrivateKeys:
      '0x59c6995e998f97a5a0044976f7ad1f97c9e5fa7a1f7d8b6b8b9d5b9d0f9f1e51,0x8b3a350cf5c34c9194ca6ae1850f1f8c2bff88f0d98c47d2d0c1bd4015da9e3d',
    conditionCount: 3,
    conditionIndex: 1,
    deadline: 1_800_000_000n,
    evaluator: '0x00000000000000000000000000000000000000e1',
    policyContextHash:
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    policyId: 7,
    policyVault: '0x00000000000000000000000000000000000000f1',
    recipient: '0x00000000000000000000000000000000000000b1',
  });

  assert.equal(payload.runtimeInputs.length, 3);
  assert.equal(payload.runtimeInputs[0], '0x');
  assert.equal(payload.runtimeInputs[1], payload.runtimeData);
  assert.equal(payload.runtimeInputs[2], '0x');
  assert.equal(payload.signers.length, 2);

  const decoded = decodeAbiParameters(
    parseAbiParameters('uint64 deadline,bytes[] signatures'),
    payload.runtimeData,
  );
  assert.equal(decoded[0], 1_800_000_000n);
  assert.equal(decoded[1].length, 2);

  const verified = await Promise.all(
    payload.signers.map((signer, index) =>
      verifyMessage({
        address: signer,
        message: { raw: hexToBytes(payload.messageHash) },
        signature: payload.signatures[index],
      }),
    ),
  );
  assert.deepEqual(verified, [true, true]);
});

test('attestations threshold-runtime emits padded runtime inputs for the CLI', async () => {
  const payload = parseCliJson([
    'attestations',
    'threshold-runtime',
    '--policy-id',
    '7',
    '--buyer',
    '0x00000000000000000000000000000000000000b1',
    '--recipient',
    '0x00000000000000000000000000000000000000b1',
    '--evaluator',
    '0x00000000000000000000000000000000000000e1',
    '--policy-vault',
    '0x00000000000000000000000000000000000000f1',
    '--policy-context-hash',
    '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '--deadline-unix',
    '1800000000',
    '--committee-private-keys',
    '0x59c6995e998f97a5a0044976f7ad1f97c9e5fa7a1f7d8b6b8b9d5b9d0f9f1e51,0x8b3a350cf5c34c9194ca6ae1850f1f8c2bff88f0d98c47d2d0c1bd4015da9e3d',
    '--condition-count',
    '3',
    '--condition-index',
    '1',
  ]);

  assert.equal(payload.kind, 'threshold-committee-runtime');
  assert.equal(payload.payload.runtimeInputs.length, 3);
  assert.equal(payload.payload.runtimeInputs[1], payload.payload.runtimeData);

  const verified = await Promise.all(
    payload.payload.signers.map((signer, index) =>
      verifyMessage({
        address: signer,
        message: { raw: hexToBytes(payload.payload.messageHash) },
        signature: payload.payload.signatures[index],
      }),
    ),
  );
  assert.deepEqual(verified, [true, true]);
});
