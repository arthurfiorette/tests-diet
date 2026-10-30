// Writes schema.json (the JSON schema of tests-diet.config.json) at the repository root. GitHub
// Pages serves it at SCHEMA_URL and it ships in the npm package; CI fails when it is stale.
import { writeFileSync } from 'node:fs';
import { ConfigFileSchema } from '../src/config-schema.js';

const schema = { $schema: 'http://json-schema.org/draft-07/schema#', ...ConfigFileSchema };
writeFileSync(new URL('../schema.json', import.meta.url), `${JSON.stringify(schema, null, 2)}\n`);
