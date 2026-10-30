import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { groupFiles } from '../src/group.js';
import type { TestFile } from '../src/types.js';

const file = (path: string, tokens: number): TestFile => ({
  path,
  tokens,
  language: 'javascript',
  inline: false,
  hash: path,
  cases: []
});
const options = { budget: 50_000, minGroup: 15_000, tolerance: 0.1 };
const max = options.budget * (1 + options.tolerance);
const stretch = options.budget * (1 + 2 * options.tolerance);

// Seeded so failures reproduce.
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

describe('groupFiles', () => {
  test('every file lands in exactly one group, and only oversized single files exceed the cap', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = random(seed);
      const files = Array.from({ length: 5 + Math.floor(rand() * 120) }, (_, i) => {
        const dir = ['a', 'a/b', 'a/b/c', 'd', 'd/e', 'f'][Math.floor(rand() * 6)];
        return file(
          `${dir}/t${i}.test.ts`,
          200 + Math.floor(rand() * (rand() < 0.05 ? 90_000 : 12_000))
        );
      });
      const groups = groupFiles(files, options);
      const seen = groups.flatMap((g) => g.files.map((f) => f.path)).sort();
      assert.deepEqual(seen, files.map((f) => f.path).sort(), `seed ${seed}`);
      for (const g of groups) {
        if (g.files.length > 1) assert.ok(g.tokens <= stretch, `seed ${seed}: ${g.tokens}`);
      }
      assert.equal(new Set(groups.map((g) => g.id)).size, groups.length);
    }
  });

  test('balances a split folder instead of leaving a tiny tail', () => {
    const files = [30_000, 25_000, 30_000, 25_000, 1_000].map((t, i) =>
      file(`pkg/t${i}.test.ts`, t)
    );
    const sizes = groupFiles(files, options).map((g) => g.tokens);
    assert.ok(Math.min(...sizes) >= options.minGroup, sizes.join(','));
    assert.ok(Math.max(...sizes) <= max, sizes.join(','));
  });

  test('31k at a 16k budget becomes two halves, not 16k plus a tail', () => {
    const files = Array.from({ length: 31 }, (_, i) =>
      file(`pkg/t${String(i).padStart(2, '0')}.test.ts`, 1_000)
    );
    const sizes = groupFiles(files, { budget: 16_000, minGroup: 5_000, tolerance: 0.1 }).map(
      (g) => g.tokens
    );
    assert.deepEqual(sizes.sort(), [15_000, 16_000].sort());
  });

  test('ids and membership do not depend on input order', () => {
    const files = Array.from({ length: 40 }, (_, i) =>
      file(`p${i % 3}/t${i}.test.ts`, 3_000 + i * 50)
    );
    const a = groupFiles(files, options).map((g) => [g.id, g.files.map((f) => f.path)]);
    const b = groupFiles([...files].reverse(), options).map((g) => [
      g.id,
      g.files.map((f) => f.path)
    ]);
    assert.deepEqual(a, b);
  });
});
