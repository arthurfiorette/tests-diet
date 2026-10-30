#!/usr/bin/env node

import { main } from '../dist/cli.js';

// Explicit exit: extensions loaded from the user's pi packages may keep timers alive.
try {
  process.exit(await main());
} catch (error) {
  process.stderr.write(`tests-diet: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
