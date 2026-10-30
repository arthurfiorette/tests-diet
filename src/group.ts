import { createHash } from 'node:crypto';
import type { Group, TestFile } from './types.js';

export interface GroupOptions {
  /** Target tokens per group. */
  budget: number;
  /** Groups under this are merged into a neighbor when the result still fits. */
  minGroup: number;
  /** Allowed overshoot over `budget` (0.1 = 10%). */
  tolerance: number;
}

interface DirNode {
  files: TestFile[];
  dirs: Map<string, DirNode>;
  total: number;
}

interface Item {
  key: string;
  /** Child of the current folder the item came from; parts that mix origins cost more. */
  origin: string;
  files: TestFile[];
  tokens: number;
}

/**
 * Packs test files into agent-sized groups without ever splitting a file. Files stay with their
 * folder: a folder that fits `budget * (1 + tolerance)` is one group; a larger one is cut into the
 * fewest balanced parts (31k at a 16k budget gives ~16k + ~15k, never 16k + a tiny tail),
 * preferring cuts between subfolders; groups under `minGroup` merge into a neighbor when the result
 * fits (tiny ones may stretch to `budget * (1 + 2 * tolerance)`, since every group pays the fixed
 * system prompt).
 */
export function groupFiles(input: TestFile[], options: GroupOptions, firstIndex = 1): Group[] {
  const files = [...input].sort((a, b) => cmp(a.path, b.path));
  const max = options.budget * (1 + options.tolerance);
  return pack(buildTree(files), '', options, max).map((g, i) => toGroup(g, firstIndex + i));
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const size = (file: TestFile) => Math.max(1, file.tokens);
const sum = (files: TestFile[]) => files.reduce((n, f) => n + size(f), 0);

function buildTree(files: TestFile[]): DirNode {
  const root: DirNode = { files: [], dirs: new Map(), total: 0 };
  for (const file of files) {
    const parts = file.path.split('/');
    parts.pop();
    let node = root;
    node.total += size(file);
    for (const part of parts) {
      let child = node.dirs.get(part);
      if (!child) {
        child = { files: [], dirs: new Map(), total: 0 };
        node.dirs.set(part, child);
      }
      child.total += size(file);
      node = child;
    }
    node.files.push(file);
  }
  return root;
}

function allFiles(node: DirNode): TestFile[] {
  return [...node.files, ...[...node.dirs.values()].flatMap(allFiles)].sort((a, b) =>
    cmp(a.path, b.path)
  );
}

function pack(node: DirNode, prefix: string, options: GroupOptions, max: number): TestFile[][] {
  if (node.total === 0) return [];
  if (node.total <= max) return [allFiles(node)];

  const items: Item[] = node.files.map((file) => ({
    key: file.path,
    origin: file.path,
    files: [file],
    tokens: size(file)
  }));
  for (const [name, child] of node.dirs) {
    const key = `${prefix}${name}/`;
    if (child.total <= max) {
      items.push({ key, origin: key, files: allFiles(child), tokens: child.total });
      continue;
    }
    for (const part of pack(child, key, options, max)) {
      items.push({ key: part[0]?.path ?? key, origin: key, files: part, tokens: sum(part) });
    }
  }
  items.sort((a, b) => cmp(a.key, b.key));
  return mergeSmall(partition(items, options.budget, max), options, max);
}

/**
 * Contiguous split of path-ordered items into k parts, k = the fewest parts that respect the
 * budget, minimizing squared deviation from total/k plus a penalty for parts that mix subfolders.
 * Items over `max` (a split subfolder part or a huge file) always stand alone.
 */
function partition(items: Item[], budget: number, max: number): TestFile[][] {
  const n = items.length;
  const prefix = [0];
  for (const item of items) prefix.push((prefix.at(-1) ?? 0) + item.tokens);
  const total = prefix[n] ?? 0;
  const tokens = (from: number, to: number) => (prefix[to] ?? 0) - (prefix[from] ?? 0);
  // Items of one origin are contiguous (keys share its path prefix), so distinct origins in a
  // range = origin changes inside it + 1.
  const changes = [0];
  for (let i = 1; i < n; i++)
    changes.push((changes.at(-1) ?? 0) + (items[i]?.origin !== items[i - 1]?.origin ? 1 : 0));
  const origins = (from: number, to: number) => (changes[to - 1] ?? 0) - (changes[from] ?? 0) + 1;

  const minParts = Math.max(1, Math.ceil(total / budget));
  for (let k = minParts; k <= n; k++) {
    const target = total / k;
    const mixPenalty = (0.15 * budget) ** 2;
    // best[j][p] = min cost to split items[0..j) into p parts.
    const best: number[][] = Array.from({ length: n + 1 }, () =>
      new Array<number>(k + 1).fill(Number.POSITIVE_INFINITY)
    );
    const cut: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(k + 1).fill(-1));
    (best[0] as number[])[0] = 0;
    for (let j = 1; j <= n; j++) {
      for (let p = 1; p <= Math.min(k, j); p++) {
        for (let i = j - 1; i >= p - 1; i--) {
          const t = tokens(i, j);
          if (t > max && j - i > 1) break;
          const prev = best[i]?.[p - 1] ?? Number.POSITIVE_INFINITY;
          if (prev === Number.POSITIVE_INFINITY) continue;
          const cost = prev + (t - target) ** 2 + (origins(i, j) - 1) * mixPenalty;
          if (cost < (best[j]?.[p] ?? Number.POSITIVE_INFINITY)) {
            (best[j] as number[])[p] = cost;
            (cut[j] as number[])[p] = i;
          }
        }
      }
    }
    if ((best[n]?.[k] ?? Number.POSITIVE_INFINITY) === Number.POSITIVE_INFINITY) continue;
    const parts: TestFile[][] = [];
    for (let j = n, p = k; p > 0; p--) {
      const i = cut[j]?.[p] ?? 0;
      parts.unshift(items.slice(i, j).flatMap((item) => item.files));
      j = i;
    }
    return parts;
  }
  return items.map((item) => item.files);
}

function mergeSmall(groups: TestFile[][], options: GroupOptions, max: number): TestFile[][] {
  const stretch = options.budget * (1 + 2 * options.tolerance);
  for (let i = 0; i < groups.length && groups.length > 1; i++) {
    const group = groups[i] as TestFile[];
    const own = sum(group);
    if (own >= options.minGroup) continue;
    const limit = own < options.minGroup / 2 ? stretch : max;
    const prev = groups[i - 1];
    const next = groups[i + 1];
    const prevFits = prev && sum(prev) + own <= limit;
    const nextFits = next && sum(next) + own <= limit;
    if (prevFits && (!nextFits || sum(prev) <= sum(next as TestFile[]))) {
      prev.push(...group);
      groups.splice(i--, 1);
    } else if (nextFits) {
      next.unshift(...group);
      groups.splice(i--, 1);
    }
  }
  return groups;
}

export function groupId(index: number, files: Array<{ path: string }>): string {
  const digest = createHash('sha1')
    .update(files.map((f) => f.path).join('\n'))
    .digest('hex')
    .slice(0, 8);
  return `g${String(index).padStart(4, '0')}-${digest}`;
}

function toGroup(files: TestFile[], index: number): Group {
  return { id: groupId(index, files), files, tokens: sum(files) };
}
