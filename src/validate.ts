import type { SubmitFileReport, SubmittedFinding } from './report-schema.js';
import type { FileVerdict, Finding, TestCase, TestFile } from './types.js';

export interface CheckedReport {
  /** Findings with ranges snapped to detected cases, end lines filled in, and names set. */
  findings: Finding[];
  /** Problems the agent must fix; empty when the report is accepted. */
  errors: string[];
}

/**
 * Normalizes a submitted report against the file, then checks it. Mechanical slips are fixed
 * instead of rejected (each rejection costs a full resubmission): a start line inside or just
 * above a case snaps to that case, end lines come from discovery when known, and an end line past
 * the file is clamped. What remains is rejected with every problem listed at once. When cases
 * were detected, each finding covers exactly one case, so a describe-wide range cannot swallow
 * siblings and no decorator is left behind.
 */
export function checkReport(
  report: SubmitFileReport,
  file: TestFile,
  content: string
): CheckedReport {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const lastLine = lines.at(-1) === '' ? lines.length - 1 : lines.length;
  const errors: string[] = [];
  const findings = report.findings.map((submitted) => normalize(submitted, file.cases, lastLine));

  if (!findings.length && file.cases.length) {
    errors.push(`The file has ${file.cases.length} test cases but the report has no findings.`);
  }

  const starts = new Set(file.cases.map((c) => c.line));
  findings.forEach((finding, index) => {
    const label = `findings[${index}] (line ${finding.startLine})`;
    if (finding.startLine > lastLine) {
      errors.push(`${label}: past the last line (${lastLine}).`);
      return;
    }
    if (finding.endLine < finding.startLine)
      errors.push(`${label}: endLine comes before startLine.`);

    if (file.cases.length) {
      if (!starts.has(finding.startLine)) {
        const nearest = nearestCase(file.cases, finding.startLine);
        errors.push(
          `${label}: not a case start line; nearest case starts at ${nearest?.line} ("${nearest?.name}").`
        );
      } else {
        const inside = file.cases.filter(
          (c) => c.line >= finding.startLine && c.line <= finding.endLine
        );
        if (inside.length > 1) {
          errors.push(
            `${label}: covers ${inside.length} cases (lines ${inside.map((c) => c.line).join(', ')}); report one finding per case.`
          );
        }
      }
    } else if (!nameInRange(finding.test, lines, finding.startLine, finding.endLine)) {
      errors.push(
        `${label}: the test name does not appear in lines ${finding.startLine}-${finding.endLine}.`
      );
    }

    if (finding.action === 'merge' && !finding.mergeGroup?.trim()) {
      errors.push(
        `${label}: merge needs mergeGroup, a label shared by the cases that become one test.`
      );
    }
    if (finding.action === 'delete' && finding.category === 'DUP' && !finding.coveredBy) {
      errors.push(`${label}: a DUP delete needs coveredBy naming the test that already proves it.`);
    }
    const yes = Object.values(finding.bar).filter(Boolean).length;
    if (finding.action === 'keep' && yes < 3 && !finding.bar.costly) {
      errors.push(
        `${label}: keep needs at least 3 bar answers true (or costly for a sole proof); got ${yes}.`
      );
    }
    if (finding.action === 'merge' && yes < 3 && !finding.bar.costly) {
      errors.push(
        `${label}: merge is for cases worth keeping. Answer the bar for the merged test; if fewer than 3 hold, the case is a delete.`
      );
    }
    // The sole-proof exception: deleting a costly case must say what still proves it.
    if (finding.action === 'delete' && finding.bar.costly && !finding.coveredBy) {
      errors.push(
        `${label}: deleting a costly case needs coveredBy naming what still proves it; if nothing does, keep or rewrite it.`
      );
    }
    if (finding.action === 'delete' && finding.category === 'VALUABLE') {
      errors.push(
        `${label}: a deleted case cannot be VALUABLE; pick the code that explains the delete.`
      );
    }
  });

  const sorted = findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => a.finding.startLine - b.finding.startLine);
  let reach = { end: 0, index: -1 };
  for (const { finding, index } of sorted) {
    if (finding.startLine <= reach.end)
      errors.push(`findings[${reach.index}] and findings[${index}] overlap or repeat a case.`);
    if (finding.endLine > reach.end) reach = { end: finding.endLine, index };
  }

  const groups = new Map<string, Finding[]>();
  for (const f of findings)
    if (f.action === 'merge' && f.mergeGroup)
      groups.set(f.mergeGroup, [...(groups.get(f.mergeGroup) ?? []), f]);
  for (const [group, members] of groups) {
    // A one-case group is fine when it merges with cases in other files, named in coveredBy.
    if (members.length < 2 && !members[0]?.coveredBy) {
      errors.push(
        `mergeGroup "${group}" has a single case in this file. Name the cases in other files it merges with in coveredBy, or, if another test already covers it, use delete with category DUP.`
      );
    }
  }

  const reported = new Set(findings.map((f) => f.startLine));
  const missing = file.cases.filter((c) => !reported.has(c.line));
  if (missing.length) {
    errors.push(
      `Missing findings for cases starting at: ${missing.map((c) => `line ${c.line} "${c.name}"`).join(', ')}. Report every case, including kept ones.`
    );
  }
  return { findings, errors };
}

