#!/usr/bin/env node
import { runCli } from './cli/main.mjs';

await runCli();
process.exit(process.exitCode ?? 0);
