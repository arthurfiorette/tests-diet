# Changelog

## 0.1.0 (unreleased)

- `plan`, `run`, `status`, `report` and `delete` commands.
- Case end lines computed in discovery; agents no longer report them, and `delete` only removes detected ranges.
- Test discovery for JavaScript/TypeScript, Python, Rust (including inline `#[cfg(test)]` modules), Go, Java, Kotlin, C#, Ruby, PHP, Swift, Elixir, Dart, Scala, C++ and Lua; `--match` and `--case-start` for anything else.
- Token-budget grouping that never splits a file and keeps folders together.
- pi agent pool using the user's pi configuration, with a validated `submit_file_report` tool, nudges for plain-text replies, a shared prompt cache and resumable sessions.
- Pool-only MCP servers, extra tools and extensions; Serena setup in the README.
- JSON, Markdown and HTML reports with per-file usage and cost.
