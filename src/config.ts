import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { McpServerConfig } from '@earendil-works/pi-coding-agent';
import type { LanguagePreset } from './types.js';

const JS = '{js,jsx,ts,tsx,mjs,cjs,mts,cts}';
const CPP = '{cc,cpp,cxx}';

// JS/TS: `it(`/`test(` with modifiers, `x`/`f` prefixes, `await test(`, `.each`/`.for` tables
// (also multi-line and generic), `.skipIf(...)(`. Rejects hooks, `test.describe`, `test.step`,
// `test.skip(cond, 'why')` and `test.slow()`. Checked against a Babel AST over ~33k real cases.
const JS_CASE =
  '^\\s*(?:await\\s+)?[xf]?(?:it|test)(?:(?:\\.\\w+)*\\.(?:each|for|skipIf|runIf)\\b|(?:\\.(?:only|skip|todo|concurrent|sequential|fails|fixme|fail))+\\s*\\(\\s*[\'"`]|\\s*\\(\\s*(?:[\'"`]|$|[\\w.]+\\s*,))';
const RUST_CASE = '^\\s*#\\[(?:[\\w:]+::)?(?:test|rstest|test_case|wasm_bindgen_test)\\b';

/**
 * Default languages. The first matching language (and matcher) wins, so more specific matchers
 * come first. `inline` matchers select production files that embed tests: those are never
 * marked for whole-file deletion.
 */
export const DEFAULT_LANGUAGES: LanguagePreset[] = [
  {
    name: 'javascript',
    matchers: [
      {
        include: [
          `**/*.{test,spec}.${JS}`,
          `**/*.e2e-spec.${JS}`,
          `**/*{-,_}{test,spec}.${JS}`,
          `**/test-*.${JS}`,
          `**/__tests__/**/*.${JS}`
        ]
      },
      // node:test/mocha layouts; gated on content because these folders also hold helpers.
      {
        include: [`**/test/**/*.${JS}`, `**/tests/**/*.${JS}`],
        contains: '^\\s*(?:await\\s+)?(?:it|test)\\s*\\('
      }
    ],
    caseStart: JS_CASE,
    blockComments: true,
    blocks: 'braces'
  },
  {
    name: 'python',
    matchers: [{ include: ['**/test*.py', '**/*_test.py', '**/tests.py'] }],
    caseStart: '^\\s*(?:async\\s+)?def\\s+test\\w*\\s*(?:\\[[^\\]]*\\])?\\s*\\(',
    attribute: '^\\s*@',
    blocks: 'indent'
  },
  {
    name: 'rust',
    matchers: [
      { include: ['**/tests/**/*.rs'], contains: RUST_CASE },
      { include: ['**/*.rs'], contains: RUST_CASE, inline: true }
    ],
    caseStart: RUST_CASE,
    attribute: '^\\s*#\\[',
    blockComments: true,
    blocks: 'braces'
  },
  {
    name: 'go',
    matchers: [{ include: ['**/*_test.go'] }],
    caseStart: '^func\\s+(?:Test|Benchmark|Fuzz|Example)\\w*\\s*\\(',
    blockComments: true,
    blocks: 'braces'
  },
  {
    name: 'java',
    matchers: [
      { include: ['**/src/test/**/*.java', '**/*Test.java', '**/*Tests.java', '**/*IT.java'] }
    ],
    caseStart: '^\\s*@(?:Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)\\b',
    attribute: '^\\s*@',
    blockComments: true,
    blocks: 'braces'
  },
  {
    name: 'kotlin',
    matchers: [{ include: ['**/src/test/**/*.kt', '**/*Test.kt', '**/*Tests.kt', '**/*IT.kt'] }],
    caseStart: '^\\s*@(?:Test|ParameterizedTest|RepeatedTest|TestFactory)\\b',
    attribute: '^\\s*@',
    blockComments: true,
    blocks: 'braces'
  },
  {
    name: 'csharp',
    matchers: [
      { include: ['**/*Tests.cs', '**/*Test.cs', '**/*.Tests/**/*.cs', '**/*.Test/**/*.cs'] }
    ],
    caseStart: '^\\s*\\[(?:Fact|Theory|Test|TestMethod|DataTestMethod|TestCase)\\b',
    attribute: '^\\s*\\[',
    blockComments: true,
    blocks: 'braces'
  },
  {
    name: 'ruby',
    matchers: [{ include: ['**/*_spec.rb', '**/*_test.rb', '**/test_*.rb'] }],
    caseStart:
      '^\\s*(?:(?:it|specify|scenario|example)\\b(?:\\s*\\(|\\s+[\'"]|\\s+do\\b|\\s*\\{)|def\\s+test_\\w*|test\\s+[\'"])'
  },
  {
    name: 'php',
    matchers: [{ include: ['**/*Test.php'] }],
    caseStart: '^\\s*(?:#\\[Test\\]|(?:public\\s+)?function\\s+test\\w*\\s*\\()',
    attribute: '^\\s*(?:#\\[|/\\*\\*|\\*)',
    blockComments: true,
    blocks: 'braces'
  },
  {
    name: 'swift',
    matchers: [{ include: ['**/*Tests.swift', '**/*Test.swift'] }],
    caseStart: '^\\s*(?:@Test\\b|func\\s+test\\w*\\s*\\()',
    attribute: '^\\s*@',
    blockComments: true,
    blocks: 'braces'
  },
  {
    name: 'elixir',
    matchers: [{ include: ['**/*_test.exs'] }],
    caseStart: '^\\s*test\\s+["\']',
    attribute: '^\\s*@'
  },
  {
    name: 'dart',
    matchers: [{ include: ['**/*_test.dart'] }],
    caseStart: '^\\s*(?:test|testWidgets|testGoldens)\\s*\\(',
    attribute: '^\\s*@',
    blockComments: true,
    blocks: 'braces'
  },
  {
    name: 'scala',
    matchers: [{ include: ['**/*Spec.scala', '**/*Test.scala', '**/*Suite.scala'] }],
    caseStart: '^\\s*(?:(?:test|it)\\s*\\(\\s*"|"[^"]*"\\s+(?:in|should|must)\\b)',
    blockComments: true,
    blocks: 'braces'
  },
  {
    name: 'cpp',
    matchers: [
      { include: [`**/*_test.${CPP}`, `**/*_unittest.${CPP}`, `**/test_*.${CPP}`] },
      {
        include: [`**/tests/**/*.${CPP}`, `**/test/**/*.${CPP}`],
        contains: '^\\s*(?:TEST(?:_F|_P)?|TYPED_TEST(?:_P)?|TEST_CASE)\\s*\\('
      }
    ],
    caseStart: '^\\s*(?:TEST(?:_F|_P)?|TYPED_TEST(?:_P)?|TEST_CASE)\\s*\\(',
    blockComments: true,
    blocks: 'braces'
  },
  {
    name: 'lua',
    matchers: [{ include: ['**/*_spec.lua'] }],
    caseStart: '^\\s*it\\s*\\('
  }
];

