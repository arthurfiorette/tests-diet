import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  getAgentDir,
  ModelRuntime,
  resolveCliModel,
  SettingsManager
} from '@earendil-works/pi-coding-agent';
import { type Config, effectiveLanguages } from './config.js';
import { discoverTestFiles } from './discover.js';
import { groupFiles } from './group.js';
import { Progress } from './progress.js';
import { buildSystemPrompt, promptKey } from './prompt.js';
import { addUsage, emptyUsage, newState, type RunState, reconcile, Store } from './state.js';
import type { FileReport, Group, TestFile, Usage } from './types.js';
import { createServices, isCurrent, type ResolvedModel, runGroup } from './worker.js';

export interface Plan {
  files: TestFile[];
  groups: Group[];
  state: RunState;
  store: Store;
}

/** Discovery and grouping inputs; a stored plan built with other settings needs `--replan`. */
export function planSettings(config: Config): string {
  const inputs = {
    budget: config.budget,
    minGroup: config.minGroup,
    tolerance: config.tolerance,
    include: config.include,
    exclude: config.exclude,
    languages: effectiveLanguages(config)
  };
  return createHash('sha256').update(JSON.stringify(inputs)).digest('hex').slice(0, 16);
}

/**
 * Discovers files and returns the stored plan (reconciled with disk) or a fresh one. Only `plan`
 * and `run` persist it; `status` and `report` pass `write: false` and need an existing plan.
 */
export function preparePlan(config: Config, options: { replan?: boolean; write: boolean }): Plan {
  const store = new Store(resolve(config.root, config.outDir));
  if (!options.write && !store.exists()) {
    throw new Error(
      `No run state in ${store.dir}; run \`tests-diet plan\` or \`tests-diet run\` first.`
    );
  }
  const files = discoverTestFiles(config);
  const settings = planSettings(config);
  const stored = options.replan ? undefined : store.readState();
  if (stored && stored.settings !== settings && options.write) {
    throw new Error(
      'The stored plan was built with other discovery or grouping settings. Pass --replan to regroup.'
    );
  }
  const state = stored
    ? reconcile(stored, files, config)
    : newState(groupFiles(files, config), settings);
  const byPath = new Map(files.map((f) => [f.path, f]));
  const groups: Group[] = state.groups.map((g) => {
    const members = g.files.map((f) => byPath.get(f.path)).filter((f): f is TestFile => Boolean(f));
    return { id: g.id, files: members, tokens: members.reduce((n, f) => n + f.tokens, 0) };
  });
  if (options.write) {
    store.init();
    store.writeState(state);
  }
  return { files, groups, state, store };
}

export interface RunOptions {
  /** Only the first N runnable groups (calibration runs). */
  limit?: number;
  /** Only groups with at least one file under one of these path prefixes. */
  only?: string[];
  /** Ignore stored reports and classify everything selected again. */
  fresh?: boolean;
  signal?: AbortSignal;
  log?: (message: string) => void;
  /** Live counters, for a status view while the run works. */
  progress?: Progress;
}

export interface RunSummary {
  groups: number;
  accepted: number;
  failed: number;
  usage: Usage;
  aborted: boolean;
}

/** Consecutive groups ending on a provider error, with nothing accepted, before the run stops. */
const CIRCUIT_BREAKER = 3;

/**
 * Runs the pool. The model is resolved once, before any worker starts. The first group starts
 * alone; the rest wait for its first successful response, so the shared system prompt is already
 * in the provider cache when the other workers start.
 */
