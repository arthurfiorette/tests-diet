# Changelog

## 0.2.1

- `delete` moves the remaining findings of pruned files to their new lines. Before, the pruned files' merges and rewrites dropped out of the report as stale.
- `rebase` command: carries reports over to files changed only by removed cases.
- `--replan` keeps a copy of the old `state.json` (`state.<timestamp>.json`).
- The clean-tree check ignores `tests-diet.config.json`.
- Rubric: a test whose expected values are copied from the code catches no mistake, whatever it asserts. Auditing guidance moved to `references/auditing.md`.
- Stricter reports: the sole-proof exception needs `costly` and `silent`, a case matching a never-write code cannot be kept, and `LOW_VALUE` cannot be rewritten.
- Each confidence level is described, so agents use `medium` only when a reviewer could reasonably disagree.

## 0.2.0

- Built and published on Node 26; TypeBox 1.4.3.
- README rewritten.

## 0.1.0

- `plan`, `run`, `status`, `report` and `delete` commands.
- Case end lines computed in discovery; agents no longer report them, and `delete` only removes detected ranges.
- Test discovery for JavaScript/TypeScript, Python, Rust (including inline `#[cfg(test)]` modules), Go, Java, Kotlin, C#, Ruby, PHP, Swift, Elixir, Dart, Scala, C++ and Lua; `--match` and `--case-start` for anything else.
- Token-budget grouping that never splits a file and keeps folders together.
- pi agent pool using the user's pi configuration, with a validated `submit_file_report` tool, nudges for plain-text replies, a shared prompt cache and resumable sessions.
- Pool-only MCP servers, extra tools and extensions; Serena setup in the README.
- JSON, Markdown and HTML reports with per-file usage and cost.
- JSON schema for `tests-diet.config.json`, published at `https://arthur.run/tests-diet/schema.json`.
