import { type Static, type TSchema, Type } from 'typebox';
import { type ConfigFile, defaultConfig, THINKING_LEVELS, TRANSPORTS } from './config.js';
import type { LanguagePreset } from './types.js';

/** Where the generated `schema.json` is published (GitHub Pages of the repository). */
export const SCHEMA_URL = 'https://arthur.run/tests-diet/schema.json';

const stringEnum = <T extends readonly string[]>(
  values: T,
  description: string,
  value?: T[number]
) =>
  Type.Unsafe<T[number]>({
    type: 'string',
    enum: [...values],
    description,
    ...(value === undefined ? {} : { default: value })
  });

const globs = (description: string) => Type.Array(Type.String(), { description });
const defaults = defaultConfig('.');

const FileMatcherSchema = Type.Object(
  {
    include: globs('Globs relative to the project root.'),
    contains: Type.Optional(
      Type.String({
        description: 'Regex (multiline) the file content must match, e.g. `#\\[test\\]`.'
      })
    ),
    inline: Type.Optional(
      Type.Boolean({
        description:
          'Matched files are production code with embedded tests: never deleted as a whole.'
      })
    )
  },
  { additionalProperties: false }
);

const LanguagePresetSchema = Type.Object(
  {
    name: Type.String(),
    matchers: Type.Array(FileMatcherSchema, {
      description: 'A file belongs to the language if any matcher accepts it.'
    }),
    caseStart: Type.Optional(
      Type.String({
        description:
          'Regex matching the line where a test case starts. Without it the agent finds cases alone and files are never deleted as a whole.'
      })
    ),
    attribute: Type.Optional(
      Type.String({
        description:
          'Regex for decorator/attribute lines that belong to the case below them (`@pytest.mark...`, `#[ignore]`).'
      })
    ),
    blockComments: Type.Optional(
      Type.Boolean({
        description:
          'Blank `/* ... */` comments before scanning, so commented-out tests are not detected.'
      })
    ),
    blocks: Type.Optional(
      stringEnum(
        ['braces', 'indent'] as const,
        "How a case's last line is found: balanced `()`/`{}`, or indentation (Python). Unset: the agent reports it."
      )
    )
  },
  { additionalProperties: false }
);

// Fails to compile when the schema and `LanguagePreset` drift apart.
true satisfies Static<typeof LanguagePresetSchema> extends LanguagePreset
  ? LanguagePreset extends Static<typeof LanguagePresetSchema>
    ? true
    : false
  : false;

const positive = (description: string, value: number) =>
  Type.Integer({ minimum: 1, description, default: value });

// `satisfies` makes a key missing from, or unknown to, `ConfigFile` a compile error.
const properties = {
  $schema: Type.String({ description: 'JSON schema of this file.' }),
  languages: Type.Array(LanguagePresetSchema, {
    description: 'Replaces the default languages. Prefer `extraLanguages` to add one.'
  }),
  extraLanguages: Type.Array(LanguagePresetSchema, {
    description: 'Languages checked before the defaults (the first matching language wins).'
  }),
  include: globs('Only files matching one of these globs are considered.'),
  exclude: globs(
    'Added to the default excludes (node_modules, dist, build, target, virtual environments, ...).'
  ),
  budget: positive('Target tokens of test code per group.', defaults.budget),
  minGroup: positive(
    'Groups smaller than this are merged with neighbors when possible.',
    defaults.minGroup
  ),
  tolerance: Type.Number({
    minimum: 0,
    description: 'Allowed overshoot over `budget`, as a fraction.',
    default: defaults.tolerance
  }),
  outDir: Type.String({
    description: 'Directory for state, sessions and reports, relative to the root.',
    default: defaults.outDir
  }),
  model: Type.String({
    description:
      'Model pattern resolved through your pi config, e.g. `claude-haiku-5-5` or `provider/id:low`.'
  }),
  thinking: stringEnum(THINKING_LEVELS, 'Thinking level of the agents.', defaults.thinking),
  concurrency: positive(
    'Maximum parallel agents; never more than there are groups.',
    defaults.concurrency
  ),
  instructions: Type.String({
    description:
      'Markdown file with repository-specific rules appended to the rubric, relative to the root.'
  }),
  maxRejections: positive(
    'Rejected `submit_file_report` calls tolerated per file before it is marked failed.',
    defaults.maxRejections
  ),
  maxIdleTurns: positive(
    "Model turns without an accepted report before the group's session is aborted.",
    defaults.maxIdleTurns
  ),
  agentDir: Type.String({
    description:
      "pi config directory for the pool (settings, auth, models, packages). Default: pi's own."
  }),
  mcpServers: Type.Record(Type.String(), Type.Object({}, { additionalProperties: true }), {
    description:
      "MCP servers for the pool only, in pi's `mcp.json` format (`command`/`args` or `url`). Exposure defaults to `direct`; their tools still need to be listed in `tools`."
  }),
  tools: Type.Array(Type.String(), {
    description:
      'Extra tool names or patterns the agents may call, e.g. `mcp__serena__find_symbol`.'
  }),
  extensions: Type.Array(Type.String(), {
    description: 'Extra pi extension files loaded in every agent session.'
  }),
  trustProject: Type.Boolean({
    description: "Load the audited project's `.pi` settings, packages and extensions.",
    default: defaults.trustProject
  }),
  transport: stringEnum(TRANSPORTS, 'Provider transport for the pool.', defaults.transport)
} satisfies Record<keyof ConfigFile | '$schema', TSchema>;

/** Schema of `tests-diet.config.json`. Every key is optional. */
export const ConfigFileSchema = Type.Partial(Type.Object(properties), {
  $id: SCHEMA_URL,
  title: 'tests-diet config',
  description:
    'Settings for tests-diet, read from tests-diet.config.json at the project root. CLI flags win.',
  additionalProperties: false
});
