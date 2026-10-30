import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { SubmitFileReport, SubmittedFinding } from '../src/report-schema.js';
import type { Finding, TestFile } from '../src/types.js';
import { checkReport, verdictOf } from '../src/validate.js';

const content = [
  "describe('math', () => {", // 1
  "  it('adds numbers', () => {", // 2
  '    expect(add(1, 2)).toBe(3);', // 3
  '  });', // 4
  "  it('subtracts numbers', () => {", // 5
  '    expect(sub(3, 2)).toBe(1);', // 6
  '  });', // 7
  '});' // 8
].join('\n');

const file: TestFile = {
  path: 'math.test.ts',
  language: 'javascript',
  inline: false,
  tokens: 50,
  hash: 'x',
  cases: [
    { line: 2, name: 'adds numbers' },
    { line: 5, name: 'subtracts numbers' }
  ]
};

const submitted = (over: Partial<SubmittedFinding>): SubmittedFinding => ({
  test: 'math > adds numbers',
  startLine: 2,
  endLine: 4,
  action: 'delete',
  category: 'TRIVIAL',
  reason: 'one-liner',
  bar: { costly: false, silent: false, likely: false, cheap: true },
  confidence: 'high',
  ...over
});

const report = (findings: SubmittedFinding[]): SubmitFileReport => ({
  file: file.path,
  summary: 's',
  findings
});
const subtracts = submitted({ test: 'math > subtracts numbers', startLine: 5, endLine: 7 });
const errorsOf = (findings: SubmittedFinding[]) =>
  checkReport(report(findings), file, content).errors;

describe('checkReport', () => {
  test('accepts one finding per detected case', () => {
    assert.deepEqual(errorsOf([submitted({}), subtracts]), []);
  });

  test('fixes mechanical slips instead of rejecting them', () => {
    const withEnds: TestFile = {
      ...file,
      cases: [
        { line: 2, name: 'adds numbers', endLine: 4 },
        { line: 5, name: 'subtracts numbers', endLine: 7 }
      ]
    };
    const { findings, errors } = checkReport(
      report([
        // A start inside the case, no end and no name: snapped and filled from discovery.
        (({ endLine: _, test: __, ...rest }) => rest)(submitted({ startLine: 3 })),
        submitted({ test: 'x', startLine: 5, endLine: 99 })
      ]),
      withEnds,
      content
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(
      findings.map((f) => [f.test, f.startLine, f.endLine]),
      [
        ['adds numbers', 2, 4],
        ['x', 5, 7]
      ]
    );
    assert.equal(findings[0]?.coveredBy, null);
    assert.equal(findings[0]?.mergeGroup, null);
  });

  test('clamps an end line past the file when discovery found no end', () => {
    const { findings, errors } = checkReport(
      report([submitted({}), submitted({ test: 'x', startLine: 5, endLine: 99 })]),
      file,
      content
    );
    assert.deepEqual(errors, []);
    assert.equal(findings[1]?.endLine, 8);
  });

  // Each row is a report that must be rejected, and why.
  const rejected: Array<[string, SubmittedFinding[], RegExp]> = [
    [
      'a describe-wide range swallowing two cases',
      [submitted({ test: 'math', startLine: 2, endLine: 7 })],
      /covers 2 cases/
    ],
    [
      'a start line not near exactly one case',
      [submitted({}), subtracts, submitted({ startLine: 8, endLine: 8 })],
      /not a case start line/
    ],
    ['a missing case', [submitted({})], /Missing findings for cases starting at: line 5/],
    ['overlapping findings', [submitted({ endLine: 5 }), subtracts], /overlap/],
    ['a merge without a group', [submitted({ action: 'merge' }), subtracts], /needs mergeGroup/],
    [
      'a single-case merge group without other files',
      [submitted({ action: 'merge', mergeGroup: 'table' }), subtracts],
      /single case/
    ],
    [
      'a DUP delete without coveredBy',
      [submitted({ category: 'DUP' }), subtracts],
      /needs coveredBy/
    ],
    [
      'a merge of cases that fail the bar',
      [
        submitted({ action: 'merge', mergeGroup: 'table' }),
        { ...subtracts, action: 'merge', mergeGroup: 'table' }
      ],
      /merge is for cases worth keeping/
    ],
    [
      'a costly delete without coveredBy',
      [submitted({ bar: { costly: true, silent: false, likely: false, cheap: true } }), subtracts],
      /deleting a costly case needs coveredBy/
    ],
    [
      'a keep with too few bar answers',
      [submitted({ action: 'keep', category: 'VALUABLE' }), subtracts],
      /at least 3/
    ]
  ];
  for (const [name, findings, error] of rejected) {
    test(`rejects ${name}`, () => {
      assert.match(errorsOf(findings).join('\n'), error);
    });
  }
});

const finding = (over: Partial<Finding>): Finding => ({
  test: 'math > adds numbers',
  startLine: 2,
  endLine: 4,
  action: 'delete',
  category: 'TRIVIAL',
  reason: 'one-liner',
  bar: { costly: false, silent: false, likely: false, cheap: true },
  coveredBy: null,
  mergeGroup: null,
  confidence: 'high',
  ...over
});
const subtractsFinding = finding({ test: 'math > subtracts numbers', startLine: 5, endLine: 7 });

describe('verdictOf', () => {
  test('deletes a pure test file only when every case is deleted', () => {
    assert.equal(verdictOf([finding({}), subtractsFinding], file), 'delete_file');
    assert.equal(
      verdictOf([finding({}), { ...subtractsFinding, action: 'merge', mergeGroup: 'g' }], file),
      'prune'
    );
  });

  test('never deletes a production file with inline tests, or a file without detected cases', () => {
    assert.equal(verdictOf([finding({}), subtractsFinding], { ...file, inline: true }), 'prune');
    assert.equal(verdictOf([finding({}), subtractsFinding], { ...file, cases: [] }), 'prune');
  });
});
