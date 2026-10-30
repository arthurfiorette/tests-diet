import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AgentSession,
  createAgentSessionFromServices,
  createAgentSessionServices,
  createMcpExtension,
  defineTool,
  type ExtensionAPI,
  getAgentDir,
  type InlineExtension,
  type McpServerConfig,
  type ModelRuntime,
  SessionManager,
  SettingsManager
} from '@earendil-works/pi-coding-agent';
import type { Config, ThinkingSetting } from './config.js';
import { hashContent } from './discover.js';
import type { Progress, WorkerProgress } from './progress.js';
import { buildGroupPrompt, buildNudgePrompt, buildResumePrompt } from './prompt.js';
import { SubmitFileReportParams } from './report-schema.js';
import { addUsage, emptyUsage, type GroupState, type Store } from './state.js';
import type { FileReport, Group, TestFile, Usage } from './types.js';
import { checkReport, verdictOf } from './validate.js';

export const SUBMIT_TOOL = 'submit_file_report';
const READ_TOOLS = ['read', 'grep', 'find', 'ls'];

export type ResolvedModel = NonNullable<AgentSession['model']>;

export interface SessionSetup {
  config: Config;
  modelRuntime: ModelRuntime;
  model: ResolvedModel;
  thinking: ThinkingSetting | undefined;
  systemPrompt: string;
  /** One value per run: OpenAI-style providers route `prompt_cache_key` to the same cache. */
  cacheKey: string;
}

export interface WorkerOptions extends SessionSetup {
  store: Store;
  promptKey: string;
  /** Accepted reports, shared across workers. */
  results: Map<string, FileReport>;
  /** Persists the run state after a group's status, session or usage changes. */
  saveState: () => void;
  /** Called once, when the first successful assistant message ends (prompt cache written). */
  onFirstResponse: () => void;
  signal: AbortSignal;
  log: (message: string) => void;
  /** Live counters for the CLI view; this worker owns `progress.workers.get(slot)`. */
  progress: Progress;
  slot: number;
}

export interface GroupOutcome {
  accepted: number;
  failed: number;
  usage: Usage;
  /** The session ended on a provider error without accepting anything. */
  providerError: string | undefined;
}

const modelName = (model: ResolvedModel) => `${model.provider}/${model.id}`;

/** A report is current when the file content and the rubric/model are unchanged. */
export function isCurrent(
  report: FileReport | undefined,
  file: TestFile,
  promptKey: string
): boolean {
  return Boolean(report && report.hash === file.hash && report.promptKey === promptKey);
}

