import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ReportData } from '../src/report.js';
import { emptyUsage } from '../src/state.js';
import { renderHtml } from '../src/templates/index.js';

// The page embeds file contents and model output: neither may become markup or script.
test('report HTML renders file contents and model text as text', () => {
  const hostile = '</template></script><img src=x onerror=alert(1)>';
  const testName = `${hostile} &quot; &#34; &#x22; &NewLine; &amp;quot; "quoted" \\ \n`;
  const data: ReportData = {
    version: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    totals: {
      testFiles: 1,
      reportedFiles: 1,
      failedFiles: 0,
      detectedCases: 1,
      findings: 1,
      actions: { delete: 1, merge: 0, rewrite: 0, keep: 0 },
      categories: { TRIVIAL: 1 },
      verdicts: { delete_file: 0, prune: 1, rewrite: 0, keep: 0 },
      removableLines: 1,
      mergeableLines: 0,
      testLines: 3,
      usage: emptyUsage(),
      cacheHitRate: 0,
      models: [hostile]
    },
    files: [
      {
        path: `a${hostile}.test.ts`,
        hash: 'h',
        verdict: 'prune',
        summary: hostile,
        groupId: 'g',
        model: 'm',
        promptKey: 'k',
        usage: emptyUsage(),
        at: '',
        language: 'javascript',
        inline: false,
        loc: 3,
        snippets: { 1: hostile },
        findings: [
          {
            test: testName,
            startLine: 1,
            endLine: 1,
            action: 'delete',
            category: 'TRIVIAL',
            reason: hostile,
            bar: { costly: false, silent: false, likely: false, cheap: true },
            coveredBy: hostile,
            mergeGroup: null,
            confidence: 'high'
          }
        ]
      }
    ],
    failures: []
  };
  // Inside a quoted attribute value `<` is inert; everywhere else it must be escaped.
  const html = renderHtml(data);
  const outsideAttributes = html.replace(/="[^"]*"/g, '=""');
  assert.ok(!outsideAttributes.includes('<img src=x'), 'raw markup leaked');
  assert.ok(!/<[^>]*\sonerror\s*=/.test(outsideAttributes), 'an event handler leaked');
  assert.equal(
    outsideAttributes.match(/<\/script>/g)?.length,
    2,
    'only the theme bootstrap and report script close script tags'
  );
  assert.ok(html.indexOf('<script>') < html.indexOf('<style>'), 'theme is applied before styles');
  assert.equal(
    outsideAttributes.match(/<\/template>/g)?.length,
    1,
    'only the file body closes a template tag'
  );

  const metadata = html.match(/data-findings="([^"]*)"/)?.[1];
  assert.ok(metadata, 'finding metadata is present');
  // Browsers decode character references once before exposing an attribute through dataset.
  const entities: Record<string, string> = {
    '#34': '"',
    quot: '"',
    '#x22': '"',
    NewLine: '\n',
    amp: '&'
  };
  const decoded = metadata.replace(
    /&(#34|quot|#x22|NewLine|amp);/g,
    (_, name: string) => entities[name] ?? ''
  );
  assert.equal(JSON.parse(decoded)[0].test, testName, 'test names survive HTML and JSON decoding');
});
