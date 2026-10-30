import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ignore, { type Ignore } from 'ignore';
import picomatch from 'picomatch';
import { type Config, effectiveLanguages } from './config.js';
import type { FileMatcher, LanguagePreset, TestCase, TestFile } from './types.js';

/** Rough prompt-token estimate. Good enough for packing groups; never used for billing. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// Case-sensitive on every OS so plans (and group ids) do not differ between macOS and Linux.
const compile = (globs: string[]) =>
  globs.length ? picomatch(globs, { dot: true, nocase: false }) : () => false;

/**
 * Files under root, relative and POSIX-style. Inside a git work tree this is `git ls-files`
 * (tracked + untracked, minus everything .gitignore'd). Elsewhere the tree is walked honoring
 * every .gitignore found and pruning excluded directories.
 */
export function listProjectFiles(root: string, exclude: string[]): string[] {
  if (isGitRoot(root)) {
    const out = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore']
      }
    );
    return out.split('\0').filter(Boolean);
  }
  const excluded = compile(exclude);
  const out: string[] = [];
  walk(root, '', [], excluded, out);
  return out;
}

function isGitRoot(root: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function walk(
  root: string,
  rel: string,
  ignores: Array<{ base: string; ig: Ignore }>,
  excluded: (p: string) => boolean,
  out: string[]
) {
  const dir = join(root, rel);
  const gitignore = join(dir, '.gitignore');
  const scoped = existsSync(gitignore)
    ? [...ignores, { base: rel, ig: ignore().add(readFileSync(gitignore, 'utf8')) }]
    : ignores;
  const isIgnored = (path: string, isDir: boolean) =>
    scoped.some(({ base, ig }) => {
      const local = base ? path.slice(base.length + 1) : path;
      return local !== '' && ig.ignores(isDir ? `${local}/` : local);
    });

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (excluded(`${path}/`) || excluded(`${path}/x`) || isIgnored(path, true)) continue;
      walk(root, path, scoped, excluded, out);
    } else if (entry.isFile() && !isIgnored(path, false)) {
      out.push(path);
    }
  }
}

interface CompiledMatcher {
  matcher: FileMatcher;
  matches: (path: string) => boolean;
  contains?: RegExp;
}

interface CompiledLanguage {
  language: LanguagePreset;
  matchers: CompiledMatcher[];
}

function compileLanguages(languages: LanguagePreset[]): CompiledLanguage[] {
  return languages.map((language) => ({
    language,
    matchers: language.matchers.map((matcher) => ({
      matcher,
      matches: compile(matcher.include),
      ...(matcher.contains ? { contains: new RegExp(matcher.contains, 'm') } : {})
    }))
  }));
}

/** Blanks `/* ... *\/` comments, keeping line count and columns, so tests inside them are ignored. */
export function blankBlockComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

/**
 * Case start lines found by the language's `caseStart` regex. A case starts at the first of its
 * decorator/attribute lines (and their indented continuation lines) directly above the match.
 */
export function detectCases(content: string, language: LanguagePreset): TestCase[] {
  if (!language.caseStart) return [];
  const re = new RegExp(language.caseStart);
  const attribute = language.attribute ? new RegExp(language.attribute) : undefined;
  const lines = (language.blockComments ? blankBlockComments(content) : content).split('\n');
  const cases: TestCase[] = [];
  let previousStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!re.test(line)) continue;
    let start = i;
    if (attribute) {
      const indent = indentation(line);
      for (let j = i - 1; j >= previousStart; j--) {
        const above = lines[j] ?? '';
        if (!above.trim()) break;
        if (attribute.test(above)) {
          start = j;
          continue;
        }
        // Continuation lines of a multi-line decorator are indented deeper or close brackets.
        if (indentation(above) > indent || /^\s*[)\]}]/.test(above)) continue;
        break;
      }
    }
    // Attributes stacked on one case (`#[test]` + `#[should_panic]`) are matched only once.
    const last = cases.at(-1);
    if (last && start + 1 <= last.line) continue;
    const end =
      language.blocks === 'braces'
        ? braceEnd(lines, i, attribute, language.name === 'rust')
        : language.blocks === 'indent'
          ? indentEnd(lines, i)
          : undefined;
    cases.push({ line: start + 1, name: caseName(lines, i), ...(end ? { endLine: end } : {}) });
    previousStart = i + 1;
  }
  // A computed end that runs into the next case means the parse went wrong: let the agent decide.
  cases.forEach((c, k) => {
    const next = cases[k + 1];
    if (c.endLine && next && c.endLine >= next.line) delete c.endLine;
  });
  return cases;
}

const indentation = (line: string) => line.length - line.trimStart().length;

const STRING_DOUBLE = /"(?:\\.|[^"\\])*"/g;
const STRING_SINGLE = /'(?:\\.|[^'\\])*'/g;
// Rust: `'a` lifetimes are not strings; only single-character literals like '{' are.
const CHAR_SINGLE = /'(?:\\.|[^'\\])'/g;

