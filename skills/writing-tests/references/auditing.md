# Auditing guide

How to judge a test that already exists, with the bar and codes of the writing-tests skill.

## Verdict

A code and a failing bar mean delete. A code and a passing bar mean rewrite: the behavior is worth a test, this test proves it badly. No code and a passing bar mean keep.

|Action|When|
|-|-|
|`delete`|Fails the bar or matches a code, and nothing meaningful becomes unprotected.|
|`delete` + `DUP`|Another existing test already proves everything this one does. Example: "creates a user" when "deletes a user" creates one and checks it first. Name the subsuming test in `coveredBy`.|
|`merge`|Several cases worth keeping could become fewer tests with the same coverage: N near-identical cases into one table, or step tests into one flow. Give all of them the same `mergeGroup` label naming the result. Answer the bar for the merged test: when it fails, the cases are deletes, not a table.|
|`rewrite`|Passes the bar but matches a code (`TAUT`, `CALLS`, `SNAP`, `LAYER`, `FLAKY`), or is the only proof of a costly behavior and needs fixing.|
|`keep`|At least 3 bar answers are yes and no code applies, or the only proof of a costly behavior.|

Subsumed is not merged: if a test adds nothing over another one, delete it. Merge only when combining keeps coverage that each case alone provides. When only one of the cases you would merge is worth keeping, keep that one and delete the rest.

## Codes used only in reports

- `LOW_VALUE`: correct, proves real behavior, but fails the value bar, like the worked example. Always a delete.
- `VALUABLE`: passes the bar. Kept, merged or rewritten.
- `OTHER`: none of the codes fit. Avoid it.

## Confidence

How likely a senior engineer reading the same code agrees with the verdict:

- `very_high`: the code settles it; nobody would argue.
- `high`: the code settles it, with a detail a reviewer would want to check.
- `medium`: a reviewer could reasonably disagree, for example on whether a break would be costly or silent.
- `low`: a judgment call that depends on context you could not see.
- `very_low`: a guess.
