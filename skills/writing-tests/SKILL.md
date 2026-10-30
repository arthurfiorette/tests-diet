---
name: writing-tests
description: Read BEFORE writing, adding, changing or reviewing any test (unit, integration, component, e2e), including tests added while implementing a feature or fixing a bug. Decides if it should exist, its layer and shape.
---

# Writing tests

Default = no new test. Every test costs CI time on every run, agent tokens on every change, and friction on every refactor, forever. It earns that cost only by catching a regression that matters and that nothing else would catch. A correct, well-written test can still be a net loss.

Existing tests are not a style reference. Suites written by coding agents tend to test every change and copy the shape of neighbor files; copying a nearby test is how low-value patterns spread. Judge a test by its assertions and the code it runs, never by its title.

## Value bar

First ask what a failure would mean: a mistake, or a decision. A test whose expected values are copied from the code (the class list, the SQL text, the mapping table, the order of calls) can only fail when someone changes that code on purpose, and the fix is always the same edit in the test. It catches no mistake, whatever it asserts. A test whose expected values come from the requirement (the price for this cart, the tenant that must not see this row) fails when the code gets the rule wrong.

Then, a test may exist only if at least 3 of these 4 hold:

|#|Question|Yes when|
|-|-|-|
|1|Costly if broken?|Money, credits, billing, payment or subscription state, tenant/owner isolation, auth/permissions, data loss or integrity, messages sent to customers, external contracts (webhooks, public API, persisted enums, file formats), migrations, security sanitizing. Judge the behavior the test guards, not the size of its assertion: a status, default or guard in billing, credits or customer sends is costly even when the test is three lines.|
|2|Silent if broken?|Types, other tests that already run through this code, and normal use would NOT reveal the break quickly. Anything a user or developer sees on screen while using the feature (layout, styles, labels, a click that does nothing, a wrong date or color) is NOT silent.|
|3|Likely to break?|Non-trivial logic (branches, concurrency, time zones, parsing, state machines), code that changes often, or a past bug.|
|4|Cheap for what it protects?|Fast, small setup, no app boot or login per case, few lines relative to the code it guards.|

Worked example: a 70-line test of a "today in the business time zone" helper. It is correct, well commented and covers a real ICU edge case. It still fails: a wrong date on a display screen is visible and cheap to fix (1 = no), and another test already runs through the helper (2 = no). 2 of 4, so the test should not exist.

Same for UI: a test that clicking a radio's label selects it, or that a preview keeps its CSS, fails even when no other test covers it. Normal use shows the break at once (2 = no) and it costs nothing (1 = no).

Exception: the only proof of a costly behavior (tenant isolation, auth, money, data integrity) stays even below 3, rewritten if needed, including skipped or quarantined ones. Being in costly code is not enough: another test must not already prove it.

Before writing one:

- Search first: sibling tests, other files that exercise the same function, the other layer (unit, integration, e2e). Prefer, in order: an assertion in an existing flow, a row in an existing table-driven test, a case in an existing file, a new file.
- Bug fix: add a regression only if it fails before the fix and no existing test could have caught it. One test at the owning layer, never one per crossed layer.
- Never add a production seam for a test: an export, a `forTest` hook, a threshold option, a mutable field, an "if running under tests" branch.
- Never weaken, skip or delete an existing test to make your change pass. A failing test means the code is wrong, unless the requirement changed; then say so and change the test on purpose.

## Codes

Never write these patterns, whatever the bar says.

