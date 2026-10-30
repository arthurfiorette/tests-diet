import { type Static, type TSchema, Type } from 'typebox';
import { type ConfigFile, defaultConfig, THINKING_LEVELS, TRANSPORTS } from './config.js';
import type { LanguagePreset } from './types.js';

/** Where the generated `schema.json` is published (GitHub Pages of the repository). */
export const SCHEMA_URL = 'https://arthur.run/tests-diet/schema.json';

const README = 'https://github.com/arthurfiorette/tests-diet#readme';
const defaults = defaultConfig('.');

interface DocOptions {
  /** Matching command-line flag, shown under the text. */
  flag?: string;
  /** Default value, shown under the text and set as the schema `default`. */
  value?: unknown;
  examples?: unknown[];
}

/**
 * Editor documentation for a field. `markdownDescription` is what VS Code renders (code spans,
 * links, the flag and default); `description` is the same text without markup for other editors.
 */
function doc(markdown: string, options: DocOptions = {}) {
  const footer = [
    options.flag && `CLI: \`${options.flag}\``,
    options.value !== undefined && `Default: \`${JSON.stringify(options.value)}\``
  ].filter(Boolean);
  const full = footer.length ? `${markdown}\n\n${footer.join(' · ')}` : markdown;
  return {
    description: full.replace(/`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'),
    markdownDescription: full,
    ...(options.value === undefined ? {} : { default: options.value }),
    ...(options.examples ? { examples: options.examples } : {})
  };
}

/** A string enum with a description per value. Plain `{type, enum}`, which every editor reads. */
function stringEnum<T extends readonly string[]>(
  values: T,
  valueDocs: Record<T[number], string>,
  markdown: string,
  options: DocOptions = {}
) {
  const each = values.map((v) => valueDocs[v as T[number]]);
  return Type.Unsafe<T[number]>({
    type: 'string',
    enum: [...values],
    enumDescriptions: each.map((d) => d.replace(/`/g, '')),
    markdownEnumDescriptions: each,
    ...doc(markdown, options)
  });
}

const glob = Type.String(doc('A glob relative to the project root, e.g. `packages/*/test/**`.'));
const regex = (markdown: string, examples: string[]) =>
  Type.String(
    doc(
      `${markdown}\n\nA JavaScript regular expression source; escape backslashes in JSON (\`\\\\s\`).`,
      { examples }
    )
  );

const FileMatcherSchema = Type.Object(
  {
    include: Type.Array(
      glob,
      doc('Files matching any of these globs belong to the language.', {
        examples: [['**/*.spec.dsl']]
      })
    ),
    contains: Type.Optional(
      regex(
        'Only files whose content matches this regex (multiline). Use it when a glob alone also matches helpers, e.g. Rust files that contain `#[test]`.',
        ['#\\[cfg\\(test\\)\\]']
      )
    ),
    inline: Type.Optional(
      Type.Boolean(
        doc(
          'Matched files are production code with tests embedded (Rust `#[cfg(test)]` modules). They are pruned case by case and never deleted as a whole.',
          { value: false }
        )
      )
    )
  },
  { additionalProperties: false, ...doc('Which files belong to the language.') }
);

const LanguagePresetSchema = Type.Object(
  {
    name: Type.String(doc('Language name shown in plans and reports, e.g. `my-dsl`.')),
    matchers: Type.Array(
      FileMatcherSchema,
      doc(
        'A file belongs to the language when any matcher accepts it. The first matching language wins.'
      )
    ),
    caseStart: Type.Optional(
      regex(
        'Matches the line where a test case starts. Agents get the list of cases and must report each one. Without it, agents find cases on their own and files are never deleted as a whole.',
        ['^\\s*scenario\\b']
      )
    ),
    attribute: Type.Optional(
      regex(
        'Matches decorator or attribute lines that belong to the case below them (`@pytest.mark...`, `#[ignore]`, `[Theory]`). A case starts at its first such line, so deleting it never leaves a decorator behind.',
        ['^\\s*@', '^\\s*#\\[']
      )
    ),
    blockComments: Type.Optional(
      Type.Boolean(
        doc(
          'Ignore `/* ... */` comments when looking for cases, so commented-out tests are not detected.',
          { value: false }
        )
      )
    ),
    blocks: Type.Optional(
      stringEnum(
        ['braces', 'indent'] as const,
        {
          braces: 'The case ends where its `()`/`{}` brackets balance again.',
          indent: 'The case ends before the next line indented at or above it (Python).'
        },
        "How to find a case's last line. Unset: agents report it, and `tests-diet delete` leaves those cases to an agent."
      )
    )
  },
  {
    additionalProperties: false,
    ...doc('How to recognize the test files and test cases of one language.')
  }
);

