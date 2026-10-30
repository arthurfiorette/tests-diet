import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyReport } from '../src/apply.js';
import { hashContent } from '../src/discover.js';
import type { ReportData, ReportFile } from '../src/report.js';
import { emptyUsage } from '../src/state.js';
import type { Finding } from '../src/types.js';

const source = [
  "it('a', () => {",
  '  x();',
  '});',
  '',
  "it('b', () => {",
  '  y();',
  '});',
  '',
  "it('c', () => {});",
  ''
].join('\n');

const finding = (
  startLine: number,
  endLine: number,
  action: Finding['action'],
  confidence: Finding['confidence'] = 'high'
): Finding => ({
  test: 't',
  startLine,
  endLine,
  action,
  category: 'TRIVIAL',
  reason: 'r',
  bar: { costly: false, silent: false, likely: false, cheap: true },
  coveredBy: null,
  mergeGroup: null,
  confidence
});

function report(
  files: Array<Pick<ReportFile, 'path' | 'hash' | 'verdict' | 'findings'>>
): ReportData {
  return {
    files: files.map((f) => ({
      ...f,
      summary: '',
      groupId: 'g',
      model: 'm',
      promptKey: 'k',
      usage: emptyUsage(),
      at: '',
      language: 'javascript',
      inline: false,
      loc: 9,
      snippets: {}
    })),
    failures: []
  } as unknown as ReportData;
}

test('removes delete ranges, keeps everything else, and skips files changed since the report', () => {
  const root = mkdtempSync(join(tmpdir(), 'tests-diet-apply-'));
  writeFileSync(join(root, 'prune.test.ts'), source);
  writeFileSync(join(root, 'gone.test.ts'), source);
  writeFileSync(join(root, 'stale.test.ts'), source);
  const data = report([
    {
      path: 'prune.test.ts',
      hash: hashContent(source),
      verdict: 'prune',
      // The agent's end line 8 is wrong; the detected end (7) is what gets removed.
      findings: [finding(1, 3, 'keep'), finding(5, 8, 'delete'), finding(9, 9, 'delete', 'low')]
    },
    {
      path: 'gone.test.ts',
      hash: hashContent(source),
      verdict: 'delete_file',
      findings: [finding(1, 3, 'delete'), finding(5, 7, 'delete'), finding(9, 9, 'delete')]
    },
    { path: 'stale.test.ts', hash: 'old', verdict: 'prune', findings: [finding(5, 7, 'delete')] }
  ]);

  const detected = [
    { line: 1, name: 'a', endLine: 3 },
    { line: 5, name: 'b', endLine: 7 },
    { line: 9, name: 'c', endLine: 9 }
  ];
  const cases = new Map(
    ['prune.test.ts', 'gone.test.ts', 'stale.test.ts'].map((p) => [p, detected])
  );
  const preview = applyReport(root, data, { minConfidence: 'medium', dryRun: true, cases });
  assert.equal(readFileSync(join(root, 'prune.test.ts'), 'utf8'), source, 'dry run changed a file');
  assert.deepEqual(preview.stale, ['stale.test.ts']);

  // Without a detected end the range is not trusted.
  const unknownEnd = applyReport(root, data, {
    minConfidence: 'medium',
    dryRun: true,
    cases: new Map([['prune.test.ts', [{ line: 5, name: 'b' }]]])
  });
  assert.deepEqual(unknownEnd.prunedFiles, []);
  assert.deepEqual(unknownEnd.unverified, [{ path: 'prune.test.ts', startLine: 5, endLine: 8 }]);

  applyReport(root, data, { minConfidence: 'medium', dryRun: false, cases });
  // The low-confidence delete stays; the removed case leaves a single blank line at the seam.
  assert.equal(
    readFileSync(join(root, 'prune.test.ts'), 'utf8'),
    ["it('a', () => {", '  x();', '});', '', "it('c', () => {});", ''].join('\n')
  );
  assert.equal(existsSync(join(root, 'gone.test.ts')), false);
  assert.equal(readFileSync(join(root, 'stale.test.ts'), 'utf8'), source);
});