|Code|Pattern|
|-|-|
|`TYPE`|What the type system already guarantees: "is a function", "is defined" as the last assertion, "has property X" on a typed object, schema has a key, ref forwarding.|
|`CONST`|A constant, config, enum, CSS class, translation key, prompt phrase or label map equal to (or containing) its own literal. A "guards removal" comment does not make it valid.|
|`TAUT`|Passes by construction: asserts the value a mock was set to return, recomputes the expected value with the implementation's own rule, copies production regex/SQL into the test, "same input gives same output" on a pure function.|
|`CALLS`|Only asserts which internal functions were called, how often or in what order; mocks the codebase's own modules to supply the asserted value; asserts log lines.|
|`NOOP`|The title promises behavior the body never exercises: render-only, "not called" with no interaction, `>= 0` counts, assertions inside a loop that may not run, early return when data is missing.|
|`TRIVIAL`|One-liner, getter, `a && b`, thin wrapper, prop echo, "very long text renders".|
|`LIB`|Tests a library or framework (UI toolkit keyboard handling, form library validation, schema library on a trivial schema, ORM behavior) through a thin wrapper.|
|`SOURCE`|Reads source files or the repo layout ("file exists", regex over code). Use a linter rule, or check a real generated artifact instead.|
|`SNAP`|A whole-output snapshot, or exact generated SQL/IR text that breaks on harmless rewrites.|
|`DUP`|The same path is proven elsewhere: sibling test, another file, another layer, or N near-identical cases that should be one table.|
|`LAYER`|Wrong layer: a heavily mocked unit test of database or route behavior, or a slow end-to-end test of pure logic or static text.|
|`FLAKY`|Fixed sleeps (including "sleep, then assert nothing happened"), real clock, unseeded randomness, shared mutable state, order dependence. Never add retries to hide it.|
|`DEAD`|Skipped, todo with a body, disabled by a hardcoded flag, or gated on an environment variable that is off by default.|

## Patterns agents copy, do not copy

|Pattern|Do instead|
|-|-|
|CRUD echo: create, then assert every field equals the input, the id is defined, the timestamp is a date, plus a "minimal / all fields / long title / special characters" grid.|Test only the rules (validation, scoping, derived fields). Plain persistence is proven by any read.|
|A set of cases per new column or option: "saves / null clears / omitted keeps".|One table over columns, or nothing for passthrough columns.|
|"Wrong owner / not found / deleted" repeated for every method.|One isolation table per service.|
|One file or test per operator, field, provider, channel or file type.|One table-driven test with a shared fixture.|
|A "creates X" test next to a "deletes X" test that already creates X.|Keep the flow, drop the step.|
|UI component suites with Sizes / Variants / Ref forwarding / Combinations / Edge cases blocks.|Test only logic the component owns. Presentational wrappers get no test.|
|A component test with ten mocks that asserts the mocks were called.|Extract the logic and unit-test it, or cover the flow once end to end.|
|A hand-built fake database or query builder.|The real test database.|
|End-to-end "create X, see success toast"; a "cancel keeps" twin of every "confirm deletes".|Read the result back after a reload or through another view.|
|End-to-end tests re-proving math a unit test owns.|A unit table for the rule, at most one end-to-end test for the wiring.|
|The same helper copied across apps, each copy with its own test.|Share the code, keep one test.|

## Layer

|Behavior|Test through|
|-|-|
|Pure rule: money, dates, parsing, state machine|Unit, table-driven, fixed clock|
|Service, query, tenant scope, events|Real services on a real test database|
|Route schema, auth, HTTP serialization|A route-level harness, one app boot per file|
|Component logic the user sees|Component test asserting the rendered result|
|Critical journey across UI and services|One end-to-end test that asserts persisted state, not toasts|

Never prove one behavior at two layers unless the second adds transport, serialization or lifecycle risk the first cannot reach.

## Shape

- Assert outcomes: return value, error, database row, HTTP response, event payload, user-visible text. Assert calls only on external boundaries (HTTP, payment provider, queue, email) with arguments the code computed.
- Pair negative assertions with a positive anchor.
- Prove absence by awaiting the producer or bounded polling, never by sleeping.
- Prefer invariants and round trips over magic literals: sums match totals, `parse(serialize(x))` equals `x`.
- Iterate the source of truth instead of retyping lists.
- Fixed clock, seeded randomness, fresh tenant per test.
- Coverage percentage is never a reason to add a test.

## Before done

- For each added or changed test, state which 3+ bar questions it satisfies. Drop any you cannot justify.
- New regression: show it fails with the fix reverted, then passes.
- Report test lines versus production lines added; more test lines than production lines needs a reason.

Examples of each code in several languages: [references/examples.md](references/examples.md). Auditing existing tests: [references/auditing.md](references/auditing.md).
