import type { ReportData } from '../report.js';
import { clientScript, styles, themeScript } from './assets.js';
import {
  ActionFilters,
  FileView,
  Filters,
  integer,
  Logo,
  Navigator,
  RunDetails,
  removableLines
} from './components.js';

function Page({ data }: { data: ReportData }) {
  const files = [...data.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const t = data.totals;
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark light" />
        <meta name="referrer" content="no-referrer" />
        <title>tests-diet · Test review</title>
        <script>{themeScript}</script>
        <style>{styles}</style>
      </head>
      <body>
        <a class="skip-link" href="#review">
          Skip to review
        </a>
        <header class="app-header">
          <div class="brand">
            <Logo />
          </div>
          <section class="report-summary" aria-label="Estimates within analyzed files">
            <div title="Estimated removable lines within analyzed files">
              <strong safe>{`~${integer(t.removableLines)}`}</strong>
              <span>removable lines</span>
            </div>
            <div title="Files suggested for deletion within analyzed files">
              <button type="button" id="show-deletions">
                <strong safe>{integer(t.verdicts.delete_file)}</strong> files to delete
              </button>
            </div>
          </section>
          <div class="audit-status">
            <span class="status-dot" />
            <span>
              <b safe>{integer(t.reportedFiles)}</b>
              <span safe>{` / ${integer(t.testFiles)} files analyzed`}</span>
            </span>
            {t.reportedFiles < t.testFiles && <span class="partial">Partial report</span>}
          </div>
          <button type="button" id="open-run">
            Run details
            {t.failedFiles > 0 ? ` (${t.failedFiles} error${t.failedFiles === 1 ? '' : 's'})` : ''}
          </button>
          <button type="button" id="theme-toggle" aria-label="Switch color theme">
            Light mode
          </button>
          <a class="author-credit" href="https://arthur.place" target="_blank" rel="noopener">
            Made by Arthur Fiorette
          </a>
        </header>
        <ActionFilters data={data} />
        <div class="workspace">
          <aside class="navigator" aria-label="File navigator">
            <Filters />
            <div class="navigator-caption">
              <span id="file-count" aria-live="polite" />
              <span title="Number of tests with changes suggested">Changes</span>
            </div>
            <div class="file-scroll">
              <Navigator files={files} />
              <p id="nav-empty" hidden>
                No matching files.
              </p>
            </div>
            <footer class="navigator-footer">
              <span>Reported files only</span>
              <span title="Alt + Up / Down to navigate files">Alt ↑ ↓</span>
            </footer>
          </aside>
          <hr
            id="sidebar-resize"
            class="sidebar-resize"
            tabindex="0"
            aria-label="Resize file navigator"
            aria-orientation="vertical"
            aria-controls="review"
            aria-valuemin="190"
            aria-valuemax="480"
            aria-valuenow="260"
            title="Drag to resize. Arrow keys adjust width; double-click resets."
          />
          <main id="review" class="review" tabindex="-1">
            <div class="review-toolbar">
              <button type="button" id="show-files">
                Files
              </button>
              <span id="position" aria-live="polite" />
              <span class="scroll-hint">Scroll to continue through files</span>
              <div>
                <button type="button" id="previous" aria-label="Previous file">
                  ↑ Previous
                </button>
                <button type="button" id="next" aria-label="Next file">
                  Next ↓
                </button>
              </div>
            </div>
            <div id="review-scroll" class="review-scroll">
              <div id="file-content" />
              <section id="empty" class="empty">
                <span class="empty-symbol" aria-hidden="true">
                  ∅
                </span>
                <h1>{files.length ? 'No matching recommendations' : 'No files analyzed yet'}</h1>
                <p>
                  {files.length
                    ? 'Try another action, or clear the filters to see more files.'
                    : 'Generate the report after an analysis run to review its findings.'}
                </p>
                {files.length > 0 && (
                  <button type="button" id="clear-all">
                    Show all tests
                  </button>
                )}
              </section>
            </div>
          </main>
        </div>
        <RunDetails data={data} />
        <div id="value-tooltip" role="tooltip" hidden />
        <div id="report-files" data-generated-at={data.generatedAt} hidden>
          {files.map((file, index) => (
            <div
              data-record={index}
              data-path={file.path}
              data-verdict={file.verdict}
              data-lines={removableLines(file)}
              data-findings={
                // KitaJS quotes attributes but leaves ampersands intact. JSON-escape them so
                // HTML cannot decode literal entities in test names before JSON.parse runs.
                JSON.stringify(
                  file.findings.map((f) => ({
                    action: f.action,
                    category: f.category,
                    confidence: f.confidence,
                    startLine: f.startLine,
                    test: f.test
                  }))
                ).replaceAll('&', '\\u0026')
              }
            >
              <template>
                <FileView file={file} />
              </template>
            </div>
          ))}
        </div>
        <noscript>
          <p class="noscript">
            Enable JavaScript to browse this offline report. The accompanying Markdown report is
            readable without JavaScript.
          </p>
        </noscript>
        <script>{clientScript}</script>
      </body>
    </html>
  );
}

/** The report works offline; optional syntax highlighting loads from a CDN. */
export function renderHtml(data: ReportData): string {
  const html = <Page data={data} />;
  if (typeof html !== 'string') throw new Error('report templates must render synchronously');
  return `<!doctype html>\n${html}`;
}