function nearestCase(cases: TestCase[], line: number): TestCase | undefined {
  return cases.reduce<TestCase | undefined>(
    (best, c) => (!best || Math.abs(c.line - line) < Math.abs(best.line - line) ? c : best),
    undefined
  );
}

// Snaps the start to a case: the case whose detected range contains it, or the only case starting
// within a few lines (the agent often points at `def`/`fn` instead of the decorator above it).
function normalize(submitted: SubmittedFinding, cases: TestCase[], lastLine: number): Finding {
  let start = submitted.startLine;
  const containing = cases.find(
    (c) => c.endLine !== undefined && c.line <= start && start <= c.endLine
  );
  const near = cases.filter((c) => c.line >= start - 8 && c.line <= start + 3);
  const target =
    cases.find((c) => c.line === start) ?? containing ?? (near.length === 1 ? near[0] : undefined);
  if (target) start = target.line;
  const end = Math.min(target?.endLine ?? submitted.endLine ?? start, lastLine);
  return {
    test: submitted.test ?? target?.name ?? '',
    startLine: start,
    endLine: Math.max(end, start),
    action: submitted.action,
    category: submitted.category,
    reason: submitted.reason,
    bar: submitted.bar,
    coveredBy: submitted.coveredBy?.trim() || null,
    mergeGroup: submitted.action === 'merge' ? submitted.mergeGroup?.trim() || null : null,
    confidence: submitted.confidence
  };
}

/**
 * Whole-file deletion only for pure test files whose cases were all detected and all deleted.
 * Merges need editing, so they make a file `prune`, as do inline-test files (production code)
 * and files without detected cases.
 */
export function verdictOf(
  findings: Finding[],
  file: Pick<TestFile, 'inline' | 'cases'>
): FileVerdict {
  const wholeFile = !file.inline && file.cases.length > 0;
  if (wholeFile && findings.length && findings.every((f) => f.action === 'delete'))
    return 'delete_file';
  if (findings.some((f) => f.action === 'delete' || f.action === 'merge')) return 'prune';
  if (findings.some((f) => f.action === 'rewrite')) return 'rewrite';
  return 'keep';
}

// For files without detected cases: the last describe segment (minus table placeholders and
// pytest ids) must appear somewhere in the range. Catches invented line numbers.
function nameInRange(test: string, lines: string[], start: number, end: number): boolean {
  const leaf = (test.split(' > ').at(-1) ?? test).split('::').at(-1) ?? test;
  const probe = leaf
    .replaceAll('\\', '')
    .split(/%[sdifjo#%]|\$\{?\w+\}?|\[/)[0]
    ?.trim()
    .slice(0, 40);
  if (!probe || probe.length < 4) return true;
  const window = lines
    .slice(start - 1, Math.min(end, start + 40))
    .join('\n')
    .replaceAll('\\', '');
  return window.includes(probe) || window.includes(probe.replaceAll(' ', '_'));
}