/** Runs one pi session over one group until every file is reported, failed, or the run aborts. */
export async function runGroup(
  group: Group,
  groupState: GroupState,
  options: WorkerOptions
): Promise<GroupOutcome> {
  const { config, store, results, log } = options;
  const pending = new Map(
    group.files
      .filter((f) => !isCurrent(results.get(f.path), f, options.promptKey))
      .map((f) => [f.path, f])
  );
  const rejections = new Map<string, number>();
  const outcome: GroupOutcome = {
    accepted: 0,
    failed: 0,
    usage: emptyUsage(),
    providerError: undefined
  };
  if (!pending.size) {
    groupState.status = 'done';
    options.saveState();
    return outcome;
  }

  const { progress } = options;
  const live: WorkerProgress = {
    groupId: group.id,
    files: pending.size,
    reported: 0,
    failed: 0,
    activity: 'starting',
    usage: emptyUsage(),
    turns: 0,
    errors: 0,
    startedAt: Date.now()
  };
  progress.workers.set(options.slot, live);

  const fail = (file: TestFile, reason: string) => {
    store.appendFailure({
      path: file.path,
      hash: file.hash,
      groupId: group.id,
      reason,
      at: new Date().toISOString()
    });
    pending.delete(file.path);
    outcome.failed++;
    live.failed++;
    progress.failed++;
  };
  const nextOrStop = (lead: string) => {
    const next = pending.values().next().value as TestFile | undefined;
    if (!next)
      return {
        content: [text(`${lead} Every file of the group is done; stop now.`)],
        details: {},
        terminate: true
      };
    return {
      content: [
        text(
          `${lead} ${group.files.length - pending.size}/${group.files.length} files done; reported files are final. Next: ${next.path} (${pending.size} pending).`
        )
      ],
      details: {}
    };
  };

  let session: AgentSession | undefined;
  let idleTurns = 0;
  let usageMark = emptyUsage();
  const usageSinceMark = (): Usage => {
    const now = sessionUsage(session);
    const delta = { ...now };
    for (const key of Object.keys(delta) as Array<keyof Usage>)
      delta[key] = now[key] - usageMark[key];
    usageMark = now;
    return delta;
  };

  const submitTool = defineTool({
    name: SUBMIT_TOOL,
    label: 'Submit file report',
    description:
      'Deliver the findings for one test file of your work group. The only way to report results. Returns the errors to fix, or the next pending file.',
    parameters: SubmitFileReportParams,
    async execute(_id, params) {
      const file = group.files.find((f) => f.path === params.file);
      if (!file)
        return error(
          `"${params.file}" is not in your work group. Pending: ${[...pending.keys()].join(', ') || 'none'}.`
        );
      // Not an error: an error invites a retry. The earlier report stands; move on.
      if (!pending.has(file.path)) {
        return nextOrStop(
          `"${file.path}" was already reported and its report stands; do not read or submit it again.`
        );
      }

      const content = readFileSync(join(config.root, file.path), 'utf8');
      if (hashContent(content) !== file.hash) {
        fail(file, 'file changed during the run');
        return nextOrStop(`"${file.path}" changed on disk during the run and was skipped.`);
      }
      const { findings, errors: problems } = checkReport(params, file, content);
      if (problems.length) {
        const count = (rejections.get(file.path) ?? 0) + 1;
        rejections.set(file.path, count);
        if (count >= config.maxRejections) {
          fail(file, `report rejected ${count} times: ${problems.slice(0, 3).join(' | ')}`);
          return nextOrStop(`"${file.path}" was rejected too many times and is closed.`);
        }
        return error(
          `Report rejected (${count}/${config.maxRejections}). Fix every point and resubmit:\n- ${problems.join('\n- ')}`
        );
      }

      const usage = usageSinceMark();
      const report: FileReport = {
        path: file.path,
        hash: file.hash,
        verdict: verdictOf(findings, file),
        summary: params.summary,
        findings,
        groupId: group.id,
        model: modelName(options.model),
        promptKey: options.promptKey,
        usage,
        at: new Date().toISOString()
      };
      store.appendResult(report);
      results.set(file.path, report);
      pending.delete(file.path);
      outcome.accepted++;
      live.reported++;
      progress.reported++;
      for (const f of findings) progress.actions[f.action]++;
      idleTurns = 0;
      return nextOrStop('Accepted.');
    }
  });

  // A failed group reruns from scratch: its transcript ends in failure and would mislead the model.
  const resumable =
    groupState.status !== 'failed' && groupState.session && existsSync(groupState.session);
  let resumed = false;
  try {
    session = await openSession(
      options,
      submitTool,
      resumable ? groupState.session : undefined,
      options.store.sessionsDir
    );
    resumed = Boolean(resumable);
  } catch (err) {
    if (!resumable) throw err;
    log(`${group.id}: could not reopen its session (${(err as Error).message}); starting fresh`);
    session = await openSession(options, submitTool, undefined, options.store.sessionsDir);
  }
  const active = session;
  usageMark = sessionUsage(active);
  const baseline = usageMark;
  recordSession(groupState, active, options);

  let lastError: string | undefined;
  const abort = () => void active.abort();
  options.signal.addEventListener('abort', abort);
  live.activity = resumed ? 'resuming' : 'reading the work list';
  const unsubscribe = active.subscribe((event) => {
    if (event.type === 'agent_start' && options.signal.aborted) void active.abort();
    if (event.type === 'tool_execution_start')
      live.activity = describeActivity(event.toolName, event.args, config.root);
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const message = event.message as { stopReason?: string; errorMessage?: string };
      if (message.stopReason === 'error') lastError = message.errorMessage ?? 'provider error';
      else if (message.stopReason !== 'aborted') options.onFirstResponse();
      const now = sessionUsage(active);
      for (const key of Object.keys(live.usage) as Array<keyof Usage>)
        live.usage[key] = now[key] - baseline[key];
    }
    // Rejected reports and truncated tool calls keep a single prompt going; cap the turns.
    if (event.type === 'turn_end') {
      live.turns++;
      if (++idleTurns > config.maxIdleTurns) void active.abort();
    }
  });

  try {
    let prompt = resumed
      ? buildResumePrompt([...pending.values()])
      : buildGroupPrompt(group, [...pending.values()]);
    let idleRounds = 0;
    while (pending.size && !options.signal.aborted) {
      const before = pending.size;
      lastError = undefined;
      idleTurns = 0;
      await active.prompt(prompt);
      // An abort closes the provider connection ("WebSocket closed 1000"); that is not an error.
      if (options.signal.aborted) break;
      if (pending.size < before) idleRounds = 0;
      else idleRounds++;
      if (lastError && outcome.accepted === 0 && idleRounds >= 2) {
        outcome.providerError = lastError;
        break;
      }
      if (idleRounds > 3) break;
      // Counted, not logged: transient provider errors are common and only matter in aggregate.
      if (lastError) {
        live.errors++;
        progress.errors++;
        progress.lastError = `${group.id}: ${lastError}`;
      }
      prompt = buildNudgePrompt([...pending.values()], Boolean(lastError));
    }
  } finally {
    unsubscribe();
    options.signal.removeEventListener('abort', abort);
    const total = sessionUsage(active);
    for (const key of Object.keys(outcome.usage) as Array<keyof Usage>)
      outcome.usage[key] = total[key] - baseline[key];
    groupState.usage = addUsage(groupState.usage ?? emptyUsage(), outcome.usage);
    addUsage(progress.finishedUsage, outcome.usage);
    progress.workers.delete(options.slot);
    await closeSession(active);
  }

  if (options.signal.aborted) {
    options.saveState();
    return outcome;
  }
  if (!outcome.providerError) {
    for (const file of [...pending.values()]) fail(file, 'no valid submit_file_report');
  }
  groupState.status = pending.size || outcome.failed ? 'failed' : 'done';
  options.saveState();
  return outcome;
}