/** Always skipped, on top of .gitignore. Config and CLI excludes are added to these. */
export const DEFAULT_EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/target/**',
  '**/vendor/**',
  '**/coverage/**',
  '**/.venv/**',
  '**/venv/**',
  '**/.tox/**',
  '**/__pycache__/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/.git/**',
  '**/.tests-diet/**'
];

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ThinkingSetting = (typeof THINKING_LEVELS)[number];

export interface Config {
  /** Project root; every path in reports is relative to it. */
  root: string;
  /** Replaces the default languages when set in the config file. */
  languages: LanguagePreset[];
  /** Languages checked before the defaults (first match wins). */
  extraLanguages: LanguagePreset[];
  /** Only files matching one of these globs are considered. */
  include: string[];
  /** Added to `DEFAULT_EXCLUDE`. */
  exclude: string[];
  /** Target tokens of test code per group. */
  budget: number;
  /** Groups smaller than this are merged with neighbors when possible. */
  minGroup: number;
  /** Allowed overshoot over `budget`, as a fraction. */
  tolerance: number;
  /** Directory for state, sessions and reports, relative to root. */
  outDir: string;
  /** Model pattern resolved through the user's pi config (e.g. `claude-haiku-5-5`, `provider/id:low`). */
  model: string | undefined;
  thinking: ThinkingSetting | undefined;
  concurrency: number;
  /** Extra instructions file appended to the rubric (repo-specific rules). */
  instructions: string | undefined;
  /** Rejected `submit_file_report` calls tolerated per file before the file is marked failed. */
  maxRejections: number;
  /** Model turns without an accepted report before the group's session is aborted. */
  maxIdleTurns: number;
  /** pi config directory for the pool (settings, auth, models, packages). Default: pi's own. */
  agentDir: string | undefined;
  /**
   * MCP servers for the pool only, in pi's `mcp.json` format. Exposure defaults to `direct`; the
   * tools still need to be allowed in `tools`. The user's own `mcp.json` is not loaded.
   */
  mcpServers: Record<string, McpServerConfig>;
  /** Extra tool names or patterns the agents may call (e.g. `mcp__serena__find_symbol`). */
  tools: string[];
  /** Extra pi extension files loaded in every agent session. */
  extensions: string[];
  /** Load the audited project's `.pi` settings, packages and extensions. Off by default. */
  trustProject: boolean;
  /**
   * Provider transport for the pool. `sse` by default: long unattended runs on WebSocket transports
   * saw frequent "WebSocket closed" errors, each costing a retry round.
   */
  transport: Transport;
}

export const TRANSPORTS = ['auto', 'sse', 'websocket', 'websocket-cached'] as const;
export type Transport = (typeof TRANSPORTS)[number];

export type ConfigFile = { [K in keyof Omit<Config, 'root'>]?: Config[K] | undefined };

export const CONFIG_FILE = 'tests-diet.config.json';

