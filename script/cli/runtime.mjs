import { config as loadDotenv } from 'dotenv';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  CLI_COMMAND,
  CLI_CONFIG_DIR,
  CLI_CONFIG_PATH,
  ENV_PATH_CANDIDATES,
} from './constants.mjs';
import { CliError } from './errors.mjs';

export const CLI_RUNTIME = {
  agentSafe: false,
  command: null,
  globalOptions: {},
  interactive: false,
  json: false,
  noColor: false,
  profile: null,
  profileName: null,
  quiet: false,
  yes: false,
};

function loadEnvironment() {
  for (const path of ENV_PATH_CANDIDATES) {
    if (!existsSync(path)) {
      continue;
    }
    loadDotenv({
      path,
      override: false,
    });
  }
}

loadEnvironment();

function ensureConfigDir() {
  mkdirSync(CLI_CONFIG_DIR, {
    recursive: true,
  });
}

export function getDefaultConfig() {
  return {
    defaultProfile: 'robinhood-agent',
    profiles: {
      'arbitrum-agent': {
        interactive: false,
        network: 'arbitrum-sepolia',
        wallet: 'agent',
      },
      provider: {
        interactive: false,
        network: 'robinhood-testnet',
        payout: 'provider-wallet',
        wallet: 'provider',
      },
      'robinhood-agent': {
        interactive: false,
        network: 'robinhood-testnet',
        wallet: 'agent',
      },
    },
  };
}

export function loadCliConfig() {
  if (!existsSync(CLI_CONFIG_PATH)) {
    return getDefaultConfig();
  }
  try {
    const parsed = JSON.parse(readFileSync(CLI_CONFIG_PATH, 'utf8'));
    return {
      ...getDefaultConfig(),
      ...parsed,
      profiles: {
        ...getDefaultConfig().profiles,
        ...(parsed.profiles || {}),
      },
    };
  } catch (error) {
    throw new CliError(
      'CONFIG_INVALID',
      `Unable to parse ${CLI_CONFIG_PATH}.`,
      `Fix the JSON syntax in ${CLI_CONFIG_PATH} or rerun ${CLI_COMMAND} init --force.`,
      error instanceof Error ? error.message : `${error}`,
    );
  }
}

export function writeCliConfig(config, outputPath = CLI_CONFIG_PATH, overwrite = false) {
  if (existsSync(outputPath) && !overwrite) {
    throw new CliError(
      'CONFIG_EXISTS',
      `${outputPath} already exists.`,
      `Pass --force or remove the file before rerunning ${CLI_COMMAND} init.`,
    );
  }
  ensureConfigDir();
  writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`);
}

export function getProfileOptions() {
  return CLI_RUNTIME.profile?.options || CLI_RUNTIME.profile?.settings || CLI_RUNTIME.profile || {};
}

export function initializeRuntime({
  commandName,
  globalOptions,
  parseBooleanOption,
  readOption,
}) {
  const config = loadCliConfig();
  const profileName = readOption(globalOptions, ['profile'], config.defaultProfile || null);
  const profile = profileName ? config.profiles?.[profileName] || null : null;
  CLI_RUNTIME.command = commandName;
  CLI_RUNTIME.globalOptions = globalOptions;
  CLI_RUNTIME.profileName = profileName || null;
  CLI_RUNTIME.profile = profile;
  CLI_RUNTIME.agentSafe = parseBooleanOption(readOption(globalOptions, ['agent-safe'], false), false);
  CLI_RUNTIME.json = CLI_RUNTIME.agentSafe || parseBooleanOption(readOption(globalOptions, ['json'], false), false);
  CLI_RUNTIME.quiet = CLI_RUNTIME.agentSafe || parseBooleanOption(readOption(globalOptions, ['quiet'], false), false);
  CLI_RUNTIME.noColor = CLI_RUNTIME.agentSafe || parseBooleanOption(readOption(globalOptions, ['no-color'], false), false);
  CLI_RUNTIME.yes = CLI_RUNTIME.agentSafe || parseBooleanOption(readOption(globalOptions, ['yes'], false), false);
  CLI_RUNTIME.interactive = CLI_RUNTIME.agentSafe
    ? false
    : parseBooleanOption(readOption(globalOptions, ['interactive'], false), false) && Boolean(process.stdin.isTTY && process.stdout.isTTY);
}