/** Builds the per-session services (a resource loader cannot be shared across sessions). */
export async function createServices(
  setup: Pick<SessionSetup, 'config' | 'modelRuntime' | 'systemPrompt' | 'cacheKey'>
) {
  const { config } = setup;
  const cwd = config.root;
  const agentDir = config.agentDir ?? getAgentDir();
  // The audited repo is untrusted by default: its .pi packages and extensions never run.
  const settingsManager = SettingsManager.create(cwd, agentDir, {
    projectTrusted: config.trustProject
  });
  // In memory only: never written back to the user's settings.
  settingsManager.applyOverrides({ transport: config.transport });
  const factories: InlineExtension[] = [
    { name: 'tests-diet-cache-key', hidden: true, factory: cacheKeyExtension(setup.cacheKey) },
    { name: 'tests-diet-context', hidden: true, factory: forgetReportedFiles }
  ];
  if (Object.keys(config.mcpServers).length) {
    factories.push(
      { name: 'tests-diet-mcp-servers', hidden: true, factory: poolMcpServers(config.mcpServers) },
      // Only the pool's servers: the user's mcp.json would start every personal server in each
      // of the 20+ sessions.
      {
        name: 'tests-diet-mcp',
        hidden: true,
        factory: createMcpExtension({
          loadConfig: () => ({ servers: [], autoEnableCodemode: false, errors: [] })
        })
      }
    );
  }
  return createAgentSessionServices({
    cwd,
    agentDir,
    settingsManager,
    modelRuntime: setup.modelRuntime,
    resourceLoaderOptions: {
      noSkills: true,
      noContextFiles: true,
      noPromptTemplates: true,
      noThemes: true,
      systemPrompt: setup.systemPrompt,
      appendSystemPrompt: [],
      additionalExtensionPaths: config.extensions,
      extensionFactories: factories
    }
  });
}

