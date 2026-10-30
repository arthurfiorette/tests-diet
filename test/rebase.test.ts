import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rebaseReport } from '../src/rebase.js';
import { emptyUsage } from '../src/state.js';
import type { FileReport, Finding, TestCase, TestFile } from '../src/types.js';

const finding = (
  test: string,
  startLine: number,
  endLine: number,
  action: Finding['action']
): Finding => ({
  test,
  startLine,
  endLine,
  action,
  category: action === 'keep' ? 'VALUABLE' : 'TRIVIAL',
  reason: 'r',
  bar: { costly: true, silent: true, likely: true, cheap: true },
  coveredBy: null,
  mergeGroup: action === 'merge' ? 'table' : null,
  confidence: 'high'
});

const report: FileReport = {
  path: 'a.test.ts',
  hash: 'old',
  verdict: 'prune',
  summary: 's',
  findings: [
    finding('suite > a', 1, 3, 'keep'),
    finding('b', 5, 7, 'delete'),
    finding('c', 9, 10, 'merge'),
    finding('d', 12, 13, 'merge')
  ],
  groupId: 'g',
  model: 'm',
  promptKey: 'k',
  usage: emptyUsage(),
  at: ''
};

const file = (cases: TestCase[]): TestFile => ({
  path: 'a.test.ts',
  language: 'javascript',
  inline: false,
  tokens: 10,
  hash: 'new',
  cases
});

test('moves the remaining findings onto the new lines and drops the applied deletes', () => {
  // `b` and an import line above `c` were removed.
  const rebased = rebaseReport(
    report,
    file([
      { line: 1, endLine: 3, name: 'a' },
      { line: 4, endLine: 5, name: 'c' },
      { line: 7, endLine: 8, name: 'd' }
    ])
  );
  assert.ok(rebased);
  assert.equal(rebased.hash, 'new');
  assert.deepEqual(
    rebased.findings.map((f) => [f.test, f.startLine, f.endLine, f.action]),
    [
      ['suite > a', 1, 3, 'keep'],
      ['c', 4, 5, 'merge'],
      ['d', 7, 8, 'merge']
    ]
  );
  assert.equal(rebased.verdict, 'prune');
});

test('refuses when a kept case was edited, renamed or removed, or a case was added', () => {
  const a = { line: 1, endLine: 3, name: 'a' };
  const c = { line: 5, endLine: 6, name: 'c' };
  const d = { line: 8, endLine: 9, name: 'd' };
  assert.equal(
    rebaseReport(report, file([a, { ...c, endLine: 8 }, { ...d, line: 10, endLine: 11 }])),
    undefined
  );
  assert.equal(rebaseReport(report, file([a, { ...c, name: 'c2' }, d])), undefined);
  assert.equal(rebaseReport(report, file([a, d])), undefined);
  assert.equal(
    rebaseReport(report, file([a, c, d, { line: 11, endLine: 11, name: 'new' }])),
    undefined
  );
});
