import readline from 'node:readline/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { keccak256, toBytes } from 'viem';
import { CLI_COMMAND } from './constants.mjs';
import { CliError } from './errors.mjs';
import { resolvePreferredEnvValue } from './env.mjs';
import { serializeJson } from './output.mjs';
import { CLI_RUNTIME, getProfileOptions } from './runtime.mjs';

export function parseCliArgs(tokens) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split('=');
    const key = rawKey.trim();
    if (!key) {
      continue;
    }
    if (inlineValue !== undefined) {
      options[key] = inlineValue;
      continue;
    }
    const nextToken = tokens[index + 1];
    if (!nextToken || nextToken.startsWith('--')) {
      options[key] = true;
      continue;
    }
    options[key] = nextToken;
    index += 1;
  }
  return { positionals, options };
}

export function readOption(options, names, fallback = null) {
  const optionNames = Array.isArray(names) ? names : [names];
  for (const name of optionNames) {
    const value = options[name];
    if (value !== undefined && value !== null && `${value}`.trim() !== '') {
      return `${value}`.trim();
    }
  }
  const profileOptions = getProfileOptions();
  for (const name of optionNames) {
    const value = profileOptions[name];
    if (value !== undefined && value !== null && `${value}`.trim() !== '') {
      return `${value}`.trim();
    }
  }
  return fallback;
}

export function requireOption(options, names, description) {
  const value = readOption(options, names);
  if (value !== null) {
    return value;
  }
  const label = Array.isArray(names) ? names.join(' or ') : names;
  throw new CliError(
    'MISSING_OPTION',
    `Missing ${description}.`,
    `Provide --${label} or rerun with --interactive.`,
    { description, option: label },
  );
}

export function parseBooleanOption(value, fallback = false) {
  if (value === null || value === undefined) {
    return fallback;
  }
  const normalized = `${value}`.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }
  throw new CliError('INVALID_BOOLEAN', `Invalid boolean value "${value}".`, 'Expected true or false.');
}

export function parseBigIntValue(value, description) {
  try {
    return BigInt(value);
  } catch {
    throw new CliError('INVALID_NUMBER', `Invalid ${description}: "${value}"`);
  }
}

export function parseUintValue(value, description) {
  const parsed = Number.parseInt(`${value}`.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new CliError('INVALID_NUMBER', `Invalid ${description}: "${value}"`);
  }
  return parsed;
}

export function parseAddressList(value, getAddress) {
  if (!value) {
    return [];
  }
  return `${value}`.split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => getAddress(entry));
}

export function normalizeHash(value, description) {
  const trimmed = `${value}`.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed;
  }
  throw new CliError('INVALID_HASH', `Invalid ${description}.`, 'Expected a 32-byte hex string.');
}

export function buildHashFromText(value) {
  return keccak256(toBytes(value));
}

function resolveHashOption(options, config) {
  const directHash = readOption(options, config.hashOptionNames ?? [config.hashOption]);
  if (directHash) {
    return normalizeHash(directHash, config.description);
  }
  const directValue = readOption(options, config.valueOptionNames ?? [config.valueOption]);
  if (directValue) {
    return buildHashFromText(directValue);
  }
  const filePath = readOption(options, config.fileOptionNames ?? [config.fileOption]);
  if (filePath) {
    return keccak256(`0x${readFileSync(resolve(filePath)).toString('hex')}`);
  }
  const jsonValue = readOption(options, config.jsonOptionNames ?? [config.jsonOption]);
  if (jsonValue) {
    return buildHashFromText(jsonValue);
  }
  if (config.fallback !== undefined) {
    return config.fallback;
  }
  throw new CliError('MISSING_HASH_SOURCE', `Missing ${config.description}.`, `Provide ${config.example}.`);
}