/**
 * Last line of a brace-delimited case: the first line where `()`/`{}` depth, counted from the
 * case line, is back to zero after opening. Strings, template literals and `//` comments are
 * ignored. Balanced attribute lines (`#[tokio::test(...)]`, `@ValueSource(...)`) are skipped.
 */
function braceEnd(
  lines: string[],
  from: number,
  attribute: RegExp | undefined,
  rust: boolean
): number | undefined {
  let depth = 0;
  let opened = false;
  let inTemplate = false;
  for (let j = from; j < lines.length && j < from + 5000; j++) {
    let line = lines[j] ?? '';
    if (inTemplate) {
      const close = line.indexOf('`');
      if (close === -1) continue;
      line = line.slice(close + 1);
      inTemplate = false;
    }
    line = line
      .replace(STRING_DOUBLE, '""')
      .replace(rust ? CHAR_SINGLE : STRING_SINGLE, "''")
      // Not '``': the lone-backtick check below would read it as an open template.
      .replace(/`(?:\\.|[^`\\])*`/g, '""');
    const tick = line.indexOf('`');
    if (tick !== -1) {
      inTemplate = true;
      line = line.slice(0, tick);
    }
    line = line.replace(/\/\/.*$/, '');
    let delta = 0;
    for (const ch of line) {
      if (ch === '(' || ch === '{') delta++;
      else if (ch === ')' || ch === '}') delta--;
    }
    if (!opened && delta === 0 && attribute?.test(lines[j] ?? '')) continue;
    if (delta !== 0 || /[({]/.test(line)) opened = true;
    depth += delta;
    if (opened && depth <= 0) return j + 1;
  }
  return undefined;
}

/** Last line of a Python test: the body ends before the next line indented at or above `def`. */
function indentEnd(lines: string[], from: number): number | undefined {
  const base = indentation(lines[from] ?? '');
  let j = from;
  // Skip a multi-line signature: until the `def (...)` parentheses close.
  let depth = 0;
  for (; j < lines.length; j++) {
    for (const ch of lines[j] ?? '') depth += ch === '(' ? 1 : ch === ')' ? -1 : 0;
    if (depth <= 0) break;
  }
  let last = j;
  for (let k = j + 1; k < lines.length; k++) {
    const line = lines[k] ?? '';
    if (!line.trim()) continue;
    if (indentation(line) <= base) break;
    last = k;
  }
  return last + 1;
}

// The case title: first string literal on the line, a table title `)('title'` within the next
// lines, `def`/`fn`/`func` names (Python, Rust, Go, Swift, PHP).
function caseName(lines: string[], index: number): string {
  const line = lines[index] ?? '';
  const literal =
    line.match(/\(\s*(['"`])((?:\\.|(?!\1).)*)\1/) ??
    line.match(/^\s*\w+\s+(['"])((?:\\.|(?!\1).)*)\1/);
  if (literal?.[2] !== undefined) return literal[2];
  const named = line.match(/(?:def|fn|func|function)\s+(\w+)/);
  if (named?.[1]) return named[1];
  for (const next of lines.slice(index + 1, index + 40)) {
    const title = next.match(/\)\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/);
    if (title?.[2] !== undefined) return title[2];
    const fn = next.match(/(?:def|fn|func|function|void)\s+(\w+)\s*\(/);
    if (fn?.[1]) return fn[1];
  }
  return line.trim().slice(0, 80);
}

export function discoverTestFiles(config: Config): TestFile[] {
  const included = config.include.length ? compile(config.include) : () => true;
  const excluded = compile(config.exclude);
  const languages = compileLanguages(effectiveLanguages(config));
  const files: TestFile[] = [];

  for (const path of listProjectFiles(config.root, config.exclude)) {
    if (excluded(path) || !included(path)) continue;
    const candidates = languages.flatMap(({ language, matchers }) =>
      matchers.filter((m) => m.matches(path)).map((m) => ({ language, m }))
    );
    if (!candidates.length) continue;

    let text: string;
    try {
      text = readFileSync(join(config.root, path), 'utf8');
    } catch {
      // Deleted but still in the index, a submodule directory, or unreadable.
      continue;
    }
    const hit = candidates.find(({ m }) => !m.contains || m.contains.test(text));
    if (!hit) continue;
    const cases = detectCases(text, hit.language);
    // Name patterns like `test-*` also match helpers and production code (`test-helpers.ts`,
    // `test-flow-button.tsx`): with a case regex and no case found, it is not a test file.
    if (hit.language.caseStart && !cases.length) continue;
    files.push({
      path,
      language: hit.language.name,
      inline: Boolean(hit.m.matcher.inline),
      tokens: estimateTokens(text),
      hash: hashContent(text),
      cases
    });
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