const CONFIG_KEYS = new Set<string>([
  // Editor hint pointing at schema.json; ignored.
  '$schema',
  'languages',
  'extraLanguages',
  'include',
  'exclude',
  'budget',
  'minGroup',
  'tolerance',
  'outDir',
  'model',
  'thinking',
  'concurrency',
  'instructions',
  'maxRejections',
  'maxIdleTurns',
  'agentDir',
  'mcpServers',
  'tools',
  'extensions',
  'trustProject',
  'transport'
]);

export function defaultConfig(root: string): Config {
  return {
    root,
    languages: DEFAULT_LANGUAGES,
    extraLanguages: [],
    include: [],
    exclude: [],
    budget: 50_000,
    minGroup: 15_000,
    tolerance: 0.1,
    outDir: '.tests-diet',
    model: undefined,
    // Reasoning tokens dominated output (and time) at pi's default `medium`; `low` judges as well
    // on this task for a fraction of the tokens. Override with --thinking.
    thinking: 'low',
    // A cap, not a target: the runner never starts more workers than queued groups. Cost per file
    // does not depend on it; the provider's rate limits do.
    concurrency: 32,
    instructions: undefined,
    maxRejections: 3,
    maxIdleTurns: 25,
    agentDir: undefined,
    mcpServers: {},
    tools: [],
    extensions: [],
    trustProject: false,
    transport: 'sse'
  };
}

/** Defaults, then `tests-diet.config.json` in the root, then CLI overrides. */
export function loadConfig(root: string, overrides: ConfigFile = {}): Config {
  const base = defaultConfig(root);
  const file = resolve(root, CONFIG_FILE);
  let fromFile: ConfigFile = {};
  if (existsSync(file)) {
    try {
      fromFile = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      throw new Error(`${file}: invalid JSON (${(error as Error).message})`);
    }
    const unknown = Object.keys(fromFile).filter((key) => !CONFIG_KEYS.has(key));
    if (unknown.length) throw new Error(`${file}: unknown keys ${unknown.join(', ')}`);
    delete (fromFile as { $schema?: unknown }).$schema;
  }
  const fileValues = defined(fromFile);
  const cliValues = defined(overrides);
  // Paths in the config file are relative to the root; CLI paths arrive already resolved.
  if (fileValues.instructions) fileValues.instructions = resolve(root, fileValues.instructions);
  if (fileValues.agentDir) fileValues.agentDir = resolve(root, fileValues.agentDir);
  if (fileValues.extensions)
    fileValues.extensions = fileValues.extensions.map((p) => resolve(root, p));
  const config: Config = { ...base, ...fileValues, ...cliValues, root };
  config.exclude = [
    ...DEFAULT_EXCLUDE,
    ...(fileValues.exclude ?? []),
    ...(cliValues.exclude ?? [])
  ];
  config.extraLanguages = [
    ...(cliValues.extraLanguages ?? []),
    ...(fileValues.extraLanguages ?? [])
  ];
  config.tools = [...(fileValues.tools ?? []), ...(cliValues.tools ?? [])];
  config.extensions = [...(fileValues.extensions ?? []), ...(cliValues.extensions ?? [])];
  config.mcpServers = { ...(fileValues.mcpServers ?? {}), ...(cliValues.mcpServers ?? {}) };
  validateConfig(config, file);
  return config;
}

/** Languages in matching order: extras first so they can override a default for the same files. */
export function effectiveLanguages(config: Config): LanguagePreset[] {
  return [...config.extraLanguages, ...config.languages];
}

function validateConfig(config: Config, file: string) {
  const positiveInt = (
    key: 'budget' | 'minGroup' | 'concurrency' | 'maxRejections' | 'maxIdleTurns'
  ) => {
    const value = config[key];
    if (!Number.isInteger(value) || value < 1)
      throw new Error(`${key} must be a positive integer (got ${value})`);
  };
  positiveInt('budget');
  positiveInt('minGroup');
  positiveInt('concurrency');
  positiveInt('maxRejections');
  positiveInt('maxIdleTurns');
  if (!(config.tolerance >= 0)) throw new Error(`tolerance must be >= 0 (got ${config.tolerance})`);
  if (config.thinking && !(THINKING_LEVELS as readonly string[]).includes(config.thinking)) {
    throw new Error(`thinking must be one of ${THINKING_LEVELS.join(', ')}`);
  }
  const languages = effectiveLanguages(config);
  if (!languages.length) throw new Error(`${file}: no languages configured`);
  for (const language of languages) {
    for (const [field, source] of [
      ['caseStart', language.caseStart],
      ['attribute', language.attribute],
      ...language.matchers.map((m) => ['contains', m.contains] as const)
    ] as const) {
      if (!source) continue;
      try {
        new RegExp(source, 'm');
      } catch (error) {
        throw new Error(
          `language "${language.name}": invalid ${field} regex (${(error as Error).message})`
        );
      }
    }
  }
}

function defined(value: ConfigFile): Partial<Config> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined)
  ) as Partial<Config>;
}
