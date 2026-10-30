import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { hashContent } from './discover.js';
import type { ReportData } from './report.js';
import { CONFIDENCE, type Confidence, type Finding, type TestCase } from './types.js';

export interface ApplyOptions {
  /** Only findings at or above this confidence. */
  minConfidence: Confidence;
  /** Only files under these path prefixes. */
  only?: string[];
  /** Print the plan, change nothing. */
  dryRun: boolean;
  /** Detected cases by file path, from the current discovery. Ranges are taken from these. */
  cases: ReadonlyMap<string, TestCase[]>;
}

export interface ApplyResult {
  deletedFiles: string[];
  prunedFiles: Array<{ path: string; ranges: Array<[number, number]> }>;
  removedLines: number;
  /** Files whose content changed since they were reported. */
  stale: string[];
  /** Merge and rewrite findings left for an agent, by file. */
  leftForAgent: number;
  /** Delete findings skipped because their range is not a detected case with a known end. */
  unverified: Array<{ path: string; startLine: number; endLine: number }>;
}

const rank = (c: Confidence) => CONFIDENCE.indexOf(c);

/**
 * Applies the mechanical part of a report: whole-file deletions and `delete` ranges. Merges and
 * rewrites need judgment and stay for an agent. A file is only touched when its content still
 * matches the reported hash, so line ranges are exact.
 */
export function applyReport(root: string, data: ReportData, options: ApplyOptions): ApplyResult {
  const result: ApplyResult = {
    deletedFiles: [],
    prunedFiles: [],
    removedLines: 0,
    stale: [],
    leftForAgent: 0,
    unverified: []
  };
  const prefixes = options.only?.map((p) => p.replace(/^\.\//, ''));
  const confident = (f: Finding) => rank(f.confidence) >= rank(options.minConfidence);

  for (const file of data.files) {
    if (prefixes && !prefixes.some((p) => file.path.startsWith(p))) continue;
    result.leftForAgent += file.findings.filter(
      (f) => f.action === 'merge' || f.action === 'rewrite'
    ).length;
    const deletes = file.findings.filter((f) => f.action === 'delete' && confident(f));
    if (!deletes.length) continue;

    const full = resolve(root, file.path);
    if (!full.startsWith(`${resolve(root)}${sep}`)) continue;
    let content: string;
    try {
      content = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    if (hashContent(content) !== file.hash) {
      result.stale.push(file.path);
      continue;
    }

    // Whole file only when the report says so and every case passed the confidence filter.
    if (file.verdict === 'delete_file' && deletes.length === file.findings.length) {
      result.deletedFiles.push(file.path);
      result.removedLines += file.loc;
      if (!options.dryRun) rmSync(full);
      continue;
    }

    // Agent-reported end lines were often wrong (a parent's `})` swallowed, or a cut mid-test),
    // which would break the file. Only ranges of detected cases with a computed end are removed;
    // since the hash matches, discovery saw this exact content.
    const detected = options.cases.get(file.path) ?? [];
    const ranges: Array<[number, number]> = [];
    for (const f of deletes) {
      const end = detected.find((c) => c.line === f.startLine)?.endLine;
      if (end) ranges.push([f.startLine, end]);
      else result.unverified.push({ path: file.path, startLine: f.startLine, endLine: f.endLine });
    }
    if (!ranges.length) continue;
    ranges.sort((a, b) => b[0] - a[0]);
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(eol);
    for (const [start, end] of ranges) {
      lines.splice(start - 1, end - start + 1);
      result.removedLines += end - start + 1;
      // A case removed between two blank lines leaves a double blank at the seam; only the seam
      // is touched, so intentional blank runs elsewhere (PEP 8) stay.
      const at = start - 1;
      if (at > 0 && lines[at - 1]?.trim() === '' && lines[at]?.trim() === '') lines.splice(at, 1);
    }
    result.prunedFiles.push({ path: file.path, ranges: ranges.reverse() });
    if (!options.dryRun) writeFileSync(full, lines.join(eol));
  }
  return result;
}
