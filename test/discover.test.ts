import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_LANGUAGES } from '../src/config.js';
import { detectCases } from '../src/discover.js';

const language = (name: string) => {
  const preset = DEFAULT_LANGUAGES.find((l) => l.name === name);
  assert.ok(preset, name);
  return preset;
};
const lines = (source: string, name: string) =>
  detectCases(source, language(name)).map((c) => c.line);

describe('detectCases', () => {
  test('javascript: plain, modifiers, multi-line tables, node:test; not hooks, suites or comments', () => {
    const source = [
      "describe('suite', () => {", // 1
      '  beforeEach(() => {});', // 2
      "  it('plain', () => {});", // 3
      '  it.each([', // 4
      '    [1, 2],', // 5
      "  ])('table %s', () => {});", // 6
      "  test.skip('skipped', () => {});", // 7
      '  /* it("commented", () => {}) */', // 8
      "  test.describe('nested', () => {});", // 9
      "  await test('node', async () => {});", // 10
      "  test.skip(isCI, 'reason');", // 11
      "  it.skipIf(win)('conditional', () => {});", // 12
      '});'
    ].join('\n');
    assert.deepEqual(lines(source, 'javascript'), [3, 4, 7, 10, 12]);
  });

  test('python: a case starts at its first decorator, multi-line decorators included', () => {
    const source = [
      'import pytest', // 1
      '', // 2
      '@pytest.mark.parametrize(', // 3
      '    "a,b",', // 4
      '    [(1, 2)],', // 5
      ')', // 6
      'def test_sum(a, b):', // 7
      '    assert a < b', // 8
      'def test_plain():', // 9
      '    assert True' // 10
    ].join('\n');
    assert.deepEqual(lines(source, 'python'), [3, 9]);
  });

  test('rust: attributes above #[test] belong to the case; stacked attributes count once', () => {
    const source = [
      '#[cfg(test)]', // 1
      'mod tests {', // 2
      '    #[ignore]', // 3
      '    #[test]', // 4
      '    fn a() {}', // 5
      '', // 6
      '    #[tokio::test]', // 7
      '    #[should_panic]', // 8
      '    async fn b() {}', // 9
      '', // 10
      '    #[test_case(1)]', // 11
      '    fn c(x: u8) {}', // 12
      '}'
    ].join('\n');
    const cases = detectCases(source, language('rust'));
    assert.deepEqual(
      cases.map((c) => c.line),
      [3, 7, 11]
    );
    assert.deepEqual(
      cases.map((c) => c.name),
      ['a', 'b', 'c']
    );
    assert.deepEqual(
      cases.map((c) => c.endLine),
      [5, 9, 12]
    );
  });

  test('end lines: braces skip strings, template literals and comments; python ends on dedent', () => {
    const js = [
      "it('a', () => {", // 1
      "  const s = '}';", // 2
      '  const t = `', // 3
      '    { x } }', // 4
      '  `; // })', // 5
      '  // a `quoted` comment', // 6
      '});', // 7
      '  it.each([', // 8
      '    [1, 2],', // 9
      "  ])('table %s', () => {});", // 10
      "it('one line', () => {});" // 11
    ].join('\n');
    assert.deepEqual(
      detectCases(js, language('javascript')).map((c) => [c.line, c.endLine]),
      [
        [1, 7],
        [8, 10],
        [11, 11]
      ]
    );

    const py = [
      'class TestX:', // 1
      '    def test_a(', // 2
      '        self,', // 3
      '    ):', // 4
      '        assert 1', // 5
      '', // 6
      '        assert 2', // 7
      '    def test_b(self):', // 8
      '        assert 3', // 9
      '', // 10
      'def helper(): pass' // 11
    ].join('\n');
    assert.deepEqual(
      detectCases(py, language('python')).map((c) => [c.line, c.endLine]),
      [
        [2, 7],
        [8, 9]
      ]
    );
  });
});
