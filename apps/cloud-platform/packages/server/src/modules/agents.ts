import Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  userCanAccessProject,
} from "../../../../../task-bridge/apps/backend/dist/services/project-registry.js";
import { replyLanguageInstruction, runProjectAgentPrompt, type AgentRunFn } from "../agent-prompt.js";
import { loadAppSettings, openSettingsDb } from "../app-settings.js";
import { languageLabel } from "../note-language.js";
import { AGENT_TIMEOUT_MS } from "../agent-runtime.js";
import {
  EVENT_AGENT_RAN,
  EVENT_CLOCK_TICK,
  EVENT_NOTE_PAGE_CREATED,
  agentEventType,
  type LotaruEvent,
} from "../events.js";
import { isKnownEventType } from "../event-registry.js";
import { describeSubscribers, listEventSubscribers } from "../event-subscribers.js";
import { slugifyName } from "../slug.js";
import { cachedSqlite } from "../sqlite-cache.js";
import { createProjectTask } from "../intent-task.js";
import { agentTaskFromOutput } from "../agent-action.js";
import { appendNotePageByBookTitle } from "./notes.js";
import { listVoiceSegments, openVoiceDb } from "./voice.js";
import type { Identity } from "./identity.js";

export type AgentTrigger = "event" | "schedule";

/** What the platform does with the agent's reply once the run finishes. */
export type AgentAction = "none" | "note" | "task" | "event";

export type LotaruAgent = {
  id: string;
  projectId: string;
  title: string;
  /** Minted once at creation; the event id others subscribe to never moves under them. */
  slug: string;
  prompt: string;
  trigger: AgentTrigger;
  eventType: string;
  scheduleHour: number;
  scheduleMinute: number;
  includeVoice: boolean;
  action: AgentAction;
  noteBookTitle: string;
  enabled: boolean;
  createdAt: string;
  createdBy: string;
};

export type AgentRun = {
  id: string;
  agentId: string;
  projectId: string;
  status: "running" | "done" | "error";
  output: string;
  error: string;
  startedAt: string;
  finishedAt: string;
};

type Viewer = { email: string; sub: string };

type ModuleOptions = {
  databasePath: string;
  identity: Identity;
  projectAccess?: (projectId: string, userId: string) => boolean;
  projectCwd?: (projectId: string) => string;
  runAgent?: AgentRunFn;
  emitEvent?: (partial: {
    type: string;
    projectId: string;
    scriptId: string;
    path: string;
    detail: string;
    /** Agents this event already passed through, so a cycle cannot re-enter one. */
    agentChain?: readonly string[];
  }) => LotaruEvent;
};

const triggerSchema = z.enum(["event", "schedule"]);
const actionSchema = z.enum(["none", "note", "task", "event"]);

const createAgentSchema = z.object({
  projectId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(20_000),
  trigger: triggerSchema,
  eventType: z.string().trim().optional(),
  scheduleHour: z.number().int().min(0).max(23).optional(),
  scheduleMinute: z.number().int().min(0).max(59).optional(),
  includeVoice: z.boolean().optional(),
  action: actionSchema.optional(),
  noteBookTitle: z.string().trim().max(200).optional(),
  enabled: z.boolean().optional(),
});

const patchAgentSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  prompt: z.string().trim().min(1).max(20_000).optional(),
  trigger: triggerSchema.optional(),
  eventType: z.string().trim().optional(),
  scheduleHour: z.number().int().min(0).max(23).optional(),
  scheduleMinute: z.number().int().min(0).max(59).optional(),
  includeVoice: z.boolean().optional(),
  action: actionSchema.optional(),
  noteBookTitle: z.string().trim().max(200).optional(),
  enabled: z.boolean().optional(),
});

const agentRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  title: z.string(),
  slug: z.string(),
  prompt: z.string(),
  trigger_kind: z.string(),
  event_type: z.string(),
  schedule_hour: z.number(),
  schedule_minute: z.number(),
  include_voice: z.number(),
  action: z.string(),
  note_book_title: z.string(),
  enabled: z.number(),
  created_at: z.string(),
  created_by: z.string(),
});

function canSeeProject(options: ModuleOptions, projectId: string, userId: string): boolean {
  if (options.projectAccess !== undefined) {
    return options.projectAccess(projectId, userId);
  }
  return userCanAccessProject(projectId, userId);
}

function requireKnownEventType(eventType: string): void {
  if (isKnownEventType(eventType) !== true) {
    throw new Error("Unknown event type");
  }
}

