#!/usr/bin/env node

// USAGE:
//    node fv/run.js [CONFIG]* [--all]
// EXAMPLES:
//    node fv/run.js --all
//    node fv/run.js ERC721
//    node fv/run.js fv/specs/ERC721.conf

const glob = require('glob');
const fs = require('fs');
const pLimit = require('p-limit').default;
const { hideBin } = require('yargs/helpers');
const yargs = require('yargs/yargs');
const { execFile } = require('child_process');

const { argv } = yargs(hideBin(process.argv))
  .env('')
  .options({
    all: {
      type: 'boolean',
    },
    parallel: {
      alias: 'p',
      type: 'number',
      default: 4,
    },
    verbose: {
      alias: 'v',
      type: 'count',
      default: 0,
    },
  });

const pattern = 'fv/specs/*.conf';
const limit = pLimit(argv.parallel);
const confNamePattern = /^[a-zA-Z0-9._/-]+$/;
const certoraOutputPattern = /https:\/\/prover\.certora\.com\/output\/[a-z0-9]+\/[a-z0-9]+\?anonymousKey=[a-z0-9]+/;

function resolveSpecConf(name) {
  if (typeof name !== 'string' || name.length === 0 || !confNamePattern.test(name)) {
    throw new Error(`Invalid spec name: ${name}`);
  }

  if (fs.existsSync(name)) {
    return name;
  }

  return pattern.replaceAll('*', name);
}

if (argv._.length == 0 && !argv.all) {
  console.error(`Warning: No specs requested. Did you forget to toggle '--all'?`);
  process.exitCode = 1;
} else {
  let confs;
  try {
    confs = argv.all ? glob.sync(pattern) : argv._.map(resolveSpecConf);
  } catch (error) {
    console.error(`[ERR] ${(error && error.message) || error}`);
    process.exitCode = 1;
    process.exit();
  }

  Promise.all(
    confs.map(
      (conf, i, { length }) =>
        limit(
          () =>
            new Promise(resolve => {
              if (argv.verbose) console.log(`[${i + 1}/${length}] Running ${conf}`);
              execFile('certoraRun', [conf], (error, stdout, stderr) => {
                const match = stdout.match(certoraOutputPattern);
                if (error) {
                  console.error(`[ERR] ${conf} failed with:\n${stderr || stdout}`);
                  process.exitCode = 1;
                } else if (match) {
                  console.log(`${conf} - ${match[0]}`);
                } else {
                  console.error(`[ERR] Could not parse stdout for ${conf}:\n${stdout}`);
                  process.exitCode = 1;
                }
                resolve();
              });
            }),
        ),
    ),
  );
}
