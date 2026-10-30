<p align="center">
   <b>Using this package?</b> Please consider <a href="https://github.com/sponsors/arthurfiorette" target="_blank">donating</a> to support my open source work ❤️
  <br />
  <sup>
   Help tests-diet grow! Star and share this amazing repository with your friends and co-workers!
  </sup>
</p>

<br />

<p align="center" title="tests-diet logo">
  <a href="https://github.com/arthurfiorette/tests-diet">
    <img src="https://raw.githubusercontent.com/arthurfiorette/tests-diet/main/images/readme-logo.png" width="500" alt="tests-diet logo" />
  </a>
</p>

# tests-diet

**Spawn a pool of [pi](https://pi.dev) agents that review every test in your repository and tell you which ones to delete.**

Coding agents write a test for every change and copy the shape of the tests next to them, so suites grow faster than the protection they give. Every one of those tests costs CI time on each run and agent tokens on each change. `tests-diet` splits your test files into groups and hands each group to an agent. The agent reads the tests, the code they exercise and the other tests that already cover it, then gives every test case a verdict: `delete`, `merge`, `rewrite` or `keep`. You review the verdicts in a browser, `tests-diet delete` removes the clear deletions, and an agent of your choice applies the rest from a Markdown report.

The CLI cleans up the suite you have today. To keep it that way, install the [`writing-tests` skill](#keep-it-lean) in your coding agents: it is the same rubric, and it makes them check whether a test is worth writing before they add one.

A test case stays only if at least 3 of these hold: a break would be costly, it would be silent (types, other tests and normal use would not reveal it), the code is likely to break, and the test is cheap to run. The full rubric is in [`skills/writing-tests/SKILL.md`](skills/writing-tests/SKILL.md).

> [!WARNING]
> A run sends every test file, and the code the agents choose to read, to your model provider through pi. It costs money in proportion to the size of your suite. Run `tests-diet plan` and a `--limit 2` run first to see what a full run will cost.

**Requirements:** Node.js 24.16+, git, and a working [pi](https://pi.dev) setup (`pi -p "hi"` answers). [Get started](#get-started) · [Review the report](#review-the-report) · [Apply it](#apply-it) · [Keep it lean](#keep-it-lean) · [Configuration](#configuration) · [Serena](#recommended-serena)

<p align="center">
  <img src="https://raw.githubusercontent.com/arthurfiorette/tests-diet/main/images/readme-terminal.png" alt="tests-diet run showing 32 agents, each with its group, files reported, turns, tokens, cost and current tool call" />
</p>

<br />

## Get started

1. Install the CLI:

   ```sh
   npm i -g tests-diet
   ```

2. Create `tests-diet.config.json` at the root of the repository you want to audit:

   ```json
   {
     "$schema": "https://arthur.run/tests-diet/schema.json",
     "model": "claude-haiku-5-5",
     "instructions": "docs/test-rules.md"
   }
   ```

   `model` is any model pattern your pi setup resolves, including models from pi packages that register a provider. `instructions` is optional: a Markdown file with your project's rules (areas that are always protected, patterns you always keep). Every other key is in the [configuration reference](#configuration).

3. See what will be audited. This makes no model calls:

   ```sh
   tests-diet plan
   ```

4. Classify two groups and open the report:

   ```sh
   tests-diet run --limit 2
   open .tests-diet/tests-diet.html
   ```

   If you disagree with verdicts, write the reason into your `instructions` file and run it again. Changing the instructions, the model or the rubric marks earlier results as stale, so they are classified again.

5. Classify everything else:

   ```sh
   tests-diet run
   ```

`run` needs a clean git work tree, because the report points at line ranges of the current files. Pass `--force` to skip that check. Press Ctrl+C at any time: accepted reports and agent sessions are saved in `.tests-diet/`, and the next `run` continues where it stopped, including groups that were half done.

<br />

## Review the report

Each run writes three files to `.tests-diet/`:

| File | For |
| --- | --- |
| `tests-diet.html` | You. A self-contained page with every file, its verdict and every test case next to its source, the bar answers and the reason. Filter by action, search by name, and open any case in VS Code. |
| `tests-diet.md` | An agent. Every file with something to change, deletions ordered bottom-up so line numbers stay valid, merges grouped into the test they should become, and the cleanup and validation steps. |
| `tests-diet.json` | Scripts. Everything above, plus tokens and cost per file. |

<p align="center">
  <img src="https://raw.githubusercontent.com/arthurfiorette/tests-diet/main/images/readme-report.png" alt="The HTML report: a file tree on the left, and test cases marked Delete or Merge with their reason, bar answers and source" />
</p>

Every finding carries a category explaining the verdict, such as `CONST` (a test that asserts a constant equals itself), `TAUT` (passes by construction), `DUP` (another test already proves it) or `LOW_VALUE` (correct, but fails the bar). It also has a confidence level from `very_low` to `very_high`. A `DUP` deletion names the test that covers it. Cases sharing a `mergeGroup` should become one test, usually a table.

`tests-diet status` prints progress, verdict counts, tokens and cost of the stored run at any time; `-w` keeps it updating. `tests-diet report` rewrites the three files without calling a model.

<br />

## Apply it

`tests-diet delete` applies the part of the report that needs no judgment: it deletes files where every case is a deletion and removes every `delete` range.

```sh
tests-diet delete --dry-run
tests-diet delete
```

It only touches files whose content is unchanged since they were reported, and only removes cases whose last line `tests-diet` found itself, so it never leaves half a test behind. Findings below `medium` confidence are skipped; change that with `--min-confidence`, and use `--only <path>` to apply one folder at a time. Production files that contain tests, such as Rust modules with `#[cfg(test)]`, are never deleted as a whole.

Merges and rewrites stay in `tests-diet.md`. Hand that file to your coding agent with the [`tests-diet` skill](skills/tests-diet/SKILL.md), which walks through applying it, cleaning up unused helpers and imports, and running your checks:

```sh
npx skills add arthurfiorette/tests-diet --skill tests-diet
```

The report is large on a big repository. Every `## <path>` section stands alone, so have the agent work through it one folder at a time.

<br />

## Keep it lean

A pruned suite grows back if your agents keep writing a test for every change. The [`writing-tests` skill](skills/writing-tests/SKILL.md) is the rubric the auditors use, written for whoever adds the next test. Agents read it before writing or changing a test. It makes them search for existing coverage first, check the value bar, pick the right layer, and skip patterns such as asserting a constant against itself or a mock against the value it was told to return.

Install it in the repository, for every agent you use:

```sh
npx skills add arthurfiorette/tests-diet --skill writing-tests
```

`npx skills add arthurfiorette/tests-diet` without `--skill` lets you pick both skills. Add `-g` to install for your user instead of one project.

<br />

## Configuration

`tests-diet.config.json` at the project root is the place for settings. The `$schema` line gives your editor completion and validation for every key. Command-line flags override the file for a single run.

| Key | Flag | Default | What it does |
| --- | --- | --- | --- |
| `model` | `--model` | your pi default | pi model pattern, such as `claude-haiku-5-5` or `provider/id`. |
| `thinking` | `--thinking` | `low` | Thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`. |
| `concurrency` | `--concurrency` | `32` | Maximum agents at once. Never more than there are groups. Lower it if your provider rate-limits you. |
| `instructions` | `--instructions` | none | Markdown file with project rules, appended to the rubric. |
| `include` | `--include` | everything | Only consider files matching these globs. |
| `exclude` | `--exclude` | none | Skip files matching these globs, on top of `node_modules`, `dist`, `build`, `target`, virtual environments and the like. |
| `budget` | `--budget` | `50000` | Target tokens of test code per group. |
| `minGroup` | `--min-group` | `15000` | Groups smaller than this are merged with a neighbor. |
| `tolerance` | `--tolerance` | `0.1` | How far a group may go over `budget`, as a fraction. |
| `outDir` | `--out` | `.tests-diet` | State, sessions and reports, relative to the root. |
| `languages` | | built in | Replaces the built-in languages. |
| `extraLanguages` | `--match`, `--case-start` | none | Languages checked before the built-in ones. |
| `mcpServers` | `--mcp-config` | none | MCP servers for the agents, in pi's `mcp.json` format. |
| `tools` | `--tools` | none | Extra tools the agents may call. `read`, `grep`, `find` and `ls` are always on. |
| `extensions` | `--extension` | none | Extra pi extensions loaded in every agent. |
| `agentDir` | `--agent-dir` | pi's own | pi config directory for the agents. |
| `trustProject` | `--trust-project` | `false` | Load the audited project's `.pi` settings, packages and extensions. |
| `maxRejections` | | `3` | Rejected reports per file before the file is marked failed. |
| `maxIdleTurns` | | `25` | Agent turns without an accepted report before the session is stopped. |
| `transport` | | `sse` | Provider transport: `auto`, `sse`, `websocket` or `websocket-cached`. |

Some flags only make sense for one run and have no key: `--limit <n>` runs the first n pending groups, `--only <path>` runs groups with files under a path, `--fresh` classifies again even when results are current, `--replan` regroups after you change discovery settings, and `--force` runs on a dirty work tree. `tests-diet --help` lists them all.

### Languages

Test files are found for JavaScript and TypeScript, Python, Rust (including inline `#[cfg(test)]` modules), Go, Java, Kotlin, C#, Ruby, PHP, Swift, Elixir, Dart, Scala, C++ and Lua. Files ignored by git are skipped, and so are files matched by name where no test case is found, such as `test-helpers.ts`.

For anything else, add a language. `matchers` decide which files belong to it, optionally gated on a content regex with `contains`, and `caseStart` is a regex for the line where a test case starts:

```json
{
  "$schema": "https://arthur.run/tests-diet/schema.json",
  "extraLanguages": [
    {
      "name": "my-dsl",
      "matchers": [{ "include": ["**/*.spec.dsl"] }],
      "caseStart": "^\\s*scenario\\b"
    }
  ]
}
```

A matcher with `"inline": true` marks production files that embed tests, which are never deleted as a whole. Discovery settings are stored with the plan, so changing them needs `--replan`.

<br />

## Agent environment

The agents use your own pi setup: settings, credentials, models, and pi packages such as one that registers your model provider. Nothing from the audited project is loaded unless you set `trustProject`. Context files (`AGENTS.md`, `CLAUDE.md`), skills, prompt templates and your personal `mcp.json` are never loaded, so every agent gets the same prompt and the provider can cache it once for all of them.

The agents cannot edit files. They get `read`, `grep`, `find`, `ls`, the tools you list in `tools`, and the `submit_file_report` tool they report through.

### Recommended: Serena

[Serena](https://github.com/oraios/serena) gives the agents symbol navigation: find a function, find everything that references it. Answering "is this behavior already tested somewhere else?" gets cheaper and more accurate than with grep. Every agent audits the same project, so run one shared Serena server:

```sh
uvx --from git+https://github.com/oraios/serena serena start-mcp-server \
  --transport streamable-http --port 9121 --project "$(pwd)" --mode planning --mode no-onboarding
```

Then point the agents at it and allow its read-only tools in `tests-diet.config.json`:

```json
{
  "$schema": "https://arthur.run/tests-diet/schema.json",
  "mcpServers": {
    "serena": { "url": "http://localhost:9121/mcp" }
  },
  "tools": [
    "mcp__serena__find_symbol",
    "mcp__serena__find_referencing_symbols",
    "mcp__serena__get_symbols_overview",
    "mcp__serena__search_for_pattern"
  ]
}
```

Do not allow Serena's editing tools. MCP servers are declared to the model directly (`"exposure": "direct"` unless you set another), which keeps the tool list identical across agents and the prompt cache shared.

<br />

## How a run works

1. **Discover.** A regex per language finds where every test case starts, including decorators and attributes above it. Bracket matching, or indentation for Python, finds where it ends.
2. **Group.** Files are packed into groups of about `budget` tokens. A file is never split, and files stay next to the others in their folder.
3. **Classify.** Each agent takes a group from the queue and reports one file at a time. The report tool fixes small slips itself, such as a start line that points inside the case, and rejects reports that skip a case, keep a case that fails the bar, or delete a costly case without naming what still covers it. The agent fixes those and resubmits. After each accepted file, its transcript is dropped from the agent's context, so long groups stay cheap.
4. **Report.** Results are written as each file is accepted, and the reports are rebuilt at the end of the run.

`.tests-diet/` holds the plan and group status (`state.json`), accepted reports (`results.jsonl`), failures, the reports, and the pi sessions. Sessions contain the contents of the files the agents read. The folder has its own `.gitignore`.

<br />

## Contributing

1. Use Node.js 24.16+ and pnpm, then run `pnpm install`.
2. Run `pnpm build`, `pnpm test-types`, `pnpm test` and `pnpm lint`.
3. After changing `src/config-schema.ts`, run `pnpm generate` to rewrite `schema.json`. CI fails when it is out of date.

<br />

## License

[MIT](LICENSE).
