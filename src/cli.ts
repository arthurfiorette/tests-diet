import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { applyReport } from './apply.js';
import {
  CONFIG_FILE,
  type ConfigFile,
  loadConfig,
  THINKING_LEVELS,
  type ThinkingSetting
} from './config.js';
import { LiveView, Progress } from './progress.js';
import { buildReport, writeReports } from './report.js';
import { preparePlan, run } from './runner.js';
import { CONFIDENCE, type Confidence, type LanguagePreset } from './types.js';

const HELP = `tests-diet: find the tests that are not worth their CI cost

Usage:
  tests-diet plan    [options]   discover test files and store the groups (no model calls)
  tests-diet run     [options]   classify pending groups with pi agents, then write the report
  tests-diet status  [options]   progress, usage and cost of the stored run (-w to keep updating)
  tests-diet report  [options]   rewrite tests-diet.{json,md,html} from the stored run
  tests-diet delete  [options]   apply the report: delete files and \`delete\` ranges
                                 (--dry-run to preview, --min-confidence <level>, --only <prefix>)

Discovery and grouping (stored in the plan; changing them needs --replan):
  --include <glob>          only consider matching files (repeatable)
  --exclude <glob>          skip matching files (repeatable; added to the defaults)
  --match <glob[:regex]>    extra test files: a glob, optionally gated on a content regex
                            (repeatable), e.g. '**/*.rs:#\\[cfg\\(test\\)\\]'
  --case-start <regex>      where a test case starts in --match files, e.g. '^\\s*it\\('
  --budget <tokens>         target test tokens per group (default 50000)
  --min-group <tokens>      merge groups smaller than this (default 15000)
  --tolerance <fraction>    allowed overshoot over the budget (default 0.1)
  --replan                  discard the stored plan and regroup

Classification:
  --model <pattern>         pi model pattern, e.g. claude-haiku-5-5 or provider/id:low
                            (default: your pi default model)
  --thinking <level>        ${THINKING_LEVELS.join(' | ')}
  --concurrency <n>         max parallel agents, capped at the group count (default 32)
  --instructions <file>     project rules appended to the rubric
  --limit <n>               run only the first n pending groups (calibration)
  --only <prefix>           run only groups with files under this path (repeatable)
  --fresh                   ignore stored reports and classify again
  --force                   run even if the git work tree has uncommitted changes

Agent environment (see the README for a Serena setup):
  --agent-dir <dir>         pi config dir for the pool (default: your pi config)
  --mcp-config <file>       MCP servers for the pool, pi mcp.json format ({"mcpServers": ...})
  --tools <names>           extra tools the agents may call, comma-separated, patterns allowed
                            (e.g. 'mcp__serena__find_symbol,mcp__serena__find_referencing_symbols')
  --extension <file>        extra pi extension loaded in every agent (repeatable)
  --trust-project           load the project's .pi settings, packages and extensions

General:
  --root <dir>              project root (default: cwd)
  --out <dir>               state and report directory, relative to root (default .tests-diet)
  -v, --version
  -h, --help

Settings can also live in ${CONFIG_FILE} at the root. Exit codes: 0 ok, 1 error,
2 some files could not be reported, 130 interrupted.
`;

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      root: { type: 'string' },
      out: { type: 'string' },
      include: { type: 'string', multiple: true },
      exclude: { type: 'string', multiple: true },
      match: { type: 'string', multiple: true },
      'case-start': { type: 'string' },
      budget: { type: 'string' },
      'min-group': { type: 'string' },
      tolerance: { type: 'string' },
      model: { type: 'string' },
      thinking: { type: 'string' },
      concurrency: { type: 'string' },
      instructions: { type: 'string' },
      limit: { type: 'string' },
      only: { type: 'string', multiple: true },
      replan: { type: 'boolean' },
      fresh: { type: 'boolean' },
      force: { type: 'boolean' },
      'agent-dir': { type: 'string' },
      'mcp-config': { type: 'string' },
      tools: { type: 'string', multiple: true },
      extension: { type: 'string', multiple: true },
      'trust-project': { type: 'boolean' },
      watch: { type: 'boolean', short: 'w' },
      'dry-run': { type: 'boolean' },
      'min-confidence': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' }
    }
  });
  if (values.version) {
    process.stdout.write(`${version()}\n`);
    return 0;
  }
  const command = positionals[0];
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (!command || !['plan', 'run', 'status', 'report', 'delete'].includes(command)) {
    process.stderr.write(`${command ? `Unknown command "${command}".\n\n` : ''}${HELP}`);
    return 1;
  }

  const root = resolve(values.root ?? process.cwd());
  if (!existsSync(root) || !statSync(root).isDirectory())
    throw new Error(`--root ${root} is not a directory`);
  const overrides: ConfigFile = {
    outDir: values.out,
    include: values.include,
    exclude: values.exclude,
    extraLanguages: customLanguage(values.match, values['case-start']),
    budget: int(values.budget, 'budget'),
    minGroup: int(values['min-group'], 'min-group'),
    tolerance: num(values.tolerance, 'tolerance'),
    model: values.model,
    thinking: thinking(values.thinking),
    concurrency: int(values.concurrency, 'concurrency'),
    instructions: values.instructions ? resolve(process.cwd(), values.instructions) : undefined,
    agentDir: values['agent-dir'] ? resolve(process.cwd(), values['agent-dir']) : undefined,
    mcpServers: values['mcp-config']
      ? readMcpConfig(resolve(process.cwd(), values['mcp-config']))
      : undefined,
    tools: values.tools?.flatMap((entry) =>
      entry
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    ),
    extensions: values.extension?.map((path) => resolve(process.cwd(), path)),
    trustProject: values['trust-project']
  };
  const config = loadConfig(root, overrides);

  switch (command) {
    case 'plan': {
      const plan = preparePlan(config, { replan: values.replan ?? false, write: true });
      for (const group of plan.groups) {
        process.stdout.write(
          `${group.id}  ${String(group.tokens).padStart(7)} tokens  ${String(group.files.length).padStart(4)} files  ${commonDir(group.files.map((f) => f.path))}\n`
        );
      }
      const tokens = plan.groups.reduce((n, g) => n + g.tokens, 0);
      const cases = plan.files.reduce((n, f) => n + f.cases.length, 0);
      process.stdout.write(
        `\n${plan.files.length} test files, ${cases} detected cases, ${plan.groups.length} groups, ~${tokens} tokens of test code\n`
      );
      return 0;
    }
    case 'run': {
      ensureCleanWorkTree(root, config.outDir, values.force ?? false);
      const plan = preparePlan(config, { replan: values.replan ?? false, write: true });
      const controller = new AbortController();
      const progress = new Progress();
      const view = new LiveView(progress);
      // First Ctrl+C: abort every session and save (the next run resumes them). Second: exit now.
      const onSignal = () => {
        if (controller.signal.aborted) {
          view.stop();
          process.stderr.write(
            'Forced exit. Accepted reports are saved; interrupted groups resume next run.\n'
          );
          process.exit(130);
        }
        view.log('Stopping: aborting the agents and saving progress (Ctrl+C again to exit now).');
        controller.abort();
      };
      process.on('SIGINT', onSignal);
      process.on('SIGTERM', onSignal);
      const limit = int(values.limit, 'limit');
      view.start();
      let summary: Awaited<ReturnType<typeof run>>;
      try {
        summary = await run(config, plan, {
          signal: controller.signal,
          progress,
          log: (message) => view.log(message),
          ...(values.fresh ? { fresh: true } : {}),
          ...(limit !== undefined ? { limit } : {}),
          ...(values.only ? { only: values.only } : {})
        });
      } finally {
        view.stop();
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
      }
      const data = buildReport(
        root,
        plan.files,
        plan.store.readResults(),
        plan.store.readFailures(),
        plan.store.readState()
      );
      const paths = writeReports(plan.store.dir, data);
      const u = summary.usage;
      process.stderr.write(
        `\n${summary.accepted} files reported, ${summary.failed} failed. ${u.input} input + ${u.cacheRead} cache-read + ${u.output} output tokens, $${u.cost.toFixed(2)}.\nReport: ${paths.html}\n`
      );
      if (summary.aborted) {
        process.stderr.write('Interrupted. Run `tests-diet run` again to resume.\n');
        return 130;
      }
      return summary.failed ? 2 : 0;
    }
    case 'status': {
      const plan = preparePlan(config, { write: false });
      const render = () => {
        const state = plan.store.readState() ?? plan.state;
        const t = buildReport(
          root,
          plan.files,
          plan.store.readResults(),
          plan.store.readFailures(),
          state
        ).totals;
        const done = state.groups.filter((g) => g.status === 'done').length;
        const failed = state.groups.filter((g) => g.status === 'failed').length;
        return (
          `${t.reportedFiles}/${t.testFiles} files reported, ${t.failedFiles} not reported\n` +
          `${done}/${state.groups.length} groups done, ${failed} failed\n` +
          `findings: delete ${t.actions.delete}, merge ${t.actions.merge}, rewrite ${t.actions.rewrite}, keep ${t.actions.keep}\n` +
          `usage: ${t.usage.input} input, ${t.usage.cacheRead} cache-read, ${t.usage.output} output tokens, $${t.usage.cost.toFixed(2)} (cache hit ${(t.cacheHitRate * 100).toFixed(0)}%)\n`
        );
      };
      if (!values.watch) {
        process.stdout.write(render());
        return 0;
      }
      // Re-reads the state files; works next to a run in another terminal. Ctrl+C to stop.
      for (;;) {
        process.stdout.write(`\x1b[2J\x1b[H${new Date().toLocaleTimeString()}\n${render()}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    case 'delete': {
      const dryRun = values['dry-run'] ?? false;
      if (!dryRun) ensureCleanWorkTree(root, config.outDir, values.force ?? false);
      const plan = preparePlan(config, { write: false });
      const data = buildReport(
        root,
        plan.files,
        plan.store.readResults(),
        plan.store.readFailures(),
        plan.state
      );
      const minConfidence = confidence(values['min-confidence']);
      const result = applyReport(root, data, {
        minConfidence,
        dryRun,
        cases: new Map(plan.files.map((f) => [f.path, f.cases])),
        ...(values.only ? { only: values.only } : {})
      });
      for (const path of result.deletedFiles) process.stdout.write(`delete  ${path}\n`);
      for (const file of result.prunedFiles) {
        process.stdout.write(
          `prune   ${file.path}  ${file.ranges.map(([s, e]) => `${s}-${e}`).join(', ')}\n`
        );
      }
      for (const path of result.stale)
        process.stdout.write(`stale   ${path} (changed since reported; skipped)\n`);
      for (const r of result.unverified) {
        process.stdout.write(
          `skip    ${r.path}  ${r.startLine}-${r.endLine} (case end not detected; left for an agent)\n`
        );
      }
      process.stdout.write(
        `\n${dryRun ? 'Would delete' : 'Deleted'} ${result.deletedFiles.length} files and prune ${result.prunedFiles.length} files, ${result.removedLines} lines (findings at ${minConfidence} confidence or above).\n`
      );
      if (!dryRun && (result.deletedFiles.length || result.prunedFiles.length)) {
        process.stdout.write(
          `Next: remove imports, helpers and fixtures left unused, then run the formatter, linter, type checker and tests.${result.leftForAgent ? ` ${result.leftForAgent} merge/rewrite findings remain in tests-diet.md for an agent.` : ''}\n`
        );
      }
      return 0;
    }
    default: {
      const plan = preparePlan(config, { write: false });
      const data = buildReport(
        root,
        plan.files,
        plan.store.readResults(),
        plan.store.readFailures(),
        plan.state
      );
      const paths = writeReports(plan.store.dir, data);
      for (const path of [paths.json, paths.markdown, paths.html]) {
        const bytes = statSync(path).size;
        process.stdout.write(
          `${path}  ${(bytes / 1024).toFixed(0)} KB, ~${Math.ceil(bytes / 4).toLocaleString('en-US')} tokens\n`
        );
      }
      process.stdout.write(
        '\nFor agents: tests-diet.md is split in independent `## <path>` sections; read it in parts (a package or folder at a time) rather than whole. `tests-diet delete` applies the deletions.\n'
      );
      return 0;
    }
  }
}

