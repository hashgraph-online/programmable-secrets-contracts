import { Buffer } from 'node:buffer';
import { formatEther } from 'viem';
import { CLI_RUNTIME } from './runtime.mjs';

export function jsonReplacer(_key, value) {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return `0x${Buffer.from(value).toString('hex')}`;
  }
  return value;
}

export function serializeJson(value) {
  return JSON.stringify(value, jsonReplacer, 2);
}

export function emitJson(payload) {
  console.log(serializeJson(payload));
}

export function emitResult(kind, payload) {
  if (CLI_RUNTIME.json) {
    emitJson({
      kind,
      payload,
      profile: CLI_RUNTIME.profileName,
      timestamp: new Date().toISOString(),
    });
  }
}

export function createReadResult(kind, payload, extra = {}) {
  return {
    ...extra,
    kind,
    network: payload.network || null,
    profile: CLI_RUNTIME.profileName,
    result: payload,
  };
}

export function createTransactionResult({
  action,
  chain,
  contract,
  explorerUrl,
  nextCommand = null,
  txHash,
  valueWei = 0n,
  wallet,
  ...rest
}) {
  return {
    action,
    chainId: chain.id,
    contract,
    explorerUrl,
    network: chain.name,
    nextCommand,
    txHash,
    valueWei,
    wallet,
    ...rest,
  };
}

export function printHeading(title) {
  if (!CLI_RUNTIME.json && !CLI_RUNTIME.quiet) {
    console.log(`\n=== ${title} ===`);
  }
}

export function printField(label, value) {
  if (!CLI_RUNTIME.json && !CLI_RUNTIME.quiet) {
    console.log(`${label.padEnd(16)} ${value}`);
  }
}

export function printExplorerLink(chain, hash) {
  if (chain?.explorerBaseUrl) {
    printField('Explorer', `${chain.explorerBaseUrl}/tx/${hash}`);
  }
}

export function printStep(stepNumber, title) {
  if (!CLI_RUNTIME.json && !CLI_RUNTIME.quiet) {
    console.log(`\n[${stepNumber}] ${title}`);
  }
}

export function printSuccess(message) {
  if (!CLI_RUNTIME.json && !CLI_RUNTIME.quiet) {
    console.log(`\n[ok] ${message}`);
  }
}

export function printWarning(message) {
  if (!CLI_RUNTIME.json && !CLI_RUNTIME.quiet) {
    console.log(`\n[warn] ${message}`);
  }
}

export function printInfo(message) {
  if (!CLI_RUNTIME.json && !CLI_RUNTIME.quiet) {
    console.log(`\n[i] ${message}`);
  }
}

export function printCommandUsage(lines) {
  for (const line of lines) {
    console.log(line);
  }
}

export function printTransactionResult(result) {
  if (CLI_RUNTIME.json) {
    emitResult('transaction', result);
    return;
  }
  printHeading(result.action);
  printField('Network', result.network);
  printField('Contract', result.contract);
  printField('Wallet', result.wallet);
  if (result.entityLabel && result.entityValue !== undefined) {
    printField(result.entityLabel, result.entityValue);
  }
  if (result.secondaryLabel && result.secondaryValue !== undefined) {
    printField(result.secondaryLabel, result.secondaryValue);
  }
  if (result.valueWei !== undefined) {
    printField('Value', `${formatEther(BigInt(result.valueWei))} ETH (${result.valueWei} wei)`);
  }
  printField('Tx', result.txHash);
  if (result.explorerUrl) {
    printField('Explorer', result.explorerUrl);
  }
  if (result.nextCommand) {
    printField('Next', result.nextCommand);
  }
}

export function emitPreview(preview) {
  if (CLI_RUNTIME.json) {
    emitResult('preview', preview);
    return true;
  }
  printHeading(`Preview: ${preview.action}`);
  printField('Network', preview.network);
  printField('Contract', preview.contract);
  printField('Address', preview.address);
  printField('Wallet', preview.wallet);
  printField('Function', preview.functionName);
  if (preview.valueWei !== undefined) {
    printField('Value', `${formatEther(BigInt(preview.valueWei))} ETH (${preview.valueWei} wei)`);
  }
  printInfo(`Args: ${serializeJson(preview.args)}`);
  if (Array.isArray(preview.conditions) && preview.conditions.length > 0) {
    printField('Conditions', preview.conditions.length);
    for (const condition of preview.conditions) {
      console.log(`  - [${condition.index}] ${condition.builtInKind || 'custom'} :: ${condition.description}`);
      console.log(`    runtime witness: ${condition.runtimeWitnessLabel}`);
    }
  }
  if (preview.nextCommand) {
    printField('Next', preview.nextCommand);
  }
  return true;
}