type LooseMessage = {
  role: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  content?: unknown;
};
type LooseContent = {
  type?: string;
  id?: string;
  name?: string;
  text?: string;
  arguments?: { file?: string };
};

/** Requests above this many (estimated) tokens get older tool output elided. Providers often bill
 * long prompts at a higher tier from 100k up. */
const ELIDE_ABOVE_TOKENS = 80_000;
const KEEP_RECENT_RESULTS = 4;

/**
 * Every request re-sends the whole conversation, so a session that has read 20 files pays for all
 * of them on each turn. Once a file is accepted its reads are dead weight. Each request keeps the
 * work list, a note naming the files already reported (without it the model concludes it never
 * read them and starts over), and everything after the last accepted report. Older tool output is
 * elided when the request grows too large. Requests only; the session file keeps everything.
 */
function forgetReportedFiles(pi: ExtensionAPI) {
  pi.on('context', (event) => {
    const messages = event.messages as LooseMessage[];
    const first = messages.findIndex((m) => m.role === 'user');
    if (first === -1) return undefined;

    // Files whose report was accepted (or already stood), from submit calls with a non-error result.
    const okResults = new Map<string, string>();
    for (const m of messages) {
      if (m.role === 'toolResult' && m.toolName === SUBMIT_TOOL && !m.isError && m.toolCallId) {
        okResults.set(m.toolCallId, textOf(m.content));
      }
    }
    const reported: string[] = [];
    let lastCall = -1;
    messages.forEach((m, i) => {
      if (m.role !== 'assistant' || !Array.isArray(m.content)) return;
      for (const c of m.content as LooseContent[]) {
        if (c.type === 'toolCall' && c.name === SUBMIT_TOOL && c.id && okResults.has(c.id)) {
          if (c.arguments?.file && !reported.includes(c.arguments.file))
            reported.push(c.arguments.file);
          lastCall = i;
        }
      }
    });

    let kept = messages;
    if (lastCall > first) {
      // Cut after the result(s) of the last accepted call; keep that assistant turn only when it
      // also made other calls, whose results would otherwise be orphaned.
      const callsInTurn = ((messages[lastCall]?.content as LooseContent[]) ?? []).filter(
        (c) => c.type === 'toolCall'
      );
      const resultsEnd = messages.findIndex((m, i) => i > lastCall && m.role !== 'toolResult');
      const tail =
        callsInTurn.length > 1
          ? messages.slice(lastCall)
          : messages.slice(resultsEnd === -1 ? messages.length : resultsEnd);
      const lastOk = [...okResults.values()].at(-1) ?? '';
      const next = lastOk.match(/Next: (\S+)/)?.[1];
      const note = {
        ...(messages[first] as object),
        content: [
          {
            type: 'text',
            text: `Already reported (transcripts removed on purpose to save tokens; do not read or submit these again): ${reported.join(', ')}.${next ? ` Continue with ${next}.` : ''}`
          }
        ]
      } as LooseMessage;
      kept = [messages[first] as LooseMessage, note, ...tail];
    }
    kept = elideOldToolOutput(kept);
    return kept === messages ? undefined : { messages: kept as typeof event.messages };
  });
}

