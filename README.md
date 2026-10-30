# tests-diet

**Find the tests that are not worth their CI cost.**

Coding agents write a test for every change and copy the shape of the tests around them, so suites grow faster than the protection they give. `tests-diet` splits a repository's test files into groups, runs a pool of [pi](https://pi.dev) agents that judge every test case against a value bar, and writes a report you can review in the browser and hand to another agent to apply. It never edits your code.

A test is worth keeping only if at least 3 of these hold: a break would be **costly**, it would be **silent** (types, other tests and normal use would not reveal it), the code is **likely** to break, and the test is **cheap**. The full rubric is [skills/writing-tests/SKILL.md](skills/writing-tests/SKILL.md).

> [!WARNING]
> Runs call a model for every test file in your repository. Start with `plan` and a `--limit` run to see token use and cost before a full run.

**Requirements:** Node 24.16+, git, and a working [pi](https://pi.dev) setup (`pi -p "hi"` answers).

<br />

## Get started

```bash
npm i -g tests-diet               # or: npx tests-diet ...
cd your-repo
tests-diet plan                   # discover test files and group them; no model calls
tests-diet run --model claude-haiku-5-5 --limit 2   # calibrate on two groups
open .tests-diet/tests-diet.html  # review
tests-diet run --model claude-haiku-5-5             # everything else; resumable
```

`run` needs a clean git work tree (the report points at line ranges of the current files), or `--force`. Stop it at any time with Ctrl+C: accepted reports and agent sessions are saved in `.tests-diet/`, and the next `run` continues where it stopped, including half-finished groups.

<br />

## How it works

1. **Discover.** Test files are found by language presets (JavaScript/TypeScript, Python, Rust, Go, Java, Kotlin, C#, Ruby, PHP, Swift, Elixir, Dart, Scala, C++, Lua). Files ignored by git are skipped. For each file, a regex finds the line where every test case starts, including decorators and attributes above it, and bracket matching (indentation for Python) finds where it ends. Files matched by name where no case is found (`test-helpers.ts`, `test-flow-button.tsx`) are skipped.
2. **Group.** Files are packed into groups of about `--budget` tokens (default 50k, ±10%). A file is never split, files stay with their folder, large folders are cut into balanced parts, and tiny groups are merged.
3. **Classify.** A pool of pi agents (`--concurrency`, at most 32 by default and never more than there are groups) takes groups from a queue. Each agent reads the test files, the code they exercise and other tests that cover it, then reports every case through a `submit_file_report` tool. The tool fixes mechanical slips itself (a start line inside the case, a missing or out-of-file end line), rejects incomplete or wrong reports (a missed case, a keep or merge that fails the bar, a costly delete without `coveredBy`) and hands over the next file. An agent that answers in plain text is told to use the tool.
4. **Report.** `tests-diet.json` (everything), `tests-diet.md` (instructions for an agent that applies the changes) and `tests-diet.html` (a self-contained review page).

Every finding has an action (`delete`, `merge`, `rewrite`, `keep`), a category such as `CONST`, `TAUT`, `DUP` or `LOW_VALUE`, the four bar answers, a reason, a confidence level from `very_low` to `very_high`, and the line range. Cases fully proven by another test are `delete` with `DUP` and name that test. Cases that could become fewer tests with the same coverage are `merge`, sharing a `mergeGroup` label. Files are `delete_file`, `prune`, `rewrite` or `keep`; production files that contain tests (Rust `#[cfg(test)]`) are never deleted as a whole.

### Cost and caching

The system prompt (rubric and your instructions) and the tool definitions are identical for every agent, and the group's files only appear in the first user message. One agent runs alone until its first response, so the provider caches that prefix once and every other agent reuses it. `status` and the report show input, cache-read and output tokens, cost, and the cache hit rate, per file and in total.

<br />

## Commands

|Command|What it does|
|-|-|
|`tests-diet plan`|Discover, group, and store the plan. Prints groups and token estimates.|
|`tests-diet run`|Classify pending groups, then write the report. Exit code 2 when some files could not be reported, 130 when interrupted.|
|`tests-diet status`|Progress, verdict counts, usage and cost of the stored run.|
|`tests-diet report`|Rewrite the report files from the stored run.|
|`tests-diet delete`|Apply the report: delete `delete_file` files and remove `delete` ranges, only in files unchanged since they were reported and only for cases whose end line was detected. `--dry-run`, `--min-confidence <level>` (default `medium`), `--only <prefix>`.|

Run `tests-diet --help` for every flag.

<br />

## Calibrate

Results depend on the model and on what your team considers valuable. Before a full run:

1. `tests-diet run --limit 2` and review the HTML report.
2. Write the disagreements down as project rules (protected areas, house patterns, tests you always want kept) in a file and pass it with `--instructions rules.md`.
3. Rerun. Changing the instructions, the model or the rubric makes earlier results stale, so they are classified again; `--fresh` forces that too.

`--only <path>` limits a run to groups with files under a path.

<br />

## Configure

Settings can live in `tests-diet.config.json` at the root. CLI flags win over the file. The `$schema` line gives editors completion and validation for every key.

```json
{
  "$schema": "https://arthur.run/tests-diet/schema.json",
  "model": "claude-haiku-5-5",
  "concurrency": 32,
  "budget": 50000,
  "instructions": "docs/test-rules.md",
  "exclude": ["legacy/**"],
  "extraLanguages": [
    {
      "name": "my-dsl",
      "matchers": [{ "include": ["**/*.spec.dsl"] }],
      "caseStart": "^\\s*scenario\\b"
    }
  ]
}
```

- `exclude` and `--exclude` are added to the defaults (`node_modules`, `dist`, `build`, `target`, virtual environments, ...).
- `extraLanguages` are checked before the defaults. A matcher can require a content regex (`"contains"`) and can mark production files with embedded tests (`"inline": true`).
- On the command line, `--match '<glob>[:<content regex>]'` (repeatable) and `--case-start '<regex>'` add a custom language, e.g. `--match '**/*.rs:#\[cfg\(test\)\]'`.
- Discovery and grouping settings are stored with the plan; changing them needs `--replan`.

<br />

## Agent environment

The pool uses your own pi configuration: settings, credentials, models, and pi packages (for example a package that registers your model provider). Everything else is controlled per run:

|Setting|Flag|Default|
|-|-|-|
|pi config directory|`--agent-dir`|pi's (`~/.pi/agent`)|
|MCP servers for the pool|`--mcp-config <file>` or `mcpServers`|none|
|Extra tools agents may call|`--tools` or `tools`|`read`, `grep`, `find`, `ls` only|
|Extra pi extensions|`--extension <file>` or `extensions`|none|
|Project `.pi` config|`--trust-project` or `trustProject`|ignored|

Context files (`AGENTS.md`, `CLAUDE.md`), skills, prompt templates and your personal `mcp.json` are never loaded, so every agent sees the same prompt. Agents cannot edit files: only the read-only tools, the tools you allow, and `submit_file_report` are enabled.

### Recommended: Serena

[Serena](https://github.com/oraios/serena) gives agents symbol-level navigation (find a symbol, find its references), which makes "is this behavior already tested elsewhere?" cheaper and more accurate than grep. All agents work on the same project, so run one shared Serena server instead of one per agent:

```bash
uvx --from git+https://github.com/oraios/serena serena start-mcp-server \
  --transport streamable-http --port 9121 --project "$(pwd)" --mode planning --mode no-onboarding
```

Point the pool at it and allow its read-only tools:

```json
{
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

Put this in `tests-diet.config.json`, or pass the `mcpServers` part with `--mcp-config` and the tool names with `--tools`. Pool servers are declared to the model directly (`"exposure": "direct"` unless you set another), so tool definitions stay identical across agents and keep the prompt cache shared. Do not allow Serena's editing tools.

<br />

## Apply a report

`.tests-diet/tests-diet.md` is written for an agent: it lists every file with something to change, with ranges ordered bottom-up so they can be removed one after the other, merges grouped by `mergeGroup`, and the steps to clean up imports and helpers and to validate. The [`tests-diet` skill](skills/tests-diet/SKILL.md) describes the same workflow; install the skills in your agent of choice to keep new low-value tests from coming back:

- [`writing-tests`](skills/writing-tests/SKILL.md): read before writing any test.
- [`tests-diet`](skills/tests-diet/SKILL.md): run the CLI and apply its report.

<br />

## State directory

`.tests-diet/` holds `state.json` (plan, group status, usage, session files), `results.jsonl` (accepted reports), `failures.jsonl`, `sessions/` (pi sessions, which contain file contents) and the reports. It has its own `.gitignore`.

<br />

## Contributing

1. Node 24.16+ and pnpm, then `pnpm install`.
2. `pnpm build`, `pnpm test-types`, `pnpm test`, `pnpm lint`.
3. After changing `src/config-schema.ts`, run `pnpm generate` to rewrite `schema.json` (CI fails when it is stale).

## License

[MIT](LICENSE).
