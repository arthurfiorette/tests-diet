import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Group, TestFile } from './types.js';

const SKILLS_DIR = fileURLToPath(new URL('../skills/', import.meta.url));

/** A skill file without its frontmatter and without sections meant for test authors only. */
function readSkill(relativePath: string): string {
  return readFileSync(`${SKILLS_DIR}${relativePath}`, 'utf8')
    .replace(/^---\n[\s\S]*?\n---\n+/, '')
    .replace(/\n## Before done\n[\s\S]*?(?=\n## |\nExamples of each code|$)/, '\n')
    .replace(/\nExamples of each code.*\n?/, '\n')
    .trim();
}

const PROTOCOL = `# Role

You audit test files: for every test case you decide whether it is worth its cost, using the rubric below. You never edit files.

# Protocol

- The user message lists the test files of your work group and every detected test case as \`start-end name\` (or \`start name\` when the end is unknown). Handle the files one at a time, in list order: after each accepted report, earlier turns are removed from your context, so do not read ahead for later files.
- For each file: read it fully, read the production code it exercises, and search for other tests covering the same code. For end-to-end specs, find the unit or integration tests of the rules the spec asserts (prices, permissions, calculations) before keeping it. Keep searches small: scope grep to the package of the code under test, a few alternatives per pattern, no context lines. Then call \`submit_file_report\` for that file.
- Reported files are final. Never re-check or resubmit them.
- \`submit_file_report\` is the ONLY way to deliver results. Never answer with a plain-text report. When it returns errors, fix them and call it again for the same file.
- One finding per test case, kept cases included. A table-driven case (\`it.each\`, \`@parametrize\`, \`#[rstest]\` with cases) is one case.
- \`startLine\` is the case start line from the work list (it already includes decorators/attributes above the case). Omit \`endLine\` and \`test\` when the work list gives them; never grep for line numbers it already lists. When a file has no detected cases, give \`startLine\` (the first decorator/attribute line, or the line of \`it(\`/\`test(\`/\`def test_\`/\`#[test]\`), \`endLine\` and \`test\`.
- \`category\` is one code: TYPE, CONST, TAUT, CALLS, NOOP, TRIVIAL, LIB, SOURCE, SNAP, DUP, LAYER, FLAKY, DEAD, LOW_VALUE (correct but fails the value bar), VALUABLE (passes the bar: kept, merged or rewritten), OTHER (avoid).
- Answer \`bar\` first, from what the test actually does, then pick \`action\` from the Verdict table of the auditing guide. Kept and merged cases need at least 3 true bar answers, unless they are the only proof of a costly behavior (costly and silent both true).
- Before deleting a case in auth, tenant scoping, billing/credits or customer-message code, name the test that still proves it in \`coveredBy\`; if nothing does, keep or rewrite it. Describe what the test does, not what its title says.
- A case fully proven by another existing test (e.g. "creates a user" when "deletes a user" creates and checks one): \`delete\`, category DUP, \`coveredBy\` naming that test.
- Cases that could become fewer tests with the same coverage (a table, one flow): \`merge\`, all with the same \`mergeGroup\` label. A merge with cases in other files names them in \`coveredBy\`. Omit \`mergeGroup\` for every other action, and \`coveredBy\` when nothing is named.
- \`confidence\` follows the Confidence levels of the auditing guide.
- Be strict. "It tests something real" is not enough to keep a case.
- Reasons: one short sentence when the call is clear-cut; explain more when it depends on what else covers the behavior or on a protected area. Read files in parallel tool calls where you can; do not re-read a file you already read.
- When the tool says every file is reported, stop.`;

/**
 * The system prompt is identical for every worker of a run: nothing about a group, file or date,
 * so the provider caches it once and every agent reuses it. Group data goes in the first user
 * message.
 */
export function buildSystemPrompt(instructions: string | undefined): string {
  const parts = [
    PROTOCOL,
    '# Rubric',
    readSkill('writing-tests/SKILL.md'),
    readSkill('writing-tests/references/auditing.md'),
    '# Examples',
    readSkill('writing-tests/references/examples.md')
  ];
  if (instructions?.trim()) parts.push('# Project instructions', instructions.trim());
  return parts.join('\n\n');
}

/** Identifies the rubric a report was produced with; reports from another key are stale. */
export function promptKey(systemPrompt: string, model: string): string {
  return createHash('sha256').update(`${model}\n${systemPrompt}`).digest('hex').slice(0, 16);
}

export function buildGroupPrompt(group: Group, pending: TestFile[]): string {
  return [
    `Work group ${group.id}: ${pending.length} test file(s).`,
    '',
    ...pending.map(describeFile),
    '',
    // No "start with X": this message stays in every trimmed request, where it would contradict
    // the "already reported" note.
    'Work through them in the listed order.'
  ].join('\n');
}

export function buildResumePrompt(pending: TestFile[]): string {
  return [
    'The run was interrupted. These files still have no accepted report:',
    ...pending.map(describeFile),
    '',
    'Continue with them, using submit_file_report for each one.'
  ].join('\n');
}

export function buildNudgePrompt(pending: TestFile[], afterError: boolean): string {
  const lead = afterError
    ? 'The previous request failed. Continue the work.'
    : 'Do not reply with text: results only count through submit_file_report.';
  return [
    `${lead} Pending files (${pending.length}):`,
    ...pending.map((file) => `- ${file.path}`)
  ].join('\n');
}

// Each case's range and name, so the agent neither greps for line numbers nor echoes them back.
function describeFile(file: TestFile): string {
  const head = `- ${file.path} (${file.language}${file.inline ? ', production file with inline tests: judge only the tests' : ''}, ~${file.tokens} tokens, ${file.cases.length ? `${file.cases.length} cases` : 'cases not detected'})`;
  const cases = file.cases.map(
    (c) =>
      `  - ${c.endLine ? `${c.line}-${c.endLine}` : `${c.line}`} ${c.name.length > 80 ? `${c.name.slice(0, 77)}...` : c.name}`
  );
  return [head, ...cases].join('\n');
}
