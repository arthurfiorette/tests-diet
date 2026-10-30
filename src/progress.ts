import { addUsage, emptyUsage } from './state.js';
import type { Action, Usage } from './types.js';

export interface WorkerProgress {
  groupId: string;
  files: number;
  reported: number;
  failed: number;
  /** Last thing the agent did, e.g. `read src/foo.test.ts`. */
  activity: string;
  /** Usage of the group's session so far. */
  usage: Usage;
  /** Model turns in this run of the session. */
  turns: number;
  /** Provider errors (retried) in this session. */
  errors: number;
  startedAt: number;
}

/** Live counters of a run, mutated by the workers and read by the CLI view. */
export class Progress {
  readonly startedAt = Date.now();
  groupsTotal = 0;
  groupsDone = 0;
  /** Test files of the whole plan; `reported` includes files reported by earlier runs. */
  filesTotal = 0;
  reported = 0;
  /** `reported` when this run started, so the ETA only uses this run's pace. */
  reportedAtStart = 0;
  /** Output tokens of earlier runs, so throughput only counts this run. */
  outputAtStart = 0;
  failed = 0;
  errors = 0;
  lastError = '';
  readonly actions: Record<Action, number> = { delete: 0, merge: 0, rewrite: 0, keep: 0 };
  /** Usage of finished groups; active groups are in `workers`. */
  readonly finishedUsage = emptyUsage();
  readonly workers = new Map<number, WorkerProgress>();
  model = '';
  stopping = false;

  usage(): Usage {
    const total = { ...this.finishedUsage };
    for (const worker of this.workers.values()) addUsage(total, worker.usage);
    return total;
  }
}

const duration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m${String(s % 60).padStart(2, '0')}s`;
};
const compact = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(n);

/** The status panel shown while `run` works (and by `status --watch`). */
export function renderProgress(p: Progress, width: number): string[] {
  const elapsed = Date.now() - p.startedAt;
  const done = p.reported + p.failed;
  const thisRun = p.reported - p.reportedAtStart;
  const rate = (done - p.reportedAtStart) / Math.max(1, elapsed);
  const eta =
    rate > 0 && p.filesTotal > done ? ` · ETA ${duration((p.filesTotal - done) / rate)}` : '';
  const u = p.usage();
  const hit = u.input + u.cacheRead ? Math.round((u.cacheRead / (u.input + u.cacheRead)) * 100) : 0;
  const outRate = (u.output - p.outputAtStart) / Math.max(1, elapsed / 1000);
  const filesPerMin = (thisRun / Math.max(1, elapsed)) * 60_000;
  const lines = [
    `${p.stopping ? 'stopping…' : 'tests-diet'} · ${p.model} · ${duration(elapsed)}${eta}`,
    `groups ${p.groupsDone}/${p.groupsTotal} · files ${p.reported}/${p.filesTotal} reported (${thisRun} this run, ${filesPerMin.toFixed(1)}/min), ${p.failed} failed`,
    `findings: delete ${p.actions.delete} · merge ${p.actions.merge} · rewrite ${p.actions.rewrite} · keep ${p.actions.keep}`,
    `tokens ${compact(u.input)} in · ${compact(u.cacheRead)} cached (${hit}%) · ${compact(u.output)} out (${compact(Math.round(outRate))}/s) · $${u.cost.toFixed(2)}`,
    p.errors ? `provider errors ${p.errors} (retried) · last: ${p.lastError}` : ''
  ].filter(Boolean);
  const workers = [...p.workers.entries()].sort((a, b) => a[0] - b[0]);
  if (workers.length) {
    lines.push('', ...sessionTable(workers));
  }
  return lines.map((line) =>
    line.length > width ? `${line.slice(0, Math.max(1, width - 1))}…` : line
  );
}

// Fixed-width columns (right-aligned numbers) so rows do not shift as values grow.
const COLUMNS = [
  { title: '#', width: 3, right: true },
  { title: 'group', width: 14, right: false },
  { title: 'files', width: 7, right: true },
  { title: 'turns', width: 5, right: true },
  { title: 'tokens', width: 7, right: true },
  { title: 'out/s', width: 6, right: true },
  { title: 'err', width: 3, right: true },
  { title: 'cost', width: 7, right: true },
  { title: 'time', width: 7, right: true },
  { title: 'doing', width: 0, right: false }
] as const;

function sessionTable(workers: Array<[number, WorkerProgress]>): string[] {
  const row = (cells: string[]) =>
    cells
      .map((cell, i) => {
        const column = COLUMNS[i];
        if (!column?.width) return cell;
        const fitted = cell.length > column.width ? cell.slice(0, column.width) : cell;
        return column.right ? fitted.padStart(column.width) : fitted.padEnd(column.width);
      })
      .join('  ');
  const now = Date.now();
  return [
    row(COLUMNS.map((c) => c.title)),
    ...workers.map(([slot, w]) =>
      row([
        String(slot + 1),
        w.groupId.slice(0, 14),
        `${w.reported + w.failed}/${w.files}`,
        String(w.turns),
        compact(w.usage.input + w.usage.cacheRead + w.usage.output),
        compact(Math.round(w.usage.output / Math.max(1, (now - w.startedAt) / 1000))),
        String(w.errors),
        `$${w.usage.cost.toFixed(2)}`,
        duration(now - w.startedAt),
        w.activity
      ])
    )
  ];
}

/**
 * Redraws the panel in place on a TTY; log lines are printed above it. On anything else it does
 * nothing but forward logs, so CI output stays line-based.
 */
export class LiveView {
  private drawn = 0;
  private timer: NodeJS.Timeout | undefined;
  private readonly stream: NodeJS.WriteStream;
  private readonly progress: Progress;

  constructor(progress: Progress, stream: NodeJS.WriteStream = process.stderr) {
    this.progress = progress;
    this.stream = stream;
  }

  get interactive(): boolean {
    return Boolean(this.stream.isTTY);
  }

  start(): void {
    if (!this.interactive) return;
    this.draw();
    this.timer = setInterval(() => this.draw(), 500);
    this.timer.unref();
  }

  log(message: string): void {
    this.clear();
    this.stream.write(`${message}\n`);
    if (this.timer) this.draw();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.interactive) this.draw();
    this.drawn = 0;
  }

  private clear(): void {
    if (this.drawn) this.stream.write(`\x1b[${this.drawn}A\x1b[0J`);
    this.drawn = 0;
  }

  private draw(): void {
    const lines = renderProgress(this.progress, this.stream.columns || 120);
    this.clear();
    this.stream.write(`${lines.join('\n')}\n`);
    this.drawn = lines.length;
  }
}