// Fails to compile when the schema and `LanguagePreset` drift apart.
true satisfies Static<typeof LanguagePresetSchema> extends LanguagePreset
  ? LanguagePreset extends Static<typeof LanguagePresetSchema>
    ? true
    : false
  : false;

const positive = (markdown: string, options: DocOptions) =>
  Type.Integer({ minimum: 1, ...doc(markdown, options) });

const exposure = stringEnum(
  ['direct', 'deferred', 'codemode', 'hidden'] as const,
  {
    direct:
      'Tools are declared to the model like any other tool. Keeps the tool list identical across agents.',
    deferred: 'Tools are declared only after the model loads them with tool search.',
    codemode: 'Tools are callable only from codemode scripts.',
    hidden: 'Tools are registered but unreachable.'
  },
  "How the server's tools reach the model.",
  { value: 'direct' }
);

// A plain string: `${NAME}` here is pi's syntax, not a template literal.
const envValue = (what: string) =>
  Type.String(
    doc(`${what} May reference environment variables (\`$\{NAME}\`) or commands (\`!cmd\`).`)
  );

const McpServerSchema = Type.Object(
  {
    url: Type.Optional(
      Type.String(
        doc('URL of an HTTP (streamable) MCP server.', { examples: ['http://localhost:9121/mcp'] })
      )
    ),
    headers: Type.Optional(
      Type.Record(Type.String(), envValue('Header value.'), doc('HTTP headers sent to the server.'))
    ),
    command: Type.Optional(
      Type.String(doc('Command that starts a stdio MCP server.', { examples: ['uvx'] }))
    ),
    args: Type.Optional(
      Type.Array(Type.String(doc('One argument.')), doc('Arguments of `command`.'))
    ),
    env: Type.Optional(
      Type.Record(Type.String(), envValue('Variable value.'), doc('Environment of `command`.'))
    ),
    cwd: Type.Optional(Type.String(doc('Working directory of `command`.'))),
    exposure: Type.Optional(exposure),
    enabled: Type.Optional(
      Type.Boolean(doc('Set to `false` to keep the entry without connecting.', { value: true }))
    ),
    timeout: Type.Optional(Type.Number(doc('Per-request timeout in seconds.', { value: 60 })))
  },
  {
    // pi accepts more keys (oauth, auth, toolExposure, ...); it validates them itself.
    additionalProperties: true,
    ...doc(
      "One MCP server, in pi's `mcp.json` format: `url` for an HTTP server, or `command` and `args` for a stdio one."
    )
  }
);

