---
name: tests-diet
description: Classify a repository's tests with the tests-diet CLI and apply its report. Use to audit, prune or slim down a test suite.
---

# tests-diet

`tests-diet` splits a repository's test files into groups, runs a pool of pi agents that judge every test case against the `writing-tests` value bar, and writes a report. It never edits code; applying the report is a separate step.

## Classify

```bash
npx tests-diet plan                     # groups and token estimates, no model calls
npx tests-diet run --model <pattern>    # classify; resumable, safe to interrupt
npx tests-diet status                   # progress, failures, usage and cost so far
npx tests-diet report                   # rewrite tests-diet.{json,md,html} from the state
```

- Repo-specific rules (protected areas, house patterns): `--instructions path/to/rules.md`. Changing them, the model or the rubric makes earlier results stale, so a rerun re-classifies.
- Calibrate before a full run: `--limit 3` classifies only the first groups; review the HTML report, adjust the instructions, rerun.
- Unusual layouts: `--match '<glob>[:<content regex>]'` and `--case-start '<regex>'`.

## Apply a report

`.tests-diet/tests-diet.md` lists every file with something to change, ranges as `startLine-endLine` (1-based, inclusive). `tests-diet.json` has the same data for scripts.

1. `delete_file`: delete the file.
2. `prune`: remove every `delete` range, bottom-up within a file so earlier line numbers stay valid. Then handle `merge` ranges by test name (not line number): fold the case into the named survivor, then remove it.
3. `rewrite`: leave for a follow-up unless asked.
4. Remove what became unused: imports, helpers, fixtures, mock files, production exports or flags that only those tests used.
5. Run the project's formatter, linter, type checker and the affected test suites. A failure in a kept test means a range was wrong: restore it.

Group the edits by package or area, one change set each, listing removed cases and lines.
