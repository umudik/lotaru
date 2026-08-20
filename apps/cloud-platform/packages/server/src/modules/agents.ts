import Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  getProjectById,
  userCanAccessProject,
} from "../../../../../task-bridge/apps/backend/dist/services/project-registry.js";
import { loadAppSettings, openSettingsDb } from "../app-settings.js";
import {
  AGENT_TIMEOUT_MS,
  agentCliSpec,
  spawnAgentCli,
  type AgentKind,
  type AgentMode,
} from "../agent-runtime.js";
import { loadAgentProfile, openAgentDb } from "../agent-store.js";
import {
  EVENT_AGENT_RAN,
  EVENT_CLOCK_TICK,
  EVENT_NOTE_PAGE_WRITTEN,
  type LotaruEvent,
} from "../events.js";
import { requireExistingDirectory } from "../folder-path.js";
import { runOllamaChat } from "../ollama.js";
import { REACTION_EVENT_TYPES } from "../reactions.js";
import { appendNotePageByBookTitle } from "./notes.js";
import { listVoiceSegments, openVoiceDb } from "./voice.js";
import type { Identity } from "./identity.js";

export type AgentTrigger = "event" | "schedule";

export type LotaruAgent = {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  trigger: AgentTrigger;
  eventType: string;
  scheduleHour: number;
  scheduleMinute: number;
  includeVoice: boolean;
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

type AgentRunFn = (input: {
  kind: AgentKind;
  mode: AgentMode;
  prompt: string;
  cwd: string;
}) => Promise<string>;

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
  }) => LotaruEvent;
};

const triggerSchema = z.enum(["event", "schedule"]);

const createAgentSchema = z.object({
  projectId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(20_000),
  trigger: triggerSchema,
  eventType: z.string().trim().optional(),
  scheduleHour: z.number().int().min(0).max(23).optional(),
  scheduleMinute: z.number().int().min(0).max(59).optional(),
  includeVoice: z.boolean().optional(),
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
  noteBookTitle: z.string().trim().max(200).optional(),
  enabled: z.boolean().optional(),
});

const agentRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  title: z.string(),
  prompt: z.string(),
  trigger_kind: z.string(),
  event_type: z.string(),
  schedule_hour: z.number(),
  schedule_minute: z.number(),
  include_voice: z.number(),
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
  for (const entry of REACTION_EVENT_TYPES) {
    if (entry === eventType) {
      return;
    }
  }
  throw new Error("Unknown event type");
}

export function openAgentsDb(databasePath: string): Database.Database {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS lotaru_agents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      trigger_kind TEXT NOT NULL,
      event_type TEXT NOT NULL DEFAULT '',
      schedule_hour INTEGER NOT NULL DEFAULT 21,
      schedule_minute INTEGER NOT NULL DEFAULT 0,
      include_voice INTEGER NOT NULL DEFAULT 0,
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
  return db;
}