/**
 * Reports point at line ranges of the current files, and applying them deletes code: start from a
 * committed tree so the result is reviewable and reversible.
 */
function ensureCleanWorkTree(root: string, outDir: string, force: boolean) {
  let status: string;
  try {
    status = execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch {
    return;
  }
  const out = outDir.replace(/^\.\//, '').replace(/\/$/, '');
  const dirty = status.split('\n').filter((line) => line.trim() && !line.slice(3).startsWith(out));
  if (dirty.length && !force) {
    throw new Error(
      `The git work tree has ${dirty.length} uncommitted change(s). Commit or stash them first, or pass --force.`
    );
  }
}

function customLanguage(
  match: string[] | undefined,
  caseStart: string | undefined
): LanguagePreset[] | undefined {
  if (!match?.length) {
    if (caseStart) throw new Error('--case-start needs at least one --match');
    return undefined;
  }
  const matchers = match.map((entry) => {
    const split = entry.indexOf(':');
    const glob = split === -1 ? entry : entry.slice(0, split);
    const contains = split === -1 ? undefined : entry.slice(split + 1);
    if (!glob) throw new Error(`--match "${entry}" has no glob`);
    return contains ? { include: [glob], contains } : { include: [glob] };
  });
  return [{ name: 'custom', matchers, ...(caseStart ? { caseStart } : {}) }];
}

function readMcpConfig(path: string): NonNullable<ConfigFile['mcpServers']> {
  let parsed: { mcpServers?: unknown };
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`--mcp-config ${path}: ${(error as Error).message}`);
  }
  if (!parsed.mcpServers || typeof parsed.mcpServers !== 'object') {
    throw new Error(`--mcp-config ${path}: expected an object with "mcpServers"`);
  }
  return parsed.mcpServers as NonNullable<ConfigFile['mcpServers']>;
}