export function openAgentsDb(databasePath: string): Database.Database {
  return cachedSqlite("agents", databasePath, (db) => {
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS lotaru_agents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      slug TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL,
      trigger_kind TEXT NOT NULL,
      event_type TEXT NOT NULL DEFAULT '',
      schedule_hour INTEGER NOT NULL DEFAULT 21,
      schedule_minute INTEGER NOT NULL DEFAULT 0,
      include_voice INTEGER NOT NULL DEFAULT 0,
      action TEXT NOT NULL DEFAULT 'none',
      note_book_title TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lotaru_agents_project ON lotaru_agents(project_id);
    CREATE TABLE IF NOT EXISTS lotaru_agent_runs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      output TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (agent_id) REFERENCES lotaru_agents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_lotaru_agent_runs_agent ON lotaru_agent_runs(agent_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS lotaru_agent_claims (
      claim_key TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      claimed_at TEXT NOT NULL
    );
  `);
  migrateAgentAction(db);
  migrateAgentSlug(db);
  recoverStaleAgentRuns(db);
  });
}

/**
 * Older rows encoded "write a note" as a non-empty book title; make that
 * explicit so the action can grow past notes.
 */
function migrateAgentAction(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(lotaru_agents)").all() as { name: string }[];
  let hasAction = false;
  for (const column of columns) {
    if (column.name === "action") {
      hasAction = true;
    }
  }
  if (hasAction) {
    return;
  }
  db.exec("ALTER TABLE lotaru_agents ADD COLUMN action TEXT NOT NULL DEFAULT 'none'");
  db.exec("UPDATE lotaru_agents SET action = 'note' WHERE TRIM(note_book_title) <> ''");
}

/**
 * Agents predate the slug, and an agent without one cannot mint an event. Every
 * row gets one from its title so the column can carry a unique index, the same
 * shape rules have always had.
 */
function migrateAgentSlug(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(lotaru_agents)").all() as { name: string }[];
  let hasSlug = false;
  for (const column of columns) {
    if (column.name === "slug") {
      hasSlug = true;
    }
  }
  if (hasSlug !== true) {
    db.exec("ALTER TABLE lotaru_agents ADD COLUMN slug TEXT NOT NULL DEFAULT ''");
  }
  const rows = db
    .prepare("SELECT id, project_id, title FROM lotaru_agents WHERE TRIM(slug) = '' ORDER BY created_at ASC")
    .all() as { id: string; project_id: string; title: string }[];
  const update = db.prepare("UPDATE lotaru_agents SET slug = ? WHERE id = ?");
  for (const row of rows) {
    update.run(uniqueAgentSlug(db, row.project_id, row.title, row.id), row.id);
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_lotaru_agents_slug ON lotaru_agents(project_id, slug)");
}

function slugTaken(
  db: Database.Database,
  projectId: string,
  slug: string,
  exceptId: string,
): boolean {
  const row = db
    .prepare("SELECT id FROM lotaru_agents WHERE project_id = ? AND slug = ? AND id <> ?")
    .get(projectId, slug, exceptId) as { id: string } | undefined;
  return row !== undefined;
}

/**
 * Turns a title into a project-unique slug. A title with nothing to slugify
 * still has to produce an event id, so it falls back to the row's own id.
 */
export function uniqueAgentSlug(
  db: Database.Database,
  projectId: string,
  requested: string,
  exceptId: string,
): string {
  let base = slugifyName(requested);
  if (base.length === 0) {
    base = `agent-${exceptId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase()}`;
  }
  if (slugTaken(db, projectId, base, exceptId) !== true) {
    return base;
  }
  let counter = 2;
  while (counter < 100) {
    const candidate = `${base}-${String(counter)}`;
    if (slugTaken(db, projectId, candidate, exceptId) !== true) {
      return candidate;
    }
    counter += 1;
  }
  throw new Error("Could not derive a unique agent event id");
}

/** The event this agent publishes when its action is "event". */
export function agentOutputEventType(agent: Pick<LotaruAgent, "slug">): string {
  return agentEventType(agent.slug);
}

export function withAgentEventType(agent: LotaruAgent): LotaruAgent & { outputEventType: string } {
  return Object.assign({}, agent, { outputEventType: agentOutputEventType(agent) });
}

function parseAgentAction(value: string): AgentAction {
  const parsed = actionSchema.safeParse(value);
  if (parsed.success === true) {
    return parsed.data;
  }
  return "none";
}

function recoverStaleAgentRuns(db: Database.Database): void {
  const staleMs = AGENT_TIMEOUT_MS + 60_000;
  const cutoff = new Date(Date.now() - staleMs).toISOString();
  const finishedAt = new Date().toISOString();
  db.prepare(
    "UPDATE lotaru_agent_runs SET status = 'error', error = ?, finished_at = ? WHERE status = 'running' AND started_at < ?",
  ).run("Run interrupted or timed out", finishedAt, cutoff);
}

/**
 * A run record keeps the whole reply, and an agent that publishes an event can
 * wake the next agent down the chain — so one event now writes several of these.
 * History is worth keeping; keeping all of it forever is not.
 */
export const AGENT_RUN_KEEP = 100;

/**
 * The reply itself is never truncated on its way to a note, a task, or the bus;
 * only the copy kept on the run record is, and far past any real reply.
 */
export const AGENT_RUN_OUTPUT_MAX = 20_000;

export function clampRunOutput(output: string): string {
  if (output.length <= AGENT_RUN_OUTPUT_MAX) {
    return output;
  }
  return `${output.slice(0, AGENT_RUN_OUTPUT_MAX)}\n\n[truncated]`;
}

/** Keeps the newest AGENT_RUN_KEEP runs for one agent and drops the rest. */
export function pruneAgentRuns(
  db: Database.Database,
  agentId: string,
  keep: number = AGENT_RUN_KEEP,
): number {
  const result = db
    .prepare(
      `DELETE FROM lotaru_agent_runs
        WHERE agent_id = @agentId
          AND id NOT IN (
            SELECT id FROM lotaru_agent_runs
             WHERE agent_id = @agentId
             ORDER BY started_at DESC, id DESC
             LIMIT @keep
          )`,
    )
    .run({ agentId, keep });
  return result.changes;
}

function pruneOldAgentClaims(db: Database.Database): void {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("DELETE FROM lotaru_agent_claims WHERE claimed_at < ?").run(cutoff);
}

function agentExecutionBusy(agentId: string): boolean {
  return runningAgentIds.has(agentId);
}

function agentHasDbRunningRun(db: Database.Database, agentId: string): boolean {
  const row = db
    .prepare("SELECT id FROM lotaru_agent_runs WHERE agent_id = ? AND status = 'running' LIMIT 1")
    .get(agentId);
  return row !== undefined;
}

function agentRunActive(db: Database.Database, agentId: string): boolean {
  if (agentExecutionBusy(agentId)) {
    return true;
  }
  return agentHasDbRunningRun(db, agentId);
}

export { recoverStaleAgentRuns };

function agentFromRow(row: z.infer<typeof agentRowSchema>): LotaruAgent | null {
  const triggerParsed = triggerSchema.safeParse(row.trigger_kind);
  if (triggerParsed.success !== true) {
    return null;
  }
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    slug: row.slug,
    prompt: row.prompt,
    trigger: triggerParsed.data,
    eventType: row.event_type,
    scheduleHour: row.schedule_hour,
    scheduleMinute: row.schedule_minute,
    includeVoice: row.include_voice === 1,
    action: parseAgentAction(row.action),
    noteBookTitle: row.note_book_title,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export function listAgents(db: Database.Database, projectId: string): LotaruAgent[] {
  const rows = db
    .prepare("SELECT * FROM lotaru_agents WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId);
  const agents: LotaruAgent[] = [];
  for (const entry of rows) {
    const parsed = agentRowSchema.safeParse(entry);
    if (parsed.success !== true) {
      continue;
    }
    const agent = agentFromRow(parsed.data);
    if (agent !== null) {
      agents.push(agent);
    }
  }
  return agents;
}

function getAgent(db: Database.Database, id: string): LotaruAgent | null {
  const row = db.prepare("SELECT * FROM lotaru_agents WHERE id = ?").get(id);
  const parsed = agentRowSchema.safeParse(row);
  if (parsed.success !== true) {
    return null;
  }
  return agentFromRow(parsed.data);
}

function claimKey(agentId: string, dayKey: string): string {
  return `${agentId}:${dayKey}`;
}

function dayKeyLocal(now: Date): string {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function tryClaim(db: Database.Database, key: string, agentId: string): boolean {
  try {
    db.prepare(
      "INSERT INTO lotaru_agent_claims (claim_key, agent_id, claimed_at) VALUES (?, ?, ?)",
    ).run(key, agentId, new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}

function voiceContext(databasePath: string, projectId: string): string {
  const segments = listVoiceSegments(openVoiceDb(databasePath), projectId, 80);
  if (segments.length === 0) {
    return "No recent voice transcript segments.";
  }
  const lines: string[] = ["Recent voice transcripts (newest first):"];
  for (const segment of segments) {
    const when = new Date(segment.createdAt).toISOString();
    lines.push(`- [${when}] ${segment.text}`);
  }
  return lines.join("\n");
}

/** Falls back to the agent title so a note action always has somewhere to land. */
function noteBookFor(agent: LotaruAgent): string {
  const title = agent.noteBookTitle.trim();
  if (title.length > 0) {
    return title;
  }
  return agent.title.trim();
}

function buildPrompt(
  agent: LotaruAgent,
  eventType: string,
  path: string,
  detail: string,
  voice: string,
  targetLanguageLabel: string,
): string {
  const parts = [
    agent.prompt,
    "",
    `Responder title: ${agent.title}`,
    `Trigger event: ${eventType}`,
  ];
  if (path.length > 0) {
    parts.push(`Event path: ${path}`);
  }
  if (detail.length > 0) {
    parts.push(`Event detail: ${detail}`);
  }
  if (agent.includeVoice) {
    parts.push("", voice);
  }
  if (agent.action === "note") {
    parts.push(
      "",
      `Write a clear journal-style note body. The platform saves your full reply as a page in the note book titled "${noteBookFor(agent)}".`,
      "Return only the note body text, no surrounding commentary.",
    );
  } else if (agent.action === "task") {
    parts.push(
      "",
      "Write the task this event calls for. Put a short imperative title on the first line, then the details below it.",
      "The platform files your reply as a task, so return only the task text.",
    );
  } else if (agent.action === "event") {
    parts.push(
      "",
      `The platform publishes your reply on the bus as ${agentOutputEventType(agent)}, and whatever subscribes to that event reads it as the payload.`,
      "Return only the payload text, no surrounding commentary.",
    );
  } else {
    let mcpUrl = "http://127.0.0.1:18766/mcp";
    const fromEnv = process.env.LOTARU_MCP_URL;
    if (fromEnv !== undefined && fromEnv.trim().length > 0) {
      mcpUrl = fromEnv.trim();
    }
    parts.push(
      "",
      `Lotaru MCP is available without authentication at ${mcpUrl}.`,
      "Use MCP tools for voice segments, note books, events, scripts, and responders when the prompt needs platform data.",
    );
  }
  parts.push("", replyLanguageInstruction(targetLanguageLabel));
  return parts.join("\n");
}

type FireOptions = {
  databasePath: string;
  projectCwd?: (projectId: string) => string;
  runAgent?: AgentRunFn;
  emitEvent?: ModuleOptions["emitEvent"];
};

async function runAgentText(input: {
  options: FireOptions;
  prompt: string;
  projectId: string;
}): Promise<string> {
  return runProjectAgentPrompt({
    databasePath: input.options.databasePath,
    projectId: input.projectId,
    prompt: input.prompt,
    projectCwd: input.options.projectCwd,
    runAgent: input.options.runAgent,
  });
}

const runningAgentIds = new Set<string>();

/**
 * The payload an agent publishes is what a subscriber reads, so it has to be
 * worth reading — and small enough that the events log stays a log.
 */
export const AGENT_EVENT_DETAIL_MAX = 4000;

/**
 * An agent that writes to the bus can wake another agent, which is the point.
 * The chain is the list of agents an event already passed through, so a cycle
 * stops the first time it comes back around instead of running forever.
 */
export function nextChain(chain: readonly string[], agentId: string): string[] {
  const next: string[] = [];
  for (const entry of chain) {
    next.push(entry);
  }
  next.push(agentId);
  return next;
}

export function chainContains(chain: readonly string[], agentId: string): boolean {
  for (const entry of chain) {
    if (entry === agentId) {
      return true;
    }
  }
  return false;
}

type AgentFire = {
  options: FireOptions;
  agent: LotaruAgent;
  eventType: string;
  path: string;
  detail: string;
  eventId: string;
  chain: readonly string[];
};

/**
 * An agent runs one prompt at a time, so events that land mid-run wait their
 * turn instead of vanishing — whether two asks are really the same thing is the
 * agent's call to make, and it cannot make it on an event it never sees.
 */
const agentQueues = new Map<string, AgentFire[]>();

export const AGENT_QUEUE_MAX = 20;

function queueAgentFire(fire: AgentFire): void {
  const existing = agentQueues.get(fire.agent.id);
  if (existing === undefined) {
    agentQueues.set(fire.agent.id, [fire]);
    return;
  }
  if (existing.length >= AGENT_QUEUE_MAX) {
    return;
  }
  existing.push(fire);
}

function drainAgentQueue(agentId: string): void {
  const queued = agentQueues.get(agentId);
  if (queued === undefined) {
    return;
  }
  const next = queued.shift();
  if (queued.length === 0) {
    agentQueues.delete(agentId);
  }
  if (next === undefined) {
    return;
  }
  void executeAgent(next);
}

export function pendingAgentFires(agentId: string): number {
  const queued = agentQueues.get(agentId);
  if (queued === undefined) {
    return 0;
  }
  return queued.length;
}

/**
 * Hands the finished reply to whatever the agent is configured to produce.
 * A failure here is recorded on the run instead of thrown: the prompt already
 * succeeded, and dropping its output would be worse than a noisy run record.
 */
function applyAgentAction(input: {
  options: FireOptions;
  agent: LotaruAgent;
  text: string;
  eventType: string;
  path: string;
  detail: string;
  chain: readonly string[];
}): string {
  const body = input.text.trim();
  if (body.length === 0) {
    return "";
  }
  if (input.agent.action === "note") {
    const bookTitle = noteBookFor(input.agent);
    if (bookTitle.length === 0) {
      return "No note book set";
    }
    let pageBody = body;
    if (pageBody.length > 200_000) {
      pageBody = pageBody.slice(0, 200_000);
    }
    const page = appendNotePageByBookTitle({
      databasePath: input.options.databasePath,
      projectId: input.agent.projectId,
      bookTitle,
      pageTitle: dayKeyLocal(new Date()),
      body: pageBody,
      createdBy: input.agent.createdBy,
      emitBusEvent: false,
    });
    if (input.options.emitEvent !== undefined) {
      input.options.emitEvent({
        type: EVENT_NOTE_PAGE_CREATED,
        projectId: input.agent.projectId,
        scriptId: "",
        path: page.bookId,
        detail: `${page.pageId}:${page.pageTitle}`.slice(0, 500),
        agentChain: nextChain(input.chain, input.agent.id),
      });
    }
    return "";
  }
  if (input.agent.action === "task") {
    const draft = agentTaskFromOutput({
      output: body,
      fallbackTitle: input.agent.title,
      eventType: input.eventType,
      eventPath: input.path,
      eventDetail: input.detail,
    });
    createProjectTask({
      projectId: input.agent.projectId,
      title: draft.title,
      description: draft.description,
      createdBy: input.agent.createdBy,
    });
    return "";
  }
  if (input.agent.action === "event") {
    if (input.agent.slug.length === 0) {
      return "No event id";
    }
    if (input.options.emitEvent === undefined) {
      return "No event publisher";
    }
    input.options.emitEvent({
      type: agentOutputEventType(input.agent),
      projectId: input.agent.projectId,
      scriptId: "",
      path: input.agent.id,
      detail: body.slice(0, AGENT_EVENT_DETAIL_MAX),
      agentChain: nextChain(input.chain, input.agent.id),
    });
    return "";
  }
  return "";
}

async function executeAgent(input: {
  options: FireOptions;
  agent: LotaruAgent;
  eventType: string;
  path: string;
  detail: string;
  eventId: string;
  chain: readonly string[];
}): Promise<void> {
  if (runningAgentIds.has(input.agent.id)) {
    queueAgentFire(input);
    return;
  }
  const db = openAgentsDb(input.options.databasePath);
  if (agentHasDbRunningRun(db, input.agent.id)) {
    queueAgentFire(input);
    return;
  }
  runningAgentIds.add(input.agent.id);
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  db.prepare(
    "INSERT INTO lotaru_agent_runs (id, agent_id, project_id, status, output, error, started_at, finished_at) VALUES (?, ?, ?, ?, '', '', ?, '')",
  ).run(runId, input.agent.id, input.agent.projectId, "running", startedAt);
  pruneAgentRuns(db, input.agent.id);
  try {
    let voice = "";
    if (input.agent.includeVoice) {
      voice = voiceContext(input.options.databasePath, input.agent.projectId);
    }
    const settings = loadAppSettings(openSettingsDb(input.options.databasePath));
    const prompt = buildPrompt(
      input.agent,
      input.eventType,
      input.path,
      input.detail,
      voice,
      languageLabel(settings.targetLanguage),
    );
    const text = await runAgentText({
      options: input.options,
      prompt,
      projectId: input.agent.projectId,
    });
    const finishedAt = new Date().toISOString();
    db.prepare(
      "UPDATE lotaru_agent_runs SET status = ?, output = ?, finished_at = ? WHERE id = ?",
    ).run("done", clampRunOutput(text), finishedAt, runId);
    if (input.options.emitEvent !== undefined) {
      input.options.emitEvent({
        type: EVENT_AGENT_RAN,
        projectId: input.agent.projectId,
        scriptId: "",
        path: input.agent.id,
        detail: runId,
        agentChain: nextChain(input.chain, input.agent.id),
      });
    }
    let actionFailure = "";
    try {
      actionFailure = applyAgentAction({
        options: input.options,
        agent: input.agent,
        text,
        eventType: input.eventType,
        path: input.path,
        detail: input.detail,
        chain: input.chain,
      });
    } catch (actionErr: unknown) {
      actionFailure = "Agent action failed";
      if (actionErr instanceof Error && actionErr.message.length > 0) {
        actionFailure = actionErr.message;
      }
    }
    if (actionFailure.length > 0) {
      db.prepare("UPDATE lotaru_agent_runs SET output = ?, error = ? WHERE id = ?").run(
        clampRunOutput(`${text}\n\n[${actionFailure}]`),
        actionFailure,
        runId,
      );
    }
  } catch (err: unknown) {
    let message = "agent failed";
    if (err instanceof Error && err.message.length > 0) {
      message = err.message;
    }
    db.prepare(
      "UPDATE lotaru_agent_runs SET status = ?, error = ?, finished_at = ? WHERE id = ?",
    ).run("error", message, new Date().toISOString(), runId);
  } finally {
    runningAgentIds.delete(input.agent.id);
    drainAgentQueue(input.agent.id);
  }
}

export async function fireAgentsForEvent(input: {
  databasePath: string;
  projectId: string;
  eventId: string;
  eventType: string;
  path: string;
  detail: string;
  projectCwd?: (projectId: string) => string;
  runAgent?: AgentRunFn;
  emitEvent?: ModuleOptions["emitEvent"];
  /** Agents this event already ran through; each one sits it out the second time. */
  agentChain?: readonly string[];
}): Promise<void> {
  if (input.eventType === EVENT_AGENT_RAN) {
    return;
  }
  let chain: readonly string[] = [];
  if (input.agentChain !== undefined) {
    chain = input.agentChain;
  }
  if (input.eventType === EVENT_CLOCK_TICK) {
    await fireDueScheduledAgents({
      databasePath: input.databasePath,
      projectId: input.projectId,
      now: new Date(),
      projectCwd: input.projectCwd,
      runAgent: input.runAgent,
      emitEvent: input.emitEvent,
    });
  }
  const db = openAgentsDb(input.databasePath);
  const agents = listAgents(db, input.projectId);
  for (const agent of agents) {
    if (agent.enabled !== true) {
      continue;
    }
    if (agent.trigger !== "event") {
      continue;
    }
    if (agent.eventType !== input.eventType) {
      continue;
    }
    // An agent never hears an event it helped produce — its own output first of
    // all, and anything further down a chain that already went through it.
    if (chainContains(chain, agent.id)) {
      continue;
    }
    await executeAgent({
      options: {
        databasePath: input.databasePath,
        projectCwd: input.projectCwd,
        runAgent: input.runAgent,
        emitEvent: input.emitEvent,
      },
      agent,
      eventType: input.eventType,
      path: input.path,
      detail: input.detail,
      eventId: input.eventId,
      chain,
    });
  }
}

export async function fireDueScheduledAgents(input: {
  databasePath: string;
  projectId: string;
  now: Date;
  projectCwd?: (projectId: string) => string;
  runAgent?: AgentRunFn;
  emitEvent?: ModuleOptions["emitEvent"];
}): Promise<void> {
  const db = openAgentsDb(input.databasePath);
  pruneOldAgentClaims(db);
  const agents = listAgents(db, input.projectId);
  const hour = input.now.getHours();
  const minute = input.now.getMinutes();
  const keyDay = dayKeyLocal(input.now);
  for (const agent of agents) {
    if (agent.enabled !== true) {
      continue;
    }
    if (agent.trigger !== "schedule") {
      continue;
    }
    if (hour < agent.scheduleHour) {
      continue;
    }
    if (hour === agent.scheduleHour && minute < agent.scheduleMinute) {
      continue;
    }
    const key = claimKey(agent.id, keyDay);
    if (tryClaim(db, key, agent.id) !== true) {
      continue;
    }
    await executeAgent({
      options: {
        databasePath: input.databasePath,
        projectCwd: input.projectCwd,
        runAgent: input.runAgent,
        emitEvent: input.emitEvent,
      },
      agent,
      eventType: "schedule.daily",
      path: "",
      detail: keyDay,
      eventId: key,
      chain: [],
    });
  }
}

export function scheduleIsDue(
  agent: Pick<LotaruAgent, "scheduleHour" | "scheduleMinute">,
  now: Date,
): boolean {
  const hour = now.getHours();
  const minute = now.getMinutes();
  if (hour < agent.scheduleHour) {
    return false;
  }
  if (hour === agent.scheduleHour && minute < agent.scheduleMinute) {
    return false;
  }
  return true;
}

async function viewersFrom(request: FastifyRequest, options: ModuleOptions): Promise<Viewer[]> {
  const user = await options.identity.userFrom(request);
  if (user === null) {
    return [];
  }
  return [{ email: user.email, sub: user.id }];
}

export async function registerAgentsModule(
  app: FastifyInstance,
  options: ModuleOptions,
): Promise<void> {
  const db = openAgentsDb(options.databasePath);

  app.get<{ Querystring: { projectId?: string } }>("/api/agents", async (request, reply) => {
    const viewers = await viewersFrom(request, options);
    if (viewers.length === 0) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    let projectId = "";
    if (request.query.projectId !== undefined) {
      projectId = request.query.projectId.trim();
    }
    if (projectId.length === 0) {
      return reply.code(400).send({ error: "projectId required" });
    }
    if (canSeeProject(options, projectId, viewers[0].sub) !== true) {
      return reply.code(404).send({ error: "not found" });
    }
    const agents = listAgents(db, projectId).map((agent) => {
      return withAgentEventType(agent);
    });
    return { agents };
  });

  app.post("/api/agents", async (request, reply) => {
    const viewers = await viewersFrom(request, options);
    if (viewers.length === 0) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = createAgentSchema.safeParse(request.body);
    if (parsed.success !== true) {
      return reply.code(400).send({ error: "Invalid agent" });
    }
    if (canSeeProject(options, parsed.data.projectId, viewers[0].sub) !== true) {
      return reply.code(404).send({ error: "not found" });
    }
    let eventType = "";
    if (parsed.data.trigger === "event") {
      if (parsed.data.eventType === undefined || parsed.data.eventType.trim().length === 0) {
        return reply.code(400).send({ error: "eventType required" });
      }
      eventType = parsed.data.eventType.trim();
      try {
        requireKnownEventType(eventType);
      } catch {
        return reply.code(400).send({ error: "Unknown event type" });
      }
    }
    let scheduleHour = 21;
    if (parsed.data.scheduleHour !== undefined) {
      scheduleHour = parsed.data.scheduleHour;
    }
    let scheduleMinute = 0;
    if (parsed.data.scheduleMinute !== undefined) {
      scheduleMinute = parsed.data.scheduleMinute;
    }
    let includeVoice = false;
    if (parsed.data.includeVoice === true) {
      includeVoice = true;
    }
    let noteBookTitle = "";
    if (parsed.data.noteBookTitle !== undefined) {
      noteBookTitle = parsed.data.noteBookTitle.trim().slice(0, 200);
    }
    let action: AgentAction = "none";
    if (parsed.data.action !== undefined) {
      action = parsed.data.action;
    } else if (noteBookTitle.length > 0) {
      action = "note";
    }
    let enabled = true;
    if (parsed.data.enabled === false) {
      enabled = false;
    }
    const id = randomUUID();
    let slug = "";
    try {
      slug = uniqueAgentSlug(db, parsed.data.projectId, parsed.data.title, id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Invalid agent event id";
      return reply.code(400).send({ error: message });
    }
    const agent: LotaruAgent = {
      id,
      projectId: parsed.data.projectId,
      title: parsed.data.title.slice(0, 200),
      slug,
      prompt: parsed.data.prompt,
      trigger: parsed.data.trigger,
      eventType,
      scheduleHour,
      scheduleMinute,
      includeVoice,
      action,
      noteBookTitle,
      enabled,
      createdAt: new Date().toISOString(),
      createdBy: viewers[0].email,
    };
    db.prepare(
      "INSERT INTO lotaru_agents (id, project_id, title, slug, prompt, trigger_kind, event_type, schedule_hour, schedule_minute, include_voice, action, note_book_title, enabled, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      agent.id,
      agent.projectId,
      agent.title,
      agent.slug,
      agent.prompt,
      agent.trigger,
      agent.eventType,
      agent.scheduleHour,
      agent.scheduleMinute,
      agent.includeVoice ? 1 : 0,
      agent.action,
      agent.noteBookTitle,
      agent.enabled ? 1 : 0,
      agent.createdAt,
      agent.createdBy,
    );
    return reply.code(201).send(withAgentEventType(agent));
  });

  app.patch<{ Params: { agentId: string } }>("/api/agents/:agentId", async (request, reply) => {
    const viewers = await viewersFrom(request, options);
    if (viewers.length === 0) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const existing = getAgent(db, request.params.agentId);
    if (existing === null) {
      return reply.code(404).send({ error: "not found" });
    }
    if (canSeeProject(options, existing.projectId, viewers[0].sub) !== true) {
      return reply.code(404).send({ error: "not found" });
    }
    const parsed = patchAgentSchema.safeParse(request.body);
    if (parsed.success !== true) {
      return reply.code(400).send({ error: "Invalid agent" });
    }
    let title = existing.title;
    if (parsed.data.title !== undefined) {
      title = parsed.data.title.slice(0, 200);
    }
    let prompt = existing.prompt;
    if (parsed.data.prompt !== undefined) {
      prompt = parsed.data.prompt;
    }
    let trigger = existing.trigger;
    if (parsed.data.trigger !== undefined) {
      trigger = parsed.data.trigger;
    }
    let eventType = existing.eventType;
    if (parsed.data.eventType !== undefined) {
      eventType = parsed.data.eventType.trim();
    }
    if (trigger === "event") {
      try {
        requireKnownEventType(eventType);
      } catch {
        return reply.code(400).send({ error: "Unknown event type" });
      }
    } else {
      eventType = "";
    }
    let scheduleHour = existing.scheduleHour;
    if (parsed.data.scheduleHour !== undefined) {
      scheduleHour = parsed.data.scheduleHour;
    }
    let scheduleMinute = existing.scheduleMinute;
    if (parsed.data.scheduleMinute !== undefined) {
      scheduleMinute = parsed.data.scheduleMinute;
    }
    let includeVoice = existing.includeVoice;
    if (parsed.data.includeVoice !== undefined) {
      includeVoice = parsed.data.includeVoice;
    }
    let noteBookTitle = existing.noteBookTitle;
    if (parsed.data.noteBookTitle !== undefined) {
      noteBookTitle = parsed.data.noteBookTitle.trim().slice(0, 200);
    }
    let action = existing.action;
    if (parsed.data.action !== undefined) {
      action = parsed.data.action;
    }
    let enabled = existing.enabled;
    if (parsed.data.enabled !== undefined) {
      enabled = parsed.data.enabled;
    }
    db.prepare(
      "UPDATE lotaru_agents SET title = ?, prompt = ?, trigger_kind = ?, event_type = ?, schedule_hour = ?, schedule_minute = ?, include_voice = ?, action = ?, note_book_title = ?, enabled = ? WHERE id = ?",
    ).run(
      title,
      prompt,
      trigger,
      eventType,
      scheduleHour,
      scheduleMinute,
      includeVoice ? 1 : 0,
      action,
      noteBookTitle,
      enabled ? 1 : 0,
      existing.id,
    );
    const next = getAgent(db, existing.id);
    if (next === null) {
      return reply.code(404).send({ error: "not found" });
    }
    return withAgentEventType(next);
  });

  app.delete<{ Params: { agentId: string } }>("/api/agents/:agentId", async (request, reply) => {
    const viewers = await viewersFrom(request, options);
    if (viewers.length === 0) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const existing = getAgent(db, request.params.agentId);
    if (existing === null) {
      return reply.code(404).send({ error: "not found" });
    }
    if (canSeeProject(options, existing.projectId, viewers[0].sub) !== true) {
      return reply.code(404).send({ error: "not found" });
    }
    // The event this agent mints behaves like a foreign key: whoever listens for
    // it has to be removed or repointed before the agent can go.
    const subscribers = listEventSubscribers({
      databasePath: options.databasePath,
      projectId: existing.projectId,
      eventType: agentOutputEventType(existing),
    });
    if (subscribers.length > 0) {
      return reply.code(409).send({
        error: `Still listened to by ${describeSubscribers(subscribers)}. Remove or repoint them first.`,
        subscribers,
      });
    }
    db.prepare("DELETE FROM lotaru_agents WHERE id = ?").run(existing.id);
    return { ok: true };
  });

  app.get<{ Params: { agentId: string } }>(
    "/api/agents/:agentId/subscribers",
    async (request, reply) => {
      const viewers = await viewersFrom(request, options);
      if (viewers.length === 0) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const existing = getAgent(db, request.params.agentId);
      if (existing === null) {
        return reply.code(404).send({ error: "not found" });
      }
      if (canSeeProject(options, existing.projectId, viewers[0].sub) !== true) {
        return reply.code(404).send({ error: "not found" });
      }
      return {
        eventType: agentOutputEventType(existing),
        subscribers: listEventSubscribers({
          databasePath: options.databasePath,
          projectId: existing.projectId,
          eventType: agentOutputEventType(existing),
        }),
      };
    },
  );

  app.get<{ Params: { agentId: string } }>("/api/agents/:agentId/runs", async (request, reply) => {
    const viewers = await viewersFrom(request, options);
    if (viewers.length === 0) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const existing = getAgent(db, request.params.agentId);
    if (existing === null) {
      return reply.code(404).send({ error: "not found" });
    }
    if (canSeeProject(options, existing.projectId, viewers[0].sub) !== true) {
      return reply.code(404).send({ error: "not found" });
    }
    const rows = db
      .prepare(
        "SELECT id, agent_id, project_id, status, output, error, started_at, finished_at FROM lotaru_agent_runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT 30",
      )
      .all(existing.id) as Array<{
      id: string;
      agent_id: string;
      project_id: string;
      status: string;
      output: string;
      error: string;
      started_at: string;
      finished_at: string;
    }>;
    const runs: AgentRun[] = [];
    for (const row of rows) {
      let status: AgentRun["status"] = "error";
      if (row.status === "running" || row.status === "done" || row.status === "error") {
        status = row.status;
      }
      runs.push({
        id: row.id,
        agentId: row.agent_id,
        projectId: row.project_id,
        status,
        output: row.output,
        error: row.error,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
      });
    }
    return { runs };
  });

  app.post<{ Params: { agentId: string } }>("/api/agents/:agentId/run", async (request, reply) => {
    const viewers = await viewersFrom(request, options);
    if (viewers.length === 0) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const existing = getAgent(db, request.params.agentId);
    if (existing === null) {
      return reply.code(404).send({ error: "not found" });
    }
    if (canSeeProject(options, existing.projectId, viewers[0].sub) !== true) {
      return reply.code(404).send({ error: "not found" });
    }
    if (agentRunActive(db, existing.id)) {
      return reply.code(409).send({ error: "Agent already running" });
    }
    void executeAgent({
      options,
      agent: existing,
      eventType: "manual",
      path: "",
      detail: "manual",
      eventId: randomUUID(),
      chain: [],
    });
    return reply.code(202).send({ ok: true });
  });
}
