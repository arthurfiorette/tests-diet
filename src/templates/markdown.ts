import type { ReportData } from '../report.js';

const oneLine = (text: string) => text.replace(/\s*\n\s*/g, ' ').trim();

/** Instructions plus every actionable range, ordered so an agent can apply them top to bottom. */
export function renderMarkdown(data: ReportData): string {
  const body = renderBody(data);
  const tokens = Math.ceil(body.length / 4);
  // Agents read this file: tell them up front when it will not fit in one read.
  const sizeNote = [
    `> This report is ${(body.length / 1024).toFixed(0)} KB (~${tokens.toLocaleString('en-US')} tokens).`,
    '> Every `## <path>` section is independent: work through it in parts (for example one package or folder at a time) instead of reading it whole.',
    '> `tests-diet delete` applies the `delete_file` verdicts and `delete` ranges mechanically; what remains for an agent is merges, rewrites and the cleanup below.',
    ''
  ];
  return [body.split('\n')[0], '', ...sizeNote, ...body.split('\n').slice(2)].join('\n');
}

function renderBody(data: ReportData): string {
  const { totals: t } = data;
  const out = [
    '# tests-diet report',
    '',
    `Generated ${data.generatedAt} with ${t.models.join(', ') || 'no model'}. ${t.reportedFiles}/${t.testFiles} test files reported, ${t.failedFiles} not reported.`,
    '',
    `Findings: ${t.findings} (delete ${t.actions.delete}, merge ${t.actions.merge}, rewrite ${t.actions.rewrite}, keep ${t.actions.keep}). Files to delete: ${t.verdicts.delete_file}, to prune: ${t.verdicts.prune}. Removable lines: ~${t.removableLines}, plus ~${t.mergeableLines} in merges, of ${t.testLines}.`,
    '',
    `Usage: ${t.usage.input} input, ${t.usage.cacheRead} cache-read, ${t.usage.output} output tokens, $${t.usage.cost.toFixed(2)} (cache hit ${(t.cacheHitRate * 100).toFixed(0)}%).`,
    '',
    '## How to apply',
    '',
    '1. Run `tests-diet delete --dry-run`, then `tests-diet delete`: it removes `delete_file` files and every `delete` range (only in files unchanged since they were reported). Or by hand: delete `delete_file` files, and remove the `delete` ranges in the order listed (bottom-up within each file, so earlier line numbers stay valid).',
    '2. For each "merge into one test" group, find its cases by test name and replace them with a single test (a table, or one flow) that keeps every assertion that matters; groups whose "covered by" names cases in other files are combined across those files.',
    '3. Leave `rewrite` entries for a follow-up unless asked.',
    '4. Remove what became unused: imports, helpers, fixtures, mocks, production exports or flags only those tests used.',
    '5. Run the formatter, linter, type checker and the affected test suites. A kept test failing means a range was wrong: restore it.',
    '',
    'Ranges are `startLine-endLine`, 1-based and inclusive.',
    ''
  ];

  for (const file of data.files) {
    if (file.verdict === 'keep') continue;
    out.push(
      `## ${file.path}`,
      '',
      `**${file.verdict}**${file.inline ? ' (production file with inline tests)' : ''}: ${oneLine(file.summary)}`,
      ''
    );
    if (file.verdict === 'delete_file') {
      out.push('- Delete the whole file.', '');
      continue;
    }
    const line = (f: ReportData['files'][number]['findings'][number]) => {
      const covered = f.coveredBy ? ` Covered by: ${oneLine(f.coveredBy)}.` : '';
      return `- \`${f.startLine}-${f.endLine}\` **${f.action}** ${f.category} (${f.confidence}) \`${oneLine(f.test)}\`: ${oneLine(f.reason)}${covered}`;
    };
    const desc = (a: { startLine: number }, b: { startLine: number }) => b.startLine - a.startLine;
    for (const f of file.findings.filter((f) => f.action === 'delete').sort(desc))
      out.push(line(f));
    const merges = new Map<string, typeof file.findings>();
    for (const f of file.findings.filter((f) => f.action === 'merge')) {
      const key = f.mergeGroup ?? 'unnamed';
      merges.set(key, [...(merges.get(key) ?? []), f]);
    }
    for (const [group, cases] of merges) {
      out.push(
        `- Merge into one test, "${oneLine(group)}":`,
        ...cases.sort(desc).map((f) => `  ${line(f)}`)
      );
    }
    for (const f of file.findings.filter((f) => f.action === 'rewrite').sort(desc))
      out.push(line(f));
    out.push('');
  }

  if (data.failures.length) {
    out.push(
      '## Not reported',
      '',
      ...data.failures.map((f) => `- ${f.path}: ${oneLine(f.reason)}`),
      ''
    );
  }
  return out.join('\n');
}
