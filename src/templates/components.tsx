import type { ReportData, ReportFile } from '../report.js';
import { ACTIONS, CATEGORIES, type Category, CONFIDENCE, type Finding } from '../types.js';
import { FileIcon, FolderIcon } from './icons.js';

export const integer = (value: number) => value.toLocaleString('en-US');
const humanize = (value: string) => value.replaceAll('_', ' ');
export const verdicts = {
  delete_file: 'Delete file',
  prune: 'Prune file',
  rewrite: 'Rewrite tests',
  keep: 'Keep file'
};
export const categories: Record<Category, string> = {
  TYPE: 'Already type-checked',
  CONST: 'Constant assertions',
  TAUT: 'Passes by construction',
  CALLS: 'Internal calls only',
  NOOP: 'Behavior not exercised',
  TRIVIAL: 'Trivial behavior',
  LIB: 'Library behavior',
  SOURCE: 'Source inspection',
  SNAP: 'Brittle snapshot',
  DUP: 'Duplicate coverage',
  LAYER: 'Wrong test layer',
  FLAKY: 'Flaky test',
  DEAD: 'Inactive test',
  LOW_VALUE: 'Low value',
  VALUABLE: 'Valuable coverage',
  OTHER: 'Other'
};

export function Logo() {
  return (
    <span class="logo">
      <svg width="37" height="32" viewBox="0 0 44 38" fill="none" aria-hidden="true">
        <rect x="1" y="4" width="33" height="27" rx="5" fill="#202631" />
        <path d="M8 13H26M8 21H18" stroke="#EDF0F3" stroke-width="3.5" stroke-linecap="round" />
        <circle cx="32" cy="26" r="11" fill="#13AD52" />
        <path
          d="m27 26 3.5 3.5 6-7"
          stroke="white"
          stroke-width="3.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span>
        tests<span class="logo-dash">-</span>diet
      </span>
    </span>
  );
}

export function RunDetails({ data }: { data: ReportData }) {
  const t = data.totals;
  return (
    <dialog id="run-dialog" aria-labelledby="run-title">
      <div class="dialog-heading">
        <h2 id="run-title">Run details</h2>
        <button type="button" id="close-run">
          Close
        </button>
      </div>
      <dl class="run-facts">
        {Object.entries({
          Generated: data.generatedAt,
          Model: t.models.join(', ') || 'No model',
          'Files analyzed': `${integer(t.reportedFiles)} of ${integer(t.testFiles)}`,
          'Files with errors': integer(t.failedFiles),
          'Files without a report or error': integer(
            Math.max(0, t.testFiles - t.reportedFiles - t.failedFiles)
          ),
          'Analysis cost': `$${t.usage.cost.toFixed(2)}`,
          'Input tokens': integer(t.usage.input),
          'Cache-read tokens': integer(t.usage.cacheRead),
          'Output tokens': integer(t.usage.output),
          'Cache hit rate': `${Math.round(t.cacheHitRate * 100)}%`,
          'Lines involved in merges': `~${integer(t.mergeableLines)} (not all removable)`,
          'Report format': `v${data.version}`
        }).map(([label, value]) => (
          <div>
            <dt safe>{label}</dt>
            <dd safe>{value}</dd>
          </div>
        ))}
      </dl>
      {data.failures.length > 0 && (
        <section class="failures">
          <h3>Files with errors</h3>
          {data.failures.map((f) => (
            <div>
              <code safe>{f.path}</code>
              <p safe>{f.reason}</p>
            </div>
          ))}
        </section>
      )}
      <p class="muted">Recommendations only. This report has not changed your files.</p>
    </dialog>
  );
}

export function ActionFilters({ data }: { data: ReportData }) {
  const changes = data.totals.findings - data.totals.actions.keep;
  return (
    <fieldset class="action-filters" aria-label="Filter test recommendations">
      <button type="button" data-action="nonkeep" aria-pressed="true">
        Changes <span safe>{integer(changes)}</span>
      </button>
      {ACTIONS.map((action) => (
        <button type="button" data-action={action} aria-pressed="false">
          <i class={`action-dot ${action}`} />
          <span class="capitalize" safe>
            {action}
          </span>
          <span safe>{integer(data.totals.actions[action])}</span>
        </button>
      ))}
      <button type="button" data-action="" aria-pressed="false">
        All tests <span safe>{integer(data.totals.findings)}</span>
      </button>
    </fieldset>
  );
}

