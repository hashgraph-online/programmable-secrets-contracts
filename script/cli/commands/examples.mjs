import { CliError } from '../errors.mjs';
import { emitResult, printHeading, printSuccess, serializeJson } from '../output.mjs';
import { readOption, requireOption, resolveOutputPath } from '../options.mjs';
import { CLI_RUNTIME } from '../runtime.mjs';
import { maybeWriteJsonFile } from '../index-support.mjs';
import { EXAMPLE_REGISTRY } from '../examples-data.mjs';

export async function runExamplesCommand(tokens, parseCliArgs) {
  const { positionals, options } = parseCliArgs(tokens);
  const subcommand = positionals[0] || 'list';
  if (subcommand === 'list') {
    emitResult('examples', { examples: EXAMPLE_REGISTRY });
    if (!CLI_RUNTIME.json) {
      console.log(serializeJson(EXAMPLE_REGISTRY));
    }
    return;
  }
  const exampleName = requireOption(options, ['name', 'example'], 'example name');
  const example = EXAMPLE_REGISTRY[exampleName];
  if (!example) {
    throw new CliError('EXAMPLE_MISSING', `Unknown example "${exampleName}".`, 'Use programmable-secret examples list.');
  }
  if (subcommand === 'show') {
    const payload = { name: exampleName, example };
    const outputPath = resolveOutputPath(options);
    if (outputPath) {
      const writtenPath = maybeWriteJsonFile(outputPath, payload, serializeJson);
      if (CLI_RUNTIME.json) {
        emitResult('example', { outputPath: writtenPath, ...payload });
        return;
      }
      printSuccess(`Wrote example to ${writtenPath}`);
      return;
    }
    emitResult('example', payload);
    if (!CLI_RUNTIME.json) {
      printHeading(exampleName);
      console.log(serializeJson(payload));
    }
    return;
  }
  throw new CliError('UNKNOWN_SUBCOMMAND', `Unknown examples command "${subcommand}".`, 'See "programmable-secret help examples".');
}