// `satisfies` makes a key missing from, or unknown to, `ConfigFile` a compile error.
const properties = {
  $schema: Type.String(
    doc('JSON schema of this file, for editor completion and validation.', {
      examples: [SCHEMA_URL]
    })
  ),
  model: Type.String(
    doc(
      'Model the agents use: any model pattern your pi setup resolves, including models from pi packages that register a provider. Unset: your pi default model.',
      { flag: '--model', examples: ['claude-haiku-5-5', 'anthropic/claude-haiku-5-5'] }
    )
  ),
  thinking: stringEnum(
    THINKING_LEVELS,
    {
      off: 'No thinking.',
      minimal: 'The least thinking the model supports.',
      low: 'The default here: judgments hold up and output stays small.',
      medium: "pi's own default. More thinking tokens per file than `low`.",
      high: 'More thinking per file, at more cost.',
      xhigh: 'More thinking per file, at more cost.',
      max: 'The most thinking the model supports.'
    },
    'Thinking level of the agents. Thinking is billed as output tokens, so higher levels cost more per file.',
    { flag: '--thinking', value: defaults.thinking }
  ),
  concurrency: positive(
    'Maximum agents running at once. Never more than there are groups. Cost per file does not depend on it; lower it if your provider rate-limits you.',
    { flag: '--concurrency', value: defaults.concurrency }
  ),
  instructions: Type.String(
    doc(
      "Markdown file with your project's rules, appended to the rubric: areas that are always protected, patterns you always keep, tests you disagree with. Relative to the project root. Changing it makes earlier results stale.",
      { flag: '--instructions', examples: ['docs/test-rules.md'] }
    )
  ),
  include: Type.Array(
    glob,
    doc('Only consider files matching one of these globs. Unset: every file.', {
      flag: '--include',
      examples: [['packages/**']]
    })
  ),
  exclude: Type.Array(
    glob,
    doc(
      'Skip files matching these globs, on top of the built-in excludes (`node_modules`, `dist`, `build`, `target`, virtual environments and the like). Files ignored by git are always skipped.',
      { flag: '--exclude', examples: [['legacy/**']] }
    )
  ),
  budget: positive('Target tokens of test code per group. Each group is one agent session.', {
    flag: '--budget',
    value: defaults.budget
  }),
  minGroup: positive('Groups smaller than this are merged with a neighbor when possible.', {
    flag: '--min-group',
    value: defaults.minGroup
  }),
  tolerance: Type.Number({
    minimum: 0,
    ...doc('How far a group may go over `budget`, as a fraction. `0.1` allows 10% more.', {
      flag: '--tolerance',
      value: defaults.tolerance
    })
  }),
  outDir: Type.String(
    doc(
      'Directory for the plan, results, agent sessions and reports, relative to the project root. It gets its own `.gitignore`.',
      {
        flag: '--out',
        value: defaults.outDir
      }
    )
  ),
  languages: Type.Array(
    LanguagePresetSchema,
    doc(
      'Replaces the built-in languages entirely. To add a language, use `extraLanguages` instead.'
    )
  ),
  extraLanguages: Type.Array(
    LanguagePresetSchema,
    doc(
      'Languages checked before the built-in ones, so they can also override one for the same files. Changing discovery settings needs `--replan`.',
      {
        flag: '--match <glob[:regex]>, --case-start <regex>'
      }
    )
  ),
  mcpServers: Type.Record(
    Type.String(),
    McpServerSchema,
    doc(
      'MCP servers for the agents only; your personal `mcp.json` is not loaded. Their tools must also be listed in `tools`. See [Serena](https://github.com/arthurfiorette/tests-diet#recommended-serena) for a recommended setup.',
      { flag: '--mcp-config <file>', examples: [{ serena: { url: 'http://localhost:9121/mcp' } }] }
    )
  ),
  tools: Type.Array(
    Type.String(doc('A tool name, or a pattern where `*` matches any characters.')),
    doc(
      'Extra tools the agents may call. `read`, `grep`, `find` and `ls` are always available. Never allow tools that edit files.',
      {
        flag: '--tools',
        examples: [['mcp__serena__find_symbol', 'mcp__serena__find_referencing_symbols']]
      }
    )
  ),
  extensions: Type.Array(
    Type.String(doc('Path to a pi extension file, relative to the project root.')),
    doc('Extra pi extensions loaded in every agent session.', { flag: '--extension' })
  ),
  agentDir: Type.String(
    doc(
      "pi config directory for the agents: settings, credentials, models and packages. Unset: pi's own (`~/.pi/agent`).",
      {
        flag: '--agent-dir'
      }
    )
  ),
  trustProject: Type.Boolean(
    doc(
      "Load the audited project's `.pi` settings, packages and extensions. Off by default, so the audited code cannot change how the agents run.",
      {
        flag: '--trust-project',
        value: defaults.trustProject
      }
    )
  ),
  maxRejections: positive('Rejected reports tolerated per file before the file is marked failed.', {
    value: defaults.maxRejections
  }),
  maxIdleTurns: positive(
    "Agent turns without an accepted report before the group's session is stopped.",
    { value: defaults.maxIdleTurns }
  ),
  transport: stringEnum(
    TRANSPORTS,
    {
      auto: "The provider's choice.",
      sse: 'Server-sent events over HTTP. The most reliable for long unattended runs.',
      websocket:
        'A WebSocket per session. Long runs saw frequent "WebSocket closed" errors, each costing a retry.',
      'websocket-cached': "pi's cached WebSocket variant, for providers that support it."
    },
    'Provider transport for the agents.',
    { value: defaults.transport }
  )
} satisfies Record<keyof ConfigFile | '$schema', TSchema>;

/** Schema of `tests-diet.config.json`. Every key is optional. */
export const ConfigFileSchema = Type.Partial(Type.Object(properties), {
  $id: SCHEMA_URL,
  title: 'tests-diet config',
  additionalProperties: false,
  ...doc(
    `Settings for [tests-diet](${README}), read from \`tests-diet.config.json\` at the project root. Command-line flags override them for one run.`
  )
});