export function Filters() {
  return (
    <div class="navigator-controls">
      <label class="search">
        <span class="sr-only">Search paths or test names</span>
        <svg viewBox="0 0 20 20" width="17" height="17" fill="none" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.5" />
          <path d="m13 13 4 4" stroke="currentColor" stroke-width="1.5" />
        </svg>
        <input id="q" type="search" placeholder="Find a file or test…" autocomplete="off" />
        <kbd>/</kbd>
      </label>
      <div class="navigation-options">
        <fieldset class="view-switch" aria-label="File navigation layout">
          <button type="button" data-view="tree" aria-pressed="true">
            Tree
          </button>
          <button type="button" data-view="list" aria-pressed="false">
            List
          </button>
        </fieldset>
        <details class="filter-menu">
          <summary>
            Filters <span id="filter-count" />
          </summary>
          <div>
            <label>
              Category
              <select id="category">
                <option value="">Any category</option>
                {CATEGORIES.map((c) => (
                  <option value={c} safe>
                    {categories[c]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Confidence
              <select id="confidence">
                <option value="">Any confidence</option>
                {[...CONFIDENCE].reverse().map((c) => (
                  <option value={c} safe>
                    {humanize(c)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              File recommendation
              <select id="verdict">
                <option value="">Any recommendation</option>
                {Object.entries(verdicts).map(([value, label]) => (
                  <option value={value} safe>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" id="reset-filters">
              Reset filters
            </button>
          </div>
        </details>
      </div>
      <div class="tree-controls" id="tree-controls">
        <button type="button" id="expand-tree">
          Expand all
        </button>
        <button type="button" id="collapse-tree">
          Collapse all
        </button>
      </div>
      <label class="sort-control" id="sort-control" hidden>
        Sort by
        <select id="sort">
          <option value="path">File path</option>
          <option value="lines">Removable lines</option>
          <option value="confidence">Highest confidence</option>
        </select>
      </label>
    </div>
  );
}

export function removableLines(file: ReportFile): number {
  if (file.verdict === 'delete_file') return file.loc;
  const ranges = file.findings
    .filter((f) => f.action === 'delete')
    .sort((a, b) => a.startLine - b.startLine);
  let end = 0;
  let total = 0;
  for (const range of ranges) {
    total += Math.max(0, range.endLine - Math.max(end, range.startLine - 1));
    end = Math.max(end, range.endLine);
  }
  return total;
}

function OpenFile({ file, line = 1 }: { file: ReportFile; line?: number }) {
  if (!file.sourceUrl?.startsWith('file:')) return '';
  // VS Code expects a filesystem path; the file URL already percent-encodes unsafe path characters.
  const path = new URL(file.sourceUrl).pathname;
  return (
    <a class="open-file" href={`vscode://file${path}:${line}:1`} title="Open in VS Code">
      Open in VS Code
    </a>
  );
}

function Snippet({ file, finding }: { file: ReportFile; finding: Finding }) {
  const rows: Array<{ line: number; text: string }> = [];
  for (let n = finding.startLine; n <= finding.endLine; n++) {
    const text = file.snippets[n];
    if (text === undefined) break;
    rows.push({ line: n, text });
  }
  if (!rows.length)
    return <span class="source-unavailable">Source not included in this report</span>;
  const omitted = finding.endLine - finding.startLine + 1 - rows.length;
  const language = /\.[cm]?tsx?$/.test(file.path) ? 'typescript' : file.language;
  return (
    <div class="source">
      <div class="source-heading">
        <span safe>{`Source · L${finding.startLine}–${finding.endLine}`}</span>
        <OpenFile file={file} line={finding.startLine} />
      </div>
      <div class="source-code">
        <pre class="line-numbers" aria-hidden="true" safe>
          {rows.map((row) => row.line).join('\n')}
        </pre>
        <pre class="code-content">
          <code data-language={language} safe>
            {rows.map((row) => row.text).join('\n')}
          </code>
        </pre>
      </div>
      {omitted > 0 && (
        <p
          class="source-note"
          safe
        >{`${integer(omitted)} more lines are not embedded in this report.`}</p>
      )}
    </div>
  );
}

export function FindingItem({
  file,
  finding,
  index
}: {
  file: ReportFile;
  finding: Finding;
  index: number;
}) {
  return (
    <section
      class={`finding status-${finding.action}`}
      data-finding={index}
      data-test-line={finding.startLine}
    >
      <div class="finding-explanation">
        <div class="finding-meta">
          <span class={`action-label ${finding.action}`} safe>
            {finding.action}
          </span>
          <span title={finding.category} safe>
            {categories[finding.category]}
          </span>
          <span class="confidence" safe>{`${humanize(finding.confidence)} confidence`}</span>
        </div>
        <h3>
          <a
            class="review-anchor"
            data-review-anchor
            href={`#file=${encodeURIComponent(file.path)}&test=${finding.startLine}`}
            title="Link to this test"
            safe
          >
            {finding.test}
          </a>
        </h3>
        <span class="finding-range" safe>{`Lines ${finding.startLine}–${finding.endLine}`}</span>
        <p class="reason" safe>
          {finding.reason}
        </p>
        {finding.coveredBy && (
          <div class="coverage">
            <span>{finding.action === 'merge' ? 'Related coverage' : 'Covered by'}</span>
            <p safe>{finding.coveredBy}</p>
          </div>
        )}
        <dl class="value-bar" aria-label="Value assessment">
          {(
            [
              ['costly', 'Costly if broken'],
              ['silent', 'Silent if broken'],
              ['likely', 'Likely to break'],
              ['cheap', 'Cheap to run']
            ] as const
          ).map(([key, label]) => (
            <div data-yes={String(finding.bar[key])}>
              <dt>
                <button
                  type="button"
                  class="value-help"
                  data-assessment={key}
                  aria-label={`${label}: ${finding.bar[key] ? 'Yes' : 'No'}. Explain this assessment.`}
                >
                  <span safe>{label}</span>
                  <span aria-hidden="true">{finding.bar[key] ? '✓' : '×'}</span>
                </button>
              </dt>
              <dd class="sr-only">{finding.bar[key] ? 'Yes' : 'No'}</dd>
            </div>
          ))}
        </dl>
      </div>
      <Snippet file={file} finding={finding} />
    </section>
  );
}

export function FileView({ file }: { file: ReportFile }) {
  const name = file.path.split('/').at(-1) ?? file.path;
  const parent = file.path.slice(0, Math.max(0, file.path.lastIndexOf('/')));
  const counts = Object.fromEntries(
    ACTIONS.map((a) => [a, file.findings.filter((f) => f.action === a).length])
  );
  const groups = new Map<string, Array<{ finding: Finding; index: number }>>();
  file.findings.forEach((finding, index) => {
    if (finding.action === 'merge' && finding.mergeGroup) {
      const group = groups.get(finding.mergeGroup) ?? [];
      group.push({ finding, index });
      groups.set(finding.mergeGroup, group);
    }
  });
  return (
    <article class="file-review">
      <header class="file-heading">
        <p class="breadcrumb" safe>
          {parent || 'Repository root'}
        </p>
        <div class="file-title">
          <h1>
            <a
              class="review-anchor"
              data-review-anchor
              href={`#file=${encodeURIComponent(file.path)}`}
              title="Link to this file"
              safe
            >
              {name}
            </a>
          </h1>
          <span class={`verdict ${file.verdict}`} safe>
            {verdicts[file.verdict]}
          </span>
          <OpenFile file={file} />
          <span
            class="viewed-label"
            hidden
            title="This file has appeared in the review viewport. Not an approval."
          >
            Viewed
          </span>
        </div>
      </header>
      <div class="file-overview">
        <div class="file-meta">
          <span safe>{`${integer(file.findings.length)} tests`}</span>
          <span safe>{`${integer(file.loc)} file lines`}</span>
          {removableLines(file) > 0 && (
            <span safe>{`~${integer(removableLines(file))} removable`}</span>
          )}
        </div>
        {file.inline && (
          <p class="inline-notice">
            Production file with inline tests. Recommendations apply to tests only.
          </p>
        )}
        <p class="file-summary" safe>
          {file.summary}
        </p>
        <div class="file-actions">
          {ACTIONS.filter((a) => counts[a]).map((a) => (
            <span>
              <i class={`action-dot ${a}`} />
              <span class="capitalize" safe>
                {a}
              </span>{' '}
              <b safe>{counts[a]}</b>
            </span>
          ))}
        </div>
      </div>
      <div class="findings-heading">
        <h2>Test recommendations</h2>
        <span class="finding-count muted" />
      </div>
      <div class="findings">
        {file.findings.map((finding, index) =>
          finding.action === 'merge' && finding.mergeGroup ? (
            ''
          ) : (
            <FindingItem file={file} finding={finding} index={index} />
          )
        )}
        {[...groups].map(([name, entries]) => (
          <section class="merge-group">
            <header>
              <span class="action-label merge">Merge into one test</span>
              <h3 safe>{name}</h3>
              <p
                class="muted"
                safe
              >{`${entries.length} test${entries.length === 1 ? '' : 's'} in this file. Preserve the meaningful assertions in the combined test.`}</p>
            </header>
            {entries.map(({ finding, index }) => (
              <FindingItem file={file} finding={finding} index={index} />
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}

interface Directory {
  name: string;
  directories: Map<string, Directory>;
  files: number[];
}

function FileLink({
  file,
  index,
  list = false
}: {
  file: ReportFile;
  index: number;
  list?: boolean;
}) {
  const name = file.path.split('/').at(-1) ?? file.path;
  const parent = file.path.slice(0, Math.max(0, file.path.lastIndexOf('/')));
  return (
    <button
      type="button"
      class="file-link"
      data-file={index}
      title={`${file.path} — ${verdicts[file.verdict]}`}
    >
      <FileIcon file={file} />
      <span class="file-name">
        <span safe>{name}</span>
        {list && <small safe>{parent || 'Repository root'}</small>}
      </span>
      <span class="viewed-marker" hidden title="Viewed in this report">
        Viewed
      </span>
      <i class={`file-status ${file.verdict}`} aria-hidden="true" />
      <span class="file-count" title="Tests with changes suggested" safe>
        {file.findings.filter((f) => f.action !== 'keep').length || '·'}
      </span>
      <span class="sr-only" safe>
        {verdicts[file.verdict]}
      </span>
    </button>
  );
}

export function Navigator({ files }: { files: ReportFile[] }) {
  const root: Directory = { name: '', directories: new Map(), files: [] };
  files.forEach((file, index) => {
    let node = root;
    for (const name of file.path.split('/').slice(0, -1)) {
      let child = node.directories.get(name);
      if (!child) {
        child = { name, directories: new Map(), files: [] };
        node.directories.set(name, child);
      }
      node = child;
    }
    node.files.push(index);
  });
  function directory(node: Directory, depth: number): JSX.Element {
    let current = node;
    let name = node.name;
    while (!current.files.length && current.directories.size === 1) {
      const child = [...current.directories.values()][0];
      if (!child) break;
      name += `/${child.name}`;
      current = child;
    }
    return (
      <details class="directory" open={depth < 1}>
        <summary>
          <FolderIcon name={current.name} />
          <span class="directory-name" title={name} safe>
            {name}
          </span>
          <span class="directory-count" title="Matching files in this directory" />
        </summary>
        <div class="directory-children">
          {[...current.directories.values()].map((d) => directory(d, depth + 1))}
          {current.files.map((i) => (
            <FileLink file={files[i] as ReportFile} index={i} />
          ))}
        </div>
      </details>
    );
  }
  return (
    <>
      <nav id="tree" aria-label="Files by directory">
        {[...root.directories.values()].map((d) => directory(d, 0))}
        {root.files.map((i) => (
          <FileLink file={files[i] as ReportFile} index={i} />
        ))}
      </nav>
      <nav id="list" aria-label="Sorted files" hidden>
        {files.map((file, index) => (
          <FileLink file={file} index={index} list />
        ))}
      </nav>
    </>
  );
}
