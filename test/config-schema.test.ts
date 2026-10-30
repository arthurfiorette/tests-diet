import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Value } from 'typebox/value';
import { loadConfig } from '../src/config.js';
import { ConfigFileSchema, SCHEMA_URL } from '../src/config-schema.js';

// Every ```json block of the README that is a config file must match the schema.
test('README config examples match the schema', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const blocks = [...readme.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1] ?? ''));
  assert.ok(blocks.length >= 2);
  for (const block of blocks) {
    assert.deepEqual([...Value.Errors(ConfigFileSchema, block)], [], JSON.stringify(block));
  }
  assert.equal(Value.Check(ConfigFileSchema, { budget: 0 }), false);
  assert.equal(Value.Check(ConfigFileSchema, { unknownKey: true }), false);
});

test('a config file may point at the schema', () => {
  const root = mkdtempSync(join(tmpdir(), 'tests-diet-config-'));
  writeFileSync(
    join(root, 'tests-diet.config.json'),
    JSON.stringify({ $schema: SCHEMA_URL, budget: 40_000 })
  );
  const config = loadConfig(root);
  assert.equal(config.budget, 40_000);
  assert.equal('$schema' in config, false);
});
