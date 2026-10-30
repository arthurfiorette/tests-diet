---
name: tests-diet
description: Classify a repository's tests with the tests-diet CLI and apply its report. Use to audit, prune or slim down a test suite.
---

# tests-diet

`tests-diet` splits a repository's test files into groups, runs a pool of pi agents that judge every test case against the `writing-tests` value bar, and writes a report. It never edits code during a run; applying the report is a separate step.

## Classify

Settings live in `tests-diet.config.json` at the root (`"$schema": "https://arthur.run/tests-diet/schema.json"`); flags override them for one run.

```bash
npx tests-diet plan             # groups and token estimates, no model calls
npx tests-diet run --limit 2    # calibrate on two groups, then review .tests-diet/tests-diet.html
npx tests-diet run              # classify the rest; resumable, safe to interrupt
npx tests-diet status           # progress, failures, usage and cost so far
```

- Repo-specific rules (protected areas, house patterns) go in the file named by `instructions`. Changing them, the model or the rubric makes earlier results stale, so a rerun classifies again.
- Unusual layouts: `extraLanguages` in the config, or `--match '<glob>[:<content regex>]'` and `--case-start '<regex>'`.

## Apply a report

1. `npx tests-diet delete --dry-run`, then `npx tests-diet delete`. It deletes `delete_file` files and removes every `delete` range, only in files unchanged since they were reported. Add `--only <path>` to go one folder at a time.
2. `.tests-diet/tests-diet.md` lists what is left, per file, with ranges as `startLine-endLine` (1-based, inclusive). It is large on big repositories: every `## <path>` section stands alone, so read it one folder at a time.
3. Merges: cases sharing a merge group become one test (a table, or one flow) that keeps every assertion that matters. Find them by test name, since line numbers moved after step 1. A group whose "covered by" names cases in other files is combined across those files.
4. `rewrite`: leave for a follow-up unless asked.
5. Remove what became unused: imports, helpers, fixtures, mock files, production exports or flags that only those tests used.
6. Run the project's formatter, linter, type checker and the affected test suites. A failure in a kept test means an edit went wrong: restore it.

Group the edits by package or area, one change set each, listing removed cases and lines.