export async function run(
  config: Config,
  plan: Plan,
  options: RunOptions = {}
): Promise<RunSummary> {
  const log = options.log ?? ((message: string) => process.stderr.write(`${message}\n`));
  const { store, state } = plan;
  const release = store.lock();
  const controller = new AbortController();
  const forward = () => controller.abort();
  options.signal?.addEventListener('abort', forward);
  if (options.signal?.aborted) controller.abort();

  try {
    let instructions: string | undefined;
    if (config.instructions) {
      if (!existsSync(config.instructions))
        throw new Error(`Instructions file not found: ${config.instructions}`);
      instructions = readFileSync(config.instructions, 'utf8');
    }
    const systemPrompt = buildSystemPrompt(instructions);
    const agentDir = config.agentDir ?? getAgentDir();
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, 'auth.json'),
      modelsPath: join(agentDir, 'models.json')
    });
    const cacheKey = `tests-diet-${randomUUID()}`;
    // Loading the services once registers providers from the user's pi packages before resolving.
    await createServices({ config, modelRuntime, systemPrompt, cacheKey });
    const { model, thinking } = resolveModel(config, modelRuntime);
    const key = promptKey(systemPrompt, `${model.provider}/${model.id}`);

    const results: Map<string, FileReport> = options.fresh ? new Map() : store.readResults();
    const stateById = new Map(state.groups.map((g) => [g.id, g]));
    for (const group of plan.groups) {
      const groupState = stateById.get(group.id);
      if (groupState && group.files.every((f) => isCurrent(results.get(f.path), f, key)))
        groupState.status = 'done';
    }
    store.writeState(state);

    let queue = plan.groups.filter((g) => stateById.get(g.id)?.status !== 'done');
    if (options.only?.length) {
      const prefixes = options.only.map((p) => p.replace(/^\.\//, ''));
      queue = queue.filter((g) => g.files.some((f) => prefixes.some((p) => f.path.startsWith(p))));
    }
    if (options.limit !== undefined) queue = queue.slice(0, options.limit);
    if (!queue.length) log('Nothing to classify: every selected group is up to date.');
    const workers = Math.max(1, Math.min(config.concurrency, queue.length));
    log(
      `Model ${model.provider}/${model.id}${thinking ? `:${thinking}` : ''}, ${queue.length} groups, ${workers} workers`
    );

    const summary: RunSummary = {
      groups: queue.length,
      accepted: 0,
      failed: 0,
      usage: emptyUsage(),
      aborted: false
    };
    const progress = options.progress ?? new Progress();
    progress.model = `${model.provider}/${model.id}${thinking ? `:${thinking}` : ''}`;
    // Counters cover the whole plan, seeded with what earlier runs already reported, so a resumed
    // run does not start from zero.
    progress.groupsTotal = state.groups.length;
    progress.groupsDone = state.groups.filter((g) => g.status === 'done').length;
    progress.filesTotal = plan.files.length;
    for (const file of plan.files) {
      const report = results.get(file.path);
      if (!report || !isCurrent(report, file, key)) continue;
      progress.reported++;
      for (const f of report.findings) progress.actions[f.action]++;
    }
    progress.reportedAtStart = progress.reported;
    for (const g of state.groups) if (g.usage) addUsage(progress.finishedUsage, g.usage);
    progress.outputAtStart = progress.finishedUsage.output;
    controller.signal.addEventListener('abort', () => {
      progress.stopping = true;
    });
    const total = queue.length;
    let finished = 0;
    let errorStreak = 0;
    let fatal: Error | undefined;
    let warm: () => void = () => {};
    const warmed = new Promise<void>((done) => {
      warm = done;
    });
    controller.signal.addEventListener('abort', () => warm());

    const work = async (slot: number) => {
      const first = slot === 0;
      if (!first) await warmed;
      for (let group = queue.shift(); group && !controller.signal.aborted; group = queue.shift()) {
        const groupState = stateById.get(group.id);
        if (!groupState) continue;
        try {
          const outcome = await runGroup(group, groupState, {
            config,
            modelRuntime,
            model,
            thinking,
            systemPrompt,
            cacheKey,
            store,
            promptKey: key,
            results,
            saveState: () => store.writeState(state),
            onFirstResponse: warm,
            signal: controller.signal,
            log,
            progress,
            slot
          });
          summary.accepted += outcome.accepted;
          summary.failed += outcome.failed;
          addUsage(summary.usage, outcome.usage);
          if (controller.signal.aborted) break;
          finished++;
          progress.groupsDone++;
          errorStreak = outcome.providerError ? errorStreak + 1 : 0;
          log(
            `[${finished}/${total}] ${group.id} ${group.files.length} files: ${outcome.accepted} reported, ${outcome.failed} failed, $${outcome.usage.cost.toFixed(4)} | total $${summary.usage.cost.toFixed(2)}`
          );
          if (outcome.providerError) {
            log(`${group.id}: provider error: ${outcome.providerError}`);
            if (errorStreak >= CIRCUIT_BREAKER || (first && finished === 1)) {
              fatal = new Error(
                `Stopping: the model keeps failing (${outcome.providerError}). Progress is saved.`
              );
              controller.abort();
            }
          }
        } catch (err) {
          fatal = err as Error;
          controller.abort();
        } finally {
          warm();
        }
      }
    };

    await Promise.all(Array.from({ length: workers }, (_, i) => work(i)));
    store.writeState(state);
    if (fatal) throw fatal;
    summary.aborted = controller.signal.aborted;
    return summary;
  } finally {
    options.signal?.removeEventListener('abort', forward);
    release();
  }
}

function resolveModel(
  config: Config,
  modelRuntime: ModelRuntime
): { model: ResolvedModel; thinking: Config['thinking'] } {
  let pattern = config.model;
  if (!pattern) {
    const settings = SettingsManager.create(config.root, config.agentDir ?? getAgentDir(), {
      projectTrusted: config.trustProject
    });
    const provider = settings.getDefaultProvider();
    const id = settings.getDefaultModel();
    if (!provider || !id)
      throw new Error('No --model given and no default model in your pi settings.');
    pattern = `${provider}/${id}`;
  }
  const resolved = resolveCliModel({
    cliModel: pattern,
    ...(config.thinking ? { cliThinking: config.thinking } : {}),
    modelRuntime
  });
  if (!resolved.model) {
    throw new Error(
      `Model "${pattern}" not found in your pi configuration (check \`pi --list-models\`).${resolved.error ? ` ${resolved.error}` : ''}`
    );
  }
  if (resolved.warning) process.stderr.write(`${resolved.warning}\n`);
  return {
    model: resolved.model,
    thinking: (resolved.thinkingLevel ?? config.thinking) as Config['thinking']
  };
}
