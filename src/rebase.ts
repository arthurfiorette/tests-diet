import type { FileReport, Finding, TestCase, TestFile } from './types.js';
import { verdictOf } from './validate.js';

/**
 * Carries a report over to a new version of its file when the change only removed cases or
 * touched lines outside the remaining ones (unused imports, helpers): after `tests-diet delete` or
 * a hand-applied report. Every finding, in line order, must match the next detected case by name
 * and length, or be a `delete` whose case is gone. Anything else (a renamed, edited or added case)
 * returns undefined, and the file is classified again.
 */
export function rebaseReport(report: FileReport, file: TestFile): FileReport | undefined {
  if (!file.cases.length) return undefined;
  const findings = [...report.findings].sort((a, b) => a.startLine - b.startLine);
  const moved: Finding[] = [];
  let next = 0;
  for (const finding of findings) {
    const candidate = file.cases[next];
    if (candidate && sameCase(finding, candidate)) {
      const span = finding.endLine - finding.startLine;
      moved.push({
        ...finding,
        startLine: candidate.line,
        endLine: candidate.endLine ?? candidate.line + span
      });
      next++;
    } else if (finding.action !== 'delete') {
      return undefined;
    }
  }
  if (next !== file.cases.length) return undefined;
  return { ...report, hash: file.hash, findings: moved, verdict: verdictOf(moved, file) };
}

function sameCase(finding: Finding, candidate: TestCase): boolean {
  const name = candidate.name.trim();
  const test = finding.test.trim();
  // Agents sometimes prefix describe names ("suite > case").
  if (!name || !(test === name || test.split(' > ').at(-1)?.trim() === name)) return false;
  // Same length, so an edited body is not mistaken for the reported one.
  return (
    candidate.endLine === undefined ||
    candidate.endLine - candidate.line === finding.endLine - finding.startLine
  );
}

/** Latest reports whose file changed, rebased onto the current files when possible. */
export function rebaseStale(
  files: readonly TestFile[],
  results: ReadonlyMap<string, FileReport>
): { rebased: FileReport[]; failed: string[] } {
  const rebased: FileReport[] = [];
  const failed: string[] = [];
  for (const file of files) {
    const report = results.get(file.path);
    if (!report || report.hash === file.hash) continue;
    const moved = rebaseReport(report, file);
    if (moved) rebased.push(moved);
    else failed.push(file.path);
  }
  return { rebased, failed };
}