function agentFromRow(row: z.infer<typeof agentRowSchema>): LotaruAgent | null {
  const triggerParsed = triggerSchema.safeParse(row.trigger_kind);
  if (triggerParsed.success !== true) {
    return null;
  }
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    prompt: row.prompt,
    trigger: triggerParsed.data,
    eventType: row.event_type,
    scheduleHour: row.schedule_hour,
    scheduleMinute: row.schedule_minute,
    includeVoice: row.include_voice === 1,
    noteBookTitle: row.note_book_title,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function listAgents(db: Database.Database, projectId: string): LotaruAgent[] {
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

function buildPrompt(agent: LotaruAgent, eventType: string, path: string, detail: string, voice: string): string {
  const parts = [
    agent.prompt,
    "",
    `Agent title: ${agent.title}`,
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
  if (agent.noteBookTitle.trim().length > 0) {
    parts.push(
      "",
      `Write a clear journal-style note body. The platform will save your full reply as a page in the note book titled "${agent.noteBookTitle.trim()}".`,
      "Return only the note body text, no surrounding commentary.",
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
      "Use MCP tools for voice segments, note books, events, scripts, and agents when the prompt needs platform data.",
    );
  }
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
  if (input.options.runAgent !== undefined) {
    const profile = loadAgentProfile(openAgentDb(input.options.databasePath));
    let cwd = process.cwd();
    if (input.options.projectCwd !== undefined) {
      cwd = input.options.projectCwd(input.projectId);
    }
    return input.options.runAgent({
      kind: profile.kind,
      mode: profile.mode,
      prompt: input.prompt,
      cwd,
    });
  }
  const profile = loadAgentProfile(openAgentDb(input.options.databasePath));
  let cwd = process.cwd();
  if (input.options.projectCwd !== undefined) {
    cwd = input.options.projectCwd(input.projectId);
  } else {
    const project = getProjectById(input.projectId);
    if (project !== null && project.repoPath.trim().length > 0) {
      try {
        cwd = requireExistingDirectory(project.repoPath);
      } catch {
        cwd = process.cwd();
      }
    }
  }
  if (profile.kind === "ollama") {
    const settingsDb = openSettingsDb(input.options.databasePath);
    const settings = loadAppSettings(settingsDb);
    return runOllamaChat(
      settings.ollamaHost,
      settings.ollamaModel,
      "You are a Lotaru project agent. Follow the user prompt carefully.",
      input.prompt,
    );
  }
  const spec = agentCliSpec({
    kind: profile.kind,
    mode: profile.mode,
    command: profile.command,
    prompt: input.prompt,
  });
  return spawnAgentCli(spec, cwd, AGENT_TIMEOUT_MS);
}

const runningAgentIds = new Set<string>();

async function executeAgent(input: {
  options: FireOptions;
  agent: LotaruAgent;
  eventType: string;
  path: string;
  detail: string;
  eventId: string;
}): Promise<void> {
  if (runningAgentIds.has(input.agent.id)) {
    return;
  }
  runningAgentIds.add(input.agent.id);
  const db = openAgentsDb(input.options.databasePath);
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  db.prepare(
    "INSERT INTO lotaru_agent_runs (id, agent_id, project_id, status, output, error, started_at, finished_at) VALUES (?, ?, ?, ?, '', '', ?, '')",
  ).run(runId, input.agent.id, input.agent.projectId, "running", startedAt);
  try {
    let voice = "";
    if (input.agent.includeVoice) {
      voice = voiceContext(input.options.databasePath, input.agent.projectId);
    }
    const prompt = buildPrompt(input.agent, input.eventType, input.path, input.detail, voice);
    const text = await runAgentText({
      options: input.options,
      prompt,
      projectId: input.agent.projectId,
    });
    const finishedAt = new Date().toISOString();
    db.prepare(
      "UPDATE lotaru_agent_runs SET status = ?, output = ?, finished_at = ? WHERE id = ?",
    ).run("done", text, finishedAt, runId);
    if (input.options.emitEvent !== undefined) {
      input.options.emitEvent({
        type: EVENT_AGENT_RAN,
        projectId: input.agent.projectId,
        scriptId: "",
        path: input.agent.id,
        detail: runId,
      });
    }
    const bookTitle = input.agent.noteBookTitle.trim();
    if (bookTitle.length > 0 && text.trim().length > 0) {
      let body = text.trim();
      if (body.length > 200_000) {
        body = body.slice(0, 200_000);
      }
      const page = appendNotePageByBookTitle({
        databasePath: input.options.databasePath,
        projectId: input.agent.projectId,
        bookTitle,
        pageTitle: dayKeyLocal(new Date()),
        body,
        createdBy: input.agent.createdBy,
      });
      if (input.options.emitEvent !== undefined) {
        input.options.emitEvent({
          type: EVENT_NOTE_PAGE_WRITTEN,
          projectId: input.agent.projectId,
          scriptId: "",
          path: page.bookId,
          detail: page.pageId,
        });
      }
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
}): Promise<void> {
  if (input.eventType === EVENT_AGENT_RAN) {
    return;
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
    return { agents: listAgents(db, projectId) };
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
    let enabled = true;
    if (parsed.data.enabled === false) {
      enabled = false;
    }
    const agent: LotaruAgent = {
      id: randomUUID(),
      projectId: parsed.data.projectId,
      title: parsed.data.title.slice(0, 200),
      prompt: parsed.data.prompt,
      trigger: parsed.data.trigger,
      eventType,
      scheduleHour,
      scheduleMinute,
      includeVoice,
      noteBookTitle,
      enabled,
      createdAt: new Date().toISOString(),
      createdBy: viewers[0].email,
    };
    db.prepare(
      "INSERT INTO lotaru_agents (id, project_id, title, prompt, trigger_kind, event_type, schedule_hour, schedule_minute, include_voice, note_book_title, enabled, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      agent.id,
      agent.projectId,
      agent.title,
      agent.prompt,
      agent.trigger,
      agent.eventType,
      agent.scheduleHour,
      agent.scheduleMinute,
      agent.includeVoice ? 1 : 0,
      agent.noteBookTitle,
      agent.enabled ? 1 : 0,
      agent.createdAt,
      agent.createdBy,
    );
    return reply.code(201).send(agent);
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
    let enabled = existing.enabled;
    if (parsed.data.enabled !== undefined) {
      enabled = parsed.data.enabled;
    }
    db.prepare(
      "UPDATE lotaru_agents SET title = ?, prompt = ?, trigger_kind = ?, event_type = ?, schedule_hour = ?, schedule_minute = ?, include_voice = ?, note_book_title = ?, enabled = ? WHERE id = ?",
    ).run(
      title,
      prompt,
      trigger,
      eventType,
      scheduleHour,
      scheduleMinute,
      includeVoice ? 1 : 0,
      noteBookTitle,
      enabled ? 1 : 0,
      existing.id,
    );
    const next = getAgent(db, existing.id);
    if (next === null) {
      return reply.code(404).send({ error: "not found" });
    }
    return next;
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
    db.prepare("DELETE FROM lotaru_agents WHERE id = ?").run(existing.id);
    return { ok: true };
  });

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
    void executeAgent({
      options,
      agent: existing,
      eventType: "manual",
      path: "",
      detail: "manual",
      eventId: randomUUID(),
    });
    return reply.code(202).send({ ok: true });
  });
}