function confidence(value: string | undefined): Confidence {
  if (value === undefined) return 'medium';
  if (!(CONFIDENCE as readonly string[]).includes(value)) {
    throw new Error(`--min-confidence must be one of ${CONFIDENCE.join(', ')}`);
  }
  return value as Confidence;
}

function version(): string {
  return (
    JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    }
  ).version;
}

function num(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (value.trim() === '' || !Number.isFinite(parsed) || parsed < 0)
    throw new Error(`--${name} must be a number >= 0`);
  return parsed;
}

function int(value: string | undefined, name: string): number | undefined {
  const parsed = num(value, name);
  if (parsed !== undefined && (!Number.isInteger(parsed) || parsed < 1))
    throw new Error(`--${name} must be a positive integer`);
  return parsed;
}

function thinking(value: string | undefined): ThinkingSetting | undefined {
  if (value === undefined) return undefined;
  if (!(THINKING_LEVELS as readonly string[]).includes(value))
    throw new Error(`--thinking must be one of ${THINKING_LEVELS.join(', ')}`);
  return value as ThinkingSetting;
}

function commonDir(paths: string[]): string {
  const split = paths.map((p) => p.split('/').slice(0, -1));
  const first = split[0] ?? [];
  let i = 0;
  while (i < first.length && split.every((parts) => parts[i] === first[i])) i++;
  return `${first.slice(0, i).join('/') || '.'}/`;
}
