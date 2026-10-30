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

**Spawn a pool of [pi](https://pi.dev) agents to find the tests in your repository that are not worth keeping.**

Coding agents write a test for every change, so test suites grow faster than the protection they give, and every test costs CI time on every run. tests-diet hands your test files to a pool of agents. Each agent reads the tests and the code they cover, then marks every test case to keep, delete, merge or rewrite. You review the result in your browser and apply it with one command.

A test stays only if 3 of these 4 are true: a break would be costly, nothing else would catch it, the code is likely to break, and the test is cheap to run.

Use the CLI to clean up the tests you have today, then install the writing-tests skill so your agents stop adding new ones.

> [!WARNING]
> Every test file, and any code the agents read, is sent to your model provider. Start with a small run to see what a full one will cost.

You need Node.js 24.16+, git, and pi set up with a model you can use.

<p align="center">
  <img src="https://raw.githubusercontent.com/arthurfiorette/tests-diet/main/images/readme-terminal.png" alt="tests-diet run showing each agent's group, files reported, turns, tokens, cost and current tool call" />
</p>

<br />

## Get started

Install the CLI:

```sh
npm i -g tests-diet
```

Create `tests-diet.config.json` at the root of the repository you want to audit:

```json
{
  "$schema": "https://arthur.run/tests-diet/schema.json",
  "model": "claude-haiku-5-5",
  "instructions": "docs/test-rules.md"
}
```

The model can be any model your pi setup knows. The instructions file is optional: write your own rules there, like areas where every test stays. Your editor shows every other option as you type.

Check what will be audited, without calling a model:

```sh
tests-diet plan
```

Try it on two groups and open the report:

```sh
tests-diet run --limit 2
open .tests-diet/tests-diet.html
```

If you disagree with some verdicts, add your reasons to the instructions file and run again. Then run everything:

```sh
tests-diet run
```

You can stop with Ctrl+C at any time. The next run continues where it stopped. Runs need a clean git work tree, since the report points at line numbers.

<br />

## Review the report

Each run writes three files to `.tests-diet/`:

| File            | For                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| tests-diet.html | You. Every test with its verdict, the reason and its source code. Filter, search, and open any test in VS Code. |
| tests-diet.md   | An agent. Instructions to apply the changes, file by file.                                                      |
| tests-diet.json | Scripts. All the data, including tokens and cost per file.                                                      |

<p align="center">
  <img src="https://raw.githubusercontent.com/arthurfiorette/tests-diet/main/images/readme-report.png" alt="The HTML report: a file tree on the left, and test cases marked Delete or Merge with their reason, checks and source" />
</p>

Each verdict comes with a reason and a confidence level. Tests marked as duplicates name the test that already covers them, and tests to merge are grouped into the single test they should become.

`tests-diet status` shows progress and cost at any time.

<br />

## Apply it

Deleting tests needs no judgment, so the CLI does it:

```sh
tests-diet delete --dry-run
tests-diet delete
```

It only changes files that are unchanged since the run, and skips anything below medium confidence. Use `--only <folder>` to go one folder at a time.

Merges and rewrites need an agent. Install the tests-diet skill and ask your agent to apply `.tests-diet/tests-diet.md`:

```sh
npx skills add arthurfiorette/tests-diet --skill tests-diet
```

<br />

## Keep it lean

A clean suite grows back if your agents keep writing a test for every change. The writing-tests skill is the same rubric the auditors use, written for whoever adds the next test. Agents read it before writing a test: it makes them look for existing coverage first and skip tests that would not pass the bar.

```sh
npx skills add arthurfiorette/tests-diet --skill writing-tests
```

Add `-g` to install it for all your projects.

<br />

## Configuration

All settings live in `tests-diet.config.json`. With the `$schema` line, your editor completes and documents every option. Command-line flags override the file for one run.

| Option           | Flag              | Default         | Description                                                                                            |
| ---------------- | ----------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| `model`          | `--model`         | your pi default | Model the agents use.                                                                                  |
| `thinking`       | `--thinking`      | `low`           | Thinking level, from off to max.                                                                       |
| `concurrency`    | `--concurrency`   | `32`            | Agents running at once. Lower it if your provider rate-limits you.                                     |
| `instructions`   | `--instructions`  |                 | Markdown file with your own rules.                                                                     |
| `include`        | `--include`       |                 | Only audit files matching these globs.                                                                 |
| `exclude`        | `--exclude`       |                 | Skip files matching these globs. node_modules, build folders and git-ignored files are always skipped. |
| `budget`         | `--budget`        | `50000`         | Tokens of test code per agent session.                                                                 |
| `minGroup`       | `--min-group`     | `15000`         | Smaller groups are merged with a neighbor.                                                             |
| `tolerance`      | `--tolerance`     | `0.1`           | How far a group may go over the budget.                                                                |
| `outDir`         | `--out`           | `.tests-diet`   | Where state and reports go.                                                                            |
| `languages`      |                   | built in        | Replaces the built-in languages.                                                                       |
| `extraLanguages` | `--match`         |                 | Adds languages.                                                                                        |
| `mcpServers`     | `--mcp-config`    |                 | MCP servers for the agents.                                                                            |
| `tools`          | `--tools`         |                 | Extra tools the agents may call.                                                                       |
| `extensions`     | `--extension`     |                 | Extra pi extensions.                                                                                   |
| `agentDir`       | `--agent-dir`     | pi's own        | pi config folder for the agents.                                                                       |
| `trustProject`   | `--trust-project` | `false`         | Load the audited project's own pi settings.                                                            |
| `maxRejections`  |                   | `3`             | Rejected reports per file before giving up on it.                                                      |
| `maxIdleTurns`   |                   | `25`            | Agent turns without progress before stopping its session.                                              |
| `transport`      |                   | `sse`           | Connection type to the provider.                                                                       |

Run `tests-diet --help` for flags that only apply to one run, such as `--limit`, `--only` and `--fresh`.

### Languages

tests-diet finds tests in JavaScript, TypeScript, Python, Rust, Go, Java, Kotlin, C#, Ruby, PHP, Swift, Elixir, Dart, Scala, C++ and Lua. For anything else, add a language with the files it covers and a regex for the line where a test starts:

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

<br />

## Recommended: Serena

The agents run with your own pi setup, but they only get read-only tools and never load the audited project's agent files or your personal MCP servers.

[Serena](https://github.com/oraios/serena) lets them find a function and everything that uses it, which makes checking whether a behavior is already tested faster and more accurate than grep. Start one shared server:

```sh
uvx --from git+https://github.com/oraios/serena serena start-mcp-server \
  --transport streamable-http --port 9121 --project "$(pwd)" --mode planning --mode no-onboarding
```

Then add it to your config with its read-only tools:

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

Do not allow Serena's editing tools.

<br />

## How a run works

tests-diet finds every test case in your repository and where it starts and ends. It packs the test files into groups of about 50k tokens, keeping folders together, and gives each group to an agent. The agent reports one file at a time through a tool that rejects incomplete reports, such as a skipped test, so the agent fixes and resubmits them. Results are saved as each file is accepted, in `.tests-diet/`, which has its own `.gitignore`.

<br />

## Contributing

1. Use Node.js 24.16+ and pnpm, then run `pnpm install`.
2. Run `pnpm build`, `pnpm test-types`, `pnpm test` and `pnpm lint`.
3. After changing `src/config-schema.ts`, run `pnpm generate` to update `schema.json`.

<br />

## License

[MIT](LICENSE).