export function resolveMetadataHash(options) {
  return resolveHashOption(options, {
    description: 'metadata hash',
    hashOptionNames: ['metadata-hash'],
    valueOptionNames: ['metadata'],
    fileOptionNames: ['metadata-file'],
    jsonOptionNames: ['metadata-json'],
    example: '--metadata-hash 0x... or --metadata-json \'{"title":"TSLA"}\'',
  });
}

export function resolveDatasetRegistrationHashes(options, providerUaidFallback = null) {
  return {
    ciphertextHash: resolveHashOption(options, {
      description: 'ciphertext hash',
      hashOptionNames: ['ciphertext-hash'],
      valueOptionNames: ['ciphertext'],
      fileOptionNames: ['ciphertext-file'],
      example: '--ciphertext-hash 0x... or --ciphertext "encrypted payload"',
    }),
    keyCommitment: resolveHashOption(options, {
      description: 'key commitment',
      hashOptionNames: ['key-commitment'],
      valueOptionNames: ['key-material'],
      fileOptionNames: ['key-file'],
      example: '--key-commitment 0x... or --key-material "buyer-bound envelope key"',
    }),
    metadataHash: resolveMetadataHash(options),
    providerUaidHash: resolveHashOption(options, {
      description: 'provider UAID hash',
      hashOptionNames: ['provider-uaid-hash'],
      valueOptionNames: ['provider-uaid'],
      example: '--provider-uaid-hash 0x... or --provider-uaid uaid:did:pkh:eip155:46630:0x1111111111111111111111111111111111111111;nativeId=eip155:46630:0x1111111111111111111111111111111111111111',
      fallback: providerUaidFallback ? buildHashFromText(providerUaidFallback) : undefined,
    }),
  };
}

export function resolvePriceWei(options) {
  const priceWei = readOption(options, ['price-wei']);
  if (priceWei) {
    return parseBigIntValue(priceWei, 'price-wei');
  }
  const priceEth = readOption(options, ['price-eth']);
  if (priceEth) {
    const normalized = `${priceEth}`.trim();
    if (!/^\d+(\.\d+)?$/.test(normalized)) {
      throw new CliError('INVALID_PRICE', `Invalid price-eth: "${priceEth}"`);
    }
    const [whole, fractional = ''] = normalized.split('.');
    const paddedFractional = `${fractional}000000000000000000`.slice(0, 18);
    return parseBigIntValue(`${whole}${paddedFractional}`, 'price-eth');
  }
  return parseBigIntValue(
    resolvePreferredEnvValue('PROGRAMMABLE_SECRETS_PRICE_WEI', ['DEMO_PRICE_WEI'], '10000000000000').value,
    'price',
  );
}

export function resolveExpiryUnix(options) {
  const explicitUnix = readOption(options, ['expires-at-unix']);
  if (explicitUnix) {
    return BigInt(parseUintValue(explicitUnix, 'expires-at-unix'));
  }
  const explicitIso = readOption(options, ['expires-at-iso']);
  if (explicitIso) {
    const parsed = Date.parse(explicitIso);
    if (!Number.isFinite(parsed)) {
      throw new CliError('INVALID_DATE', `Invalid expires-at-iso: "${explicitIso}"`);
    }
    return BigInt(Math.floor(parsed / 1000));
  }
  const durationHours = readOption(options, ['duration-hours']);
  if (durationHours) {
    return BigInt(Math.floor(Date.now() / 1000) + parseUintValue(durationHours, 'duration-hours') * 60 * 60);
  }
  const envValue = resolvePreferredEnvValue('PROGRAMMABLE_SECRETS_EXPIRES_AT_UNIX', ['DEMO_EXPIRES_AT_UNIX'], '').value;
  if (envValue) {
    return BigInt(parseUintValue(envValue, 'PROGRAMMABLE_SECRETS_EXPIRES_AT_UNIX'));
  }
  return BigInt(Math.floor(Date.now() / 1000) + 24 * 60 * 60);
}

export function resolveSelectedWalletRole(options, fallback) {
  const role = readOption(options, ['wallet', 'actor'], fallback);
  if (!['agent', 'provider'].includes(role)) {
    throw new CliError('INVALID_WALLET_ROLE', `Invalid wallet role "${role}".`, 'Expected agent or provider.');
  }
  return role;
}