function elideOldToolOutput(messages: LooseMessage[]): LooseMessage[] {
  const estimate = Math.ceil(JSON.stringify(messages).length / 4);
  if (estimate <= ELIDE_ABOVE_TOKENS) return messages;
  const results = messages
    .map((m, i) => (m.role === 'toolResult' && m.toolName !== SUBMIT_TOOL ? i : -1))
    .filter((i) => i >= 0);
  const elide = new Set(results.slice(0, Math.max(0, results.length - KEEP_RECENT_RESULTS)));
  return messages.map((m, i) =>
    elide.has(i)
      ? {
          ...m,
          content: [
            {
              type: 'text',
              text: '[output elided to keep the request small; read again only if you still need it]'
            }
          ]
        }
      : m
  );
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as LooseContent[]).map((c) => c.text ?? '').join('');
}

/** Tools every agent may call: read-only built-ins, the configured extras and the report tool. */
export function allowedTools(config: Config): string[] {
  return [...READ_TOOLS, ...config.tools, SUBMIT_TOOL];
}

// Pool servers default to `direct` exposure so allowed tools are declared to the model like
// built-ins, which keeps the declarations identical across sessions (cacheable).
function poolMcpServers(servers: Config['mcpServers']) {
  return (pi: ExtensionAPI) => {
    for (const [name, server] of Object.entries(servers)) {
      pi.registerMcpServer(name, { exposure: 'direct', ...server } as McpServerConfig);
    }
  };
}

// pi sets `prompt_cache_key` to the session id for OpenAI-style APIs; one key per run lets all
// workers hit the same cache. Anthropic-style caching needs nothing: the prefix is identical.
function cacheKeyExtension(key: string) {
  return (pi: ExtensionAPI) => {
    pi.on('before_provider_request', (event) => {
      const payload = event.payload as Record<string, unknown> | null;
      if (payload && typeof payload === 'object' && 'prompt_cache_key' in payload)
        return { ...payload, prompt_cache_key: key };
      return undefined;
    });
  };
}

async function openSession(
  options: WorkerOptions,
  submitTool: ReturnType<typeof defineTool>,
  sessionFile: string | undefined,
  sessionsDir: string
): Promise<AgentSession> {
  const services = await createServices(options);
  const sessionManager = sessionFile
    ? SessionManager.open(sessionFile)
    : SessionManager.create(options.config.root, sessionsDir);
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager,
    model: options.model,
    ...(options.thinking ? { thinkingLevel: options.thinking } : {}),
    tools: allowedTools(options.config),
    customTools: [submitTool]
  });
  try {
    await session.bindExtensions({ mode: 'print', onError: () => {} });
    if (
      session.model?.id !== options.model.id ||
      session.model?.provider !== options.model.provider
    ) {
      await session.setModel(options.model);
    }
  } catch (err) {
    session.dispose();
    throw err;
  }
  return session;
}

async function closeSession(session: AgentSession) {
  try {
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
  } catch {
    // Extensions failing to shut down must not fail the group.
  }
  session.dispose();
}

function recordSession(groupState: GroupState, session: AgentSession, options: WorkerOptions) {
  const file = session.sessionManager.getSessionFile();
  if (file && groupState.session !== file) {
    groupState.session = file;
    options.saveState();
  }
}

function sessionUsage(session: AgentSession | undefined): Usage {
  if (!session) return emptyUsage();
  const stats = session.getSessionStats();
  return {
    input: stats.tokens.input,
    output: stats.tokens.output,
    cacheRead: stats.tokens.cacheRead,
    cacheWrite: stats.tokens.cacheWrite,
    cost: stats.cost
  };
}

const text = (value: string) => ({ type: 'text' as const, text: value });

function describeActivity(tool: string, args: unknown, root: string): string {
  const a = (args ?? {}) as Record<string, unknown>;
  const target = String(
    a.file ?? a.path ?? a.pattern ?? a.name_path ?? a.relative_path ?? a.query ?? ''
  );
  const relative = target.startsWith(`${root}/`)
    ? target.slice(root.length + 1)
    : target === root
      ? '.'
      : target;
  return `${tool === SUBMIT_TOOL ? 'submit' : tool} ${relative}`.trim();
}

function error(message: string) {
  return { content: [text(message)], details: {}, isError: true };
}
