/** How to recognize test files and test cases of one language. */
export interface LanguagePreset {
  name: string;
  /** A file belongs to the language if any matcher accepts it. */
  matchers: FileMatcher[];
  /**
   * Regex (source) matching the line where a test case starts. Used to give the agent a case list
   * and to check that every case is reported. Without it, completeness relies on the agent alone
   * and files are never marked for whole-file deletion.
   */
  caseStart?: string;
  /**
   * Regex (source) for decorator/attribute lines that belong to the case below them
   * (`@pytest.mark...`, `#[ignore]`, `[Theory]`). A case starts at its first such line, so
   * deleting a case never leaves a decorator behind on the next one.
   */
  attribute?: string;
  /** Blank `/* ... *\/` comments before scanning, so commented-out tests are not detected. */
  blockComments?: boolean;
  /**
   * How a case's last line is found: `braces` (balanced `()`/`{}`), `indent` (Python), or unset
   * (the agent reports `endLine` itself).
   */
  blocks?: 'braces' | 'indent';
}

export interface FileMatcher {
  /** Globs relative to the project root. */
  include: string[];
  /** Regex (source, multiline) the file content must match, e.g. Rust files with `#[test]`. */
  contains?: string;
  /** Matched files are production code with embedded tests: never deleted as a whole. */
  inline?: boolean;
}

export interface TestCase {
  /** 1-based line where the case starts, including its decorators/attributes. */
  line: number;
  /** 1-based last line of the case, when the language's `blocks` rule could find it. */
  endLine?: number;
  /** Best-effort case name, as written in the source. */
  name: string;
}

export interface TestFile {
  /** POSIX path relative to the project root. */
  path: string;
  language: string;
  /** Production file with embedded tests (only parts of it may be removed). */
  inline: boolean;
  /** Estimated prompt tokens for the file content. */
  tokens: number;
  /** sha256 of the content, used to invalidate stale results. */
  hash: string;
  cases: TestCase[];
}

export interface Group {
  id: string;
  files: TestFile[];
  tokens: number;
}

export const ACTIONS = ['delete', 'merge', 'rewrite', 'keep'] as const;
export type Action = (typeof ACTIONS)[number];

export const CATEGORIES = [
  'TYPE',
  'CONST',
  'TAUT',
  'CALLS',
  'NOOP',
  'TRIVIAL',
  'LIB',
  'SOURCE',
  'SNAP',
  'DUP',
  'LAYER',
  'FLAKY',
  'DEAD',
  'LOW_VALUE',
  'VALUABLE',
  'OTHER'
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CONFIDENCE = ['very_low', 'low', 'medium', 'high', 'very_high'] as const;
export type Confidence = (typeof CONFIDENCE)[number];

export interface Finding {
  test: string;
  /** 1-based, inclusive. */
  startLine: number;
  /** 1-based, inclusive. */
  endLine: number;
  action: Action;
  category: Category;
  reason: string;
  bar: { costly: boolean; silent: boolean; likely: boolean; cheap: boolean };
  /** What still proves the behavior after removal; required for DUP deletes (a subsuming test). */
  coveredBy: string | null;
  /**
   * For `merge`: label shared by every case that should become one test (a table, or one flow).
   * All cases with the same label in a file are combined; the label says what the result is.
   */
  mergeGroup: string | null;
  confidence: Confidence;
}

/** `rewrite` = nothing to remove, but some cases should be rewritten. */
export type FileVerdict = 'delete_file' | 'prune' | 'rewrite' | 'keep';

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** USD, as reported by pi for the provider. */
  cost: number;
}

export interface FileReport {
  path: string;
  hash: string;
  verdict: FileVerdict;
  summary: string;
  findings: Finding[];
  groupId: string;
  /** `provider/model` that produced the report. */
  model: string;
  /** Hash of the system prompt (rubric + instructions); a change makes the report stale. */
  promptKey: string;
  /** Model usage attributed to this file (since the previous accepted report in the session). */
  usage: Usage;
  at: string;
}