export function resolveOutputPath(options, fallback = null) {
  return readOption(options, ['output', 'output-file'], fallback);
}

async function promptValue(question, fallback = '') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const promptSuffix = fallback ? ` [${fallback}]` : '';
    const answer = (await rl.question(`${question}${promptSuffix}: `)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

async function maybePromptOption(options, names, question, fallback = null) {
  const existing = readOption(options, names, null);
  if (existing !== null) {
    return existing;
  }
  if (!CLI_RUNTIME.interactive) {
    return fallback;
  }
  const answer = await promptValue(question, fallback ?? '');
  if (answer) {
    options[Array.isArray(names) ? names[0] : names] = answer;
    return answer;
  }
  return fallback;
}

export async function completeInteractiveOptions(commandName, subcommand, options) {
  if (!CLI_RUNTIME.interactive) {
    return options;
  }
  if (commandName === 'datasets' && subcommand === 'register') {
    await maybePromptOption(options, ['provider-uaid'], 'Provider UAID');
    await maybePromptOption(options, ['metadata-json'], 'Dataset metadata JSON', '{"title":"TSLA volatility dataset"}');
    await maybePromptOption(options, ['ciphertext'], 'Ciphertext placeholder');
    await maybePromptOption(options, ['key-material'], 'Key material placeholder');
  }
  if (commandName === 'policies' && subcommand === 'create-timebound') {
    await maybePromptOption(options, ['dataset-id'], 'Dataset id');
    await maybePromptOption(options, ['price-eth'], 'Price in ETH', '0.00001');
    await maybePromptOption(options, ['duration-hours'], 'Access duration in hours', '24');
    await maybePromptOption(options, ['metadata-json'], 'Policy metadata JSON', '{"title":"24 hour access"}');
  }
  if (commandName === 'policies' && subcommand === 'create-uaid') {
    await maybePromptOption(options, ['dataset-id'], 'Dataset id');
    await maybePromptOption(options, ['price-eth'], 'Price in ETH', '0.00001');
    await maybePromptOption(options, ['duration-hours'], 'Access duration in hours', '24');
    await maybePromptOption(options, ['required-buyer-uaid'], 'Required buyer UAID');
    await maybePromptOption(options, ['agent-id'], 'ERC-8004 agent id');
    await maybePromptOption(options, ['metadata-json'], 'Policy metadata JSON', '{"title":"UAID-gated access"}');
  }
  if (commandName === 'policies' && subcommand === 'update') {
    await maybePromptOption(options, ['policy-id'], 'Policy id');
  }
  if (commandName === 'policies' && subcommand === 'allowlist') {
    await maybePromptOption(options, ['policy-id'], 'Policy id');
    await maybePromptOption(options, ['accounts'], 'Comma-separated wallet addresses');
    await maybePromptOption(options, ['allowed'], 'Allowlist state', 'true');
  }
  if (commandName === 'purchase') {
    await maybePromptOption(options, ['policy-id'], 'Policy id');
  }
  if (commandName === 'identity' && subcommand === 'register') {
    await maybePromptOption(options, ['agent-uri'], 'Agent URI', 'https://hol.org/agents/volatility-trading-agent-custodian');
  }
  if (commandName === 'krs' && subcommand === 'encrypt') {
    await maybePromptOption(options, ['plaintext'], 'Plaintext payload');
    await maybePromptOption(options, ['title'], 'Bundle title', 'TSLA volatility signal bundle');
  }
  if (commandName === 'krs' && subcommand === 'decrypt') {
    await maybePromptOption(options, ['bundle-file'], 'Bundle file path');
  }
  return options;
}

export function shouldPreview(options) {
  return parseBooleanOption(readOption(options, ['preview', 'explain'], false), false);
}

export function stringifyArgs(value) {
  return serializeJson(value);
}
