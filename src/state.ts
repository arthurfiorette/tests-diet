import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { type GroupOptions, groupFiles } from './group.js';
import type { FileReport, Group, TestFile, Usage } from './types.js';

export type GroupStatus = 'pending' | 'done' | 'failed';

export interface GroupState {
  id: string;
  files: Array<{ path: string; hash: string }>;
  tokens: number;
  status: GroupStatus;
  /** pi session file of the last run of this group, reopened on resume. */
  session?: string;
  /** Model usage of every run of this group. */
  usage?: Usage;
}

export interface RunState {
  version: 1;
  createdAt: string;
  updatedAt: string;
  /** Discovery and grouping settings the plan was built with; a mismatch needs `--replan`. */
  settings: string;
  groups: GroupState[];
}

export interface FailureRecord {
  path: string;
  hash: string;
  groupId: string;
  reason: string;
  at: string;
}

export const emptyUsage = (): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0
});

export function addUsage(into: Usage, from: Usage): Usage {
  into.input += from.input;
  into.output += from.output;
  into.cacheRead += from.cacheRead;
  into.cacheWrite += from.cacheWrite;
  into.cost += from.cost;
  return into;
}

/**
 * Everything a run needs to resume lives in `dir`:
 * - `state.json`: the plan, each group's status, usage and pi session file (atomic rewrites)
 * - `results.jsonl`: one accepted file report per line (append-only; latest per path wins)
 * - `failures.jsonl`: files an agent could not report
 * - `sessions/`: pi session files, so an interrupted group continues with its context
 */
export class Store {
  readonly dir: string;
  readonly sessionsDir: string;
  private readonly statePath: string;
  private readonly resultsPath: string;
  private readonly failuresPath: string;
  private readonly lockPath: string;

  constructor(dir: string) {
    this.dir = dir;
    this.sessionsDir = join(dir, 'sessions');
    this.statePath = join(dir, 'state.json');
    this.resultsPath = join(dir, 'results.jsonl');
    this.failuresPath = join(dir, 'failures.jsonl');
    this.lockPath = join(dir, 'run.lock');
  }

  exists(): boolean {
    return existsSync(this.statePath);
  }

  /** Creates the directory. Its .gitignore keeps sessions (which contain file contents) out of git. */
  init(): void {
    mkdirSync(this.sessionsDir, { recursive: true });
    const gitignore = join(this.dir, '.gitignore');
    if (!existsSync(gitignore)) writeFileSync(gitignore, '*\n');
  }

  readState(): RunState | undefined {
    if (!this.exists()) return undefined;
    return JSON.parse(readFileSync(this.statePath, 'utf8')) as RunState;
  }

  writeState(state: RunState): void {
    state.updatedAt = new Date().toISOString();
    const tmp = `${this.statePath}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(tmp, this.statePath);
  }

  /** Copies `state.json` to `state.<timestamp>.json`; returns the copy's path. */
  backupState(): string {
    const copy = join(this.dir, `state.${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    copyFileSync(this.statePath, copy);
    return copy;
  }

  /** Latest accepted report per path. */
  readResults(): Map<string, FileReport> {
    return readJsonl<FileReport>(this.resultsPath).reduce(
      (map, report) => map.set(report.path, report),
      new Map<string, FileReport>()
    );
  }

  appendResult(report: FileReport): void {
    appendFileSync(this.resultsPath, `${JSON.stringify(report)}\n`);
  }

  readFailures(): FailureRecord[] {
    return readJsonl<FailureRecord>(this.failuresPath);
  }

  appendFailure(failure: FailureRecord): void {
    appendFileSync(this.failuresPath, `${JSON.stringify(failure)}\n`);
  }

  /** Exclusive run lock; returns a release function. A stale lock from a dead process is taken over. */
  lock(): () => void {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = openSync(this.lockPath, 'wx');
        writeFileSync(fd, String(process.pid));
        closeSync(fd);
        return () => rmSync(this.lockPath, { force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const pid = Number(readFileSync(this.lockPath, 'utf8'));
        if (pid && isAlive(pid))
          throw new Error(`Another tests-diet run (pid ${pid}) is using ${this.dir}`);
        rmSync(this.lockPath, { force: true });
      }
    }
    throw new Error(`Could not lock ${this.dir}`);
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const out: T[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // A line cut short by a crash mid-append; the file is reported again on the next run.
    }
  }
  return out;
}

/**
 * Reconciles a stored plan with the files on disk. Deleted files leave their group; changed files
 * stay but drop the group's session (its context describes old content); new files join the
 * pending group sharing the longest directory prefix when they fit, and the rest get new groups
 * numbered after the existing ones.
 */
export function reconcile(state: RunState, files: TestFile[], options: GroupOptions): RunState {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const planned = new Set<string>();
  for (const group of state.groups) {
    const kept = group.files.filter((f) => byPath.has(f.path));
    const changed =
      kept.length !== group.files.length || kept.some((f) => byPath.get(f.path)?.hash !== f.hash);
    group.files = kept.map((f) => ({ path: f.path, hash: byPath.get(f.path)?.hash ?? f.hash }));
    group.tokens = kept.reduce((n, f) => n + (byPath.get(f.path)?.tokens ?? 0), 0);
    if (changed) {
      delete group.session;
      group.status = 'pending';
    }
    for (const f of kept) planned.add(f.path);
  }
  state.groups = state.groups.filter((group) => group.files.length);

  const max = options.budget * (1 + options.tolerance);
  const leftovers: TestFile[] = [];
  for (const file of files) {
    if (planned.has(file.path)) continue;
    const home = state.groups
      .filter((g) => g.status !== 'done' && g.tokens + file.tokens <= max)
      .map((g) => ({
        g,
        shared: Math.max(...g.files.map((f) => sharedDirDepth(f.path, file.path)))
      }))
      .filter(({ shared }) => shared > 0)
      .sort((a, b) => b.shared - a.shared)[0]?.g;
    if (!home) {
      leftovers.push(file);
      continue;
    }
    home.files.push({ path: file.path, hash: file.hash });
    home.tokens += file.tokens;
    delete home.session;
    home.status = 'pending';
  }
  if (leftovers.length) {
    const next = Math.max(0, ...state.groups.map((g) => Number(g.id.slice(1, 5)) || 0)) + 1;
    state.groups.push(...groupFiles(leftovers, options, next).map(toGroupState));
  }
  return state;
}

function sharedDirDepth(a: string, b: string): number {
  const pa = a.split('/').slice(0, -1);
  const pb = b.split('/').slice(0, -1);
  let i = 0;
  while (i < pa.length && pa[i] === pb[i]) i++;
  return i;
}

export function newState(groups: Group[], settings: string): RunState {
  const now = new Date().toISOString();
  return { version: 1, createdAt: now, updatedAt: now, settings, groups: groups.map(toGroupState) };
}

export function toGroupState(group: Group): GroupState {
  return {
    id: group.id,
    files: group.files.map((f) => ({ path: f.path, hash: f.hash })),
    tokens: group.tokens,
    status: 'pending'
  };
}
