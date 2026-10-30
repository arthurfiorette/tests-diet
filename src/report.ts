import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { addUsage, emptyUsage, type FailureRecord, type RunState } from './state.js';
import { renderHtml } from './templates/index.js';
import { renderMarkdown } from './templates/markdown.js';
import type { Action, Category, FileReport, TestFile, Usage } from './types.js';

/** Bumped on breaking changes to the JSON report shape. */
export const REPORT_VERSION = 1;

export interface ReportFile extends FileReport {
  language: string;
  inline: boolean;
  loc: number;
  /** Local source link for reports opened on the machine that generated them. */
  sourceUrl?: string;
  /** Source lines by line number, around non-keep findings only (for the HTML view). */
  snippets: Record<number, string>;
}

export interface ReportTotals {
  testFiles: number;
  reportedFiles: number;
  failedFiles: number;
  /** Cases detected by the language regexes across reported files. */
  detectedCases: number;
  findings: number;
  actions: Record<Action, number>;
  categories: Partial<Record<Category, number>>;
  verdicts: Record<FileReport['verdict'], number>;
  /** Distinct lines inside delete findings plus whole files marked delete_file. */
  removableLines: number;
  /** Distinct lines inside merge findings (they shrink to fewer tests, not to zero). */
  mergeableLines: number;
  testLines: number;
  usage: Usage;
  /** cacheRead / (input + cacheRead): share of prompt tokens served from the provider cache. */
  cacheHitRate: number;
  models: string[];
}

export interface ReportData {
  version: number;
  generatedAt: string;
  totals: ReportTotals;
  files: ReportFile[];
  failures: FailureRecord[];
}

const SNIPPET_LIMIT = 60;

/** Joins the latest results with the current files; reports for changed files are left out. */
export function buildReport(
  root: string,
  files: TestFile[],
  results: Map<string, FileReport>,
  failures: FailureRecord[],
  state?: RunState
): ReportData {
  const actions: Record<Action, number> = { delete: 0, merge: 0, rewrite: 0, keep: 0 };
  const verdicts: Record<FileReport['verdict'], number> = {
    delete_file: 0,
    prune: 0,
    rewrite: 0,
    keep: 0
  };
  const categories: Partial<Record<Category, number>> = {};
  const usage = emptyUsage();
  const models = new Set<string>();
  const out: ReportFile[] = [];
  let removableLines = 0;
  let mergeableLines = 0;
  let testLines = 0;
  let detectedCases = 0;
  let findingCount = 0;

  for (const file of files) {
    const report = results.get(file.path);
    if (!report || report.hash !== file.hash) continue;
    const full = join(root, file.path);
    const raw = existsSync(full)
      ? readFileSync(full, 'utf8').replace(/\r\n/g, '\n').split('\n')
      : [];
    const lines = raw.at(-1) === '' ? raw.slice(0, -1) : raw;
    const snippets: Record<number, string> = {};
    const removed = new Set<number>();
    const merged = new Set<number>();

    for (const finding of report.findings) {
      findingCount++;
      actions[finding.action]++;
      categories[finding.category] = (categories[finding.category] ?? 0) + 1;
      const bucket =
        finding.action === 'delete' ? removed : finding.action === 'merge' ? merged : undefined;
      if (bucket) for (let n = finding.startLine; n <= finding.endLine; n++) bucket.add(n);
      if (finding.action === 'keep') continue;
      const last = Math.min(finding.endLine, finding.startLine + SNIPPET_LIMIT - 1);
      for (let n = finding.startLine; n <= last; n++) snippets[n] = lines[n - 1] ?? '';
    }
    verdicts[report.verdict]++;
    removableLines += report.verdict === 'delete_file' ? lines.length : removed.size;
    mergeableLines += merged.size;
    testLines += file.inline ? removed.size + merged.size : lines.length;
    detectedCases += file.cases.length;
    if (report.usage) addUsage(usage, report.usage);
    models.add(report.model);
    out.push({
      ...report,
      language: file.language,
      inline: file.inline,
      loc: lines.length,
      sourceUrl: pathToFileURL(full).href,
      snippets
    });
  }

  // Group usage includes turns spent on files that failed; prefer it when available.
  if (state?.groups.some((g) => g.usage)) {
    const fromGroups = emptyUsage();
    for (const g of state.groups) if (g.usage) addUsage(fromGroups, g.usage);
    Object.assign(usage, fromGroups);
  }

  const current = new Map(files.map((f) => [f.path, f.hash]));
  const reported = new Set(out.map((f) => f.path));
  const latestFailure = new Map<string, FailureRecord>();
  for (const failure of failures) {
    if (current.get(failure.path) === failure.hash && !reported.has(failure.path))
      latestFailure.set(failure.path, failure);
  }

  return {
    version: REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    totals: {
      testFiles: files.length,
      reportedFiles: out.length,
      failedFiles: latestFailure.size,
      detectedCases,
      findings: findingCount,
      actions,
      categories,
      verdicts,
      removableLines,
      mergeableLines,
      testLines,
      usage,
      cacheHitRate:
        usage.input + usage.cacheRead ? usage.cacheRead / (usage.input + usage.cacheRead) : 0,
      models: [...models]
    },
    files: out,
    failures: [...latestFailure.values()]
  };
}

export function writeReports(
  dir: string,
  data: ReportData
): { json: string; markdown: string; html: string } {
  const paths = {
    json: join(dir, 'tests-diet.json'),
    markdown: join(dir, 'tests-diet.md'),
    html: join(dir, 'tests-diet.html')
  };
  const json = { ...data, files: data.files.map(({ snippets: _snippets, ...file }) => file) };
  writeFileSync(paths.json, `${JSON.stringify(json, null, 2)}\n`);
  writeFileSync(paths.markdown, renderMarkdown(data));
  writeFileSync(paths.html, renderHtml(data));
  return paths;
}
