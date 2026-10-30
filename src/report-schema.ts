import { type Static, Type } from 'typebox';
import { ACTIONS, CATEGORIES, CONFIDENCE } from './types.js';

// Plain `{type: string, enum}`: unions of literals become anyOf/const, which some providers reject.
const stringEnum = <T extends readonly string[]>(values: T, description: string) =>
  Type.Unsafe<T[number]>({ type: 'string', enum: [...values], description });

// Optional fields are omitted rather than sent as null: every token of this payload is output.
const FindingParams = Type.Object({
  startLine: Type.Integer({
    minimum: 1,
    description:
      'The case start line from the work list (it already includes decorators/attributes).'
  }),
  endLine: Type.Optional(
    Type.Integer({
      minimum: 1,
      description:
        'Last line of the case, inclusive. Only needed when the work list gives no end line.'
    })
  ),
  test: Type.Optional(
    Type.String({ description: 'Only when the work list gives no name: the case name as written.' })
  ),
  // `bar` comes before `action`: models fill JSON in schema order, so the answers decide the
  // action instead of being filled in to justify it.
  bar: Type.Object(
    {
      costly: Type.Boolean({
        description:
          'A break would cost money, credits, data, security, customer sends or a contract, judged by the behavior guarded, not the assertion size.'
      }),
      silent: Type.Boolean({
        description:
          'Types, other tests and normal use would not reveal the break. Anything visible on screen is not silent.'
      }),
      likely: Type.Boolean({
        description: 'The code is non-trivial, changes often or broke before.'
      }),
      cheap: Type.Boolean({ description: 'Fast and small relative to what it protects.' })
    },
    {
      description:
        'Value bar answers, decided before the action; keep and merge need at least 3 true.'
    }
  ),
  action: stringEnum(
    ACTIONS,
    'delete | merge (combine with the other cases of its mergeGroup into fewer tests) | rewrite (keep the behavior, fix the test) | keep'
  ),
  category: stringEnum(
    CATEGORIES,
    'Never-write code, LOW_VALUE (correct but fails the bar), VALUABLE (passes the bar: keep, merge or rewrite), OTHER (avoid)'
  ),
  reason: Type.String({
    description:
      'The deciding fact about what the test does (not its title); do not restate the bar answers. One short sentence when the call is clear; explain more when it depends on what else covers the behavior or on a protected area.'
  }),
  coveredBy: Type.Optional(
    Type.String({
      description:
        'What still proves the behavior after removal (test name, file or layer). Required for DUP deletes and for deletes of costly cases, e.g. "deletes a user" subsumes "creates a user".'
    })
  ),
  mergeGroup: Type.Optional(
    Type.String({
      description:
        'Merge only: a short label shared by every case that should become one test, naming the result (e.g. "status filter table").'
    })
  ),
  confidence: stringEnum(
    CONFIDENCE,
    'How likely a senior reviewer reading the same code agrees. high when the code settles it; medium only when a reviewer could reasonably disagree.'
  )
});

/** Parameters of `submit_file_report`. Static, so every worker shares one cached prompt prefix. */
export const SubmitFileReportParams = Type.Object({
  file: Type.String({ description: 'Path of the test file, exactly as given in the work list.' }),
  summary: Type.String({ description: 'One sentence about the file as a whole.' }),
  findings: Type.Array(FindingParams, {
    description:
      'Exactly one finding per test case, in any order, including kept cases. A table-driven case is one case.'
  })
});

export type SubmitFileReport = Static<typeof SubmitFileReportParams>;
export type SubmittedFinding = SubmitFileReport['findings'][number];
