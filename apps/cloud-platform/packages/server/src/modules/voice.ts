import Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { z } from "zod";
import {
  getProjectById,
  userCanAccessProject,
} from "../../../../../task-bridge/apps/backend/dist/services/project-registry.js";
import { loadAgentProfile, openAgentDb } from "../agent-store.js";
import {
  AGENT_TIMEOUT_MS,
  agentCliSpec,
  spawnAgentCli,
  type AgentKind,
  type AgentMode,
} from "../agent-runtime.js";
import { loadAppSettings, openSettingsDb } from "../app-settings.js";
import { publishLotaruEvent } from "../event-bus.js";
import { EVENT_VOICE_INTENT } from "../events.js";
import { requireExistingDirectory } from "../folder-path.js";
import { runOllamaChat } from "../ollama.js";
import {
  parseVoiceIntentDecision,
  voiceIntentScannerPrompt,
} from "../voice-intent.js";
import {
  startVoiceSidecar,
  type VoiceSidecarHandle,
} from "../voice-sidecar.js";
import type { Identity } from "./identity.js";

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
  dataDir: string;
  projectAccess?: (projectId: string, userId: string) => boolean;
  projectCwd?: (projectId: string) => string;
  runAgent?: AgentRunFn;
  startSidecar?: typeof startVoiceSidecar;
  mockSidecar?: boolean;
};

const segmentRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  session_id: z.string(),
  kind: z.string(),
  text: z.string(),
  started_at: z.number(),
  ended_at: z.number(),
  audio_path: z.string(),
  created_at: z.number(),
});

const decisionRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  segment_id: z.string(),
  emit: z.number(),
  title: z.string(),
  summary: z.string(),
  reason: z.string(),
  event_id: z.string(),
  created_at: z.number(),
});

export type VoiceSegment = {
  id: string;
  projectId: string;
  sessionId: string;
  kind: "partial" | "final";
  text: string;
  startedAt: number;
  endedAt: number;
  audioPath: string;
  createdAt: number;
};

export type VoiceIntentRow = {
  id: string;
  projectId: string;
  segmentId: string;
  emit: boolean;
  title: string;
  summary: string;
  reason: string;
  eventId: string;
  createdAt: number;
};

function canSeeProject(options: ModuleOptions, projectId: string, userId: string): boolean {
  if (options.projectAccess !== undefined) {
    return options.projectAccess(projectId, userId);
  }
  return userCanAccessProject(projectId, userId);
}

async function viewersFrom(request: FastifyRequest, options: ModuleOptions): Promise<Viewer[]> {
  const user = await options.identity.userFrom(request);
  if (user === null) {
    return [];
  }
  return [{ email: user.email, sub: user.id }];
}

export function openVoiceDb(databasePath: string): Database.Database {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS voice_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS voice_segments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      started_at REAL NOT NULL,
      ended_at REAL NOT NULL,
      audio_path TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_voice_segments_project ON voice_segments(project_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS voice_intent_decisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      segment_id TEXT NOT NULL,
      emit INTEGER NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      reason TEXT NOT NULL,
      event_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_voice_intent_project ON voice_intent_decisions(project_id, created_at DESC);
  `);
  return db;
}

function segmentFromRow(row: z.infer<typeof segmentRowSchema>): VoiceSegment | false {
  if (row.kind !== "partial" && row.kind !== "final") {
    return false;
  }
  return {
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id,
    kind: row.kind,
    text: row.text,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    audioPath: row.audio_path,
    createdAt: row.created_at,
  };
}

function decisionFromRow(row: z.infer<typeof decisionRowSchema>): VoiceIntentRow {
  return {
    id: row.id,
    projectId: row.project_id,
    segmentId: row.segment_id,
    emit: row.emit === 1,
    title: row.title,
    summary: row.summary,
    reason: row.reason,
    eventId: row.event_id,
    createdAt: row.created_at,
  };
}

export function listVoiceSegments(
  db: Database.Database,
  projectId: string,
  limit: number,
): VoiceSegment[] {
  const raw = db
    .prepare(
      "SELECT * FROM voice_segments WHERE project_id = ? AND kind = 'final' ORDER BY created_at DESC LIMIT ?",
    )
    .all(projectId, limit);
  if (Array.isArray(raw) !== true) {
    return [];
  }
  const segments: VoiceSegment[] = [];
  for (const entry of raw) {
    const parsed = segmentRowSchema.safeParse(entry);
    if (parsed.success !== true) {
      continue;
    }
    const segment = segmentFromRow(parsed.data);
    if (segment === false) {
      continue;
    }
    segments.push(segment);
  }
  return segments;
}

export function listVoiceDecisions(
  db: Database.Database,
  projectId: string,
  limit: number,
): VoiceIntentRow[] {
  const raw = db
    .prepare(
      "SELECT * FROM voice_intent_decisions WHERE project_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(projectId, limit);
  if (Array.isArray(raw) !== true) {
    return [];
  }
  const decisions: VoiceIntentRow[] = [];
  for (const entry of raw) {
    const parsed = decisionRowSchema.safeParse(entry);
    if (parsed.success !== true) {
      continue;
    }
    decisions.push(decisionFromRow(parsed.data));
  }
  return decisions;
}

function rollingTranscript(db: Database.Database, projectId: string): string {
  const segments = listVoiceSegments(db, projectId, 12);
  const ordered = segments.slice().reverse();
  const lines: string[] = [];
  for (const segment of ordered) {
    lines.push(segment.text);
  }
  return lines.join("\n");
}

async function defaultRunAgent(
  options: ModuleOptions,
  input: { kind: AgentKind; mode: AgentMode; prompt: string; cwd: string },
): Promise<string> {
  if (options.runAgent !== undefined) {
    return options.runAgent(input);
  }
  if (input.kind === "ollama") {
    const settingsDb = openSettingsDb(options.databasePath);
    const settings = loadAppSettings(settingsDb);
    return runOllamaChat(
      settings.ollamaHost,
      settings.ollamaModel,
      "You classify spoken intents. Reply with JSON only.",
      input.prompt,
    );
  }
  const profile = loadAgentProfile(openAgentDb(options.databasePath));
  const spec = agentCliSpec({
    kind: input.kind,
    mode: input.mode,
    command: profile.command,
    prompt: input.prompt,
  });
  return spawnAgentCli(spec, input.cwd, AGENT_TIMEOUT_MS);
}

function resolveProjectCwd(options: ModuleOptions, projectId: string): string {
  if (options.projectCwd !== undefined) {
    return options.projectCwd(projectId);
  }
  const project = getProjectById(projectId);
  if (project === null || project.repoPath.trim().length === 0) {
    return process.cwd();
  }
  try {
    return requireExistingDirectory(project.repoPath);
  } catch {
    return process.cwd();
  }
}

function writePcmWav(filePath: string, pcm: Buffer): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const sampleRate = 16000;
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcm.copy(buffer, 44);
  writeFileSync(filePath, buffer);
}

export async function scanVoiceUtterance(input: {
  options: ModuleOptions;
  db: Database.Database;
  projectId: string;
  segmentId: string;
  utterance: string;
}): Promise<VoiceIntentRow> {
  const profile = loadAgentProfile(openAgentDb(input.options.databasePath));
  const prompt = voiceIntentScannerPrompt({
    rollingTranscript: rollingTranscript(input.db, input.projectId),
    latestUtterance: input.utterance,
  });
  let raw = "";
  try {
    raw = await defaultRunAgent(input.options, {
      kind: profile.kind,
      mode: profile.mode,
      prompt,
      cwd: resolveProjectCwd(input.options, input.projectId),
    });
  } catch {
    raw = "";
  }
  const decisions = parseVoiceIntentDecision(raw);
  let decision = {
    emit: false,
    title: "",
    summary: "",
    reason: "scanner returned invalid json",
  };
  for (const entry of decisions) {
    decision = entry;
  }
  let eventId = "";
  if (decision.emit === true) {
    const title = decision.title.trim().length > 0 ? decision.title.trim() : input.utterance.slice(0, 120);
    const summary =
      decision.summary.trim().length > 0 ? decision.summary.trim() : input.utterance.slice(0, 400);
    const event = publishLotaruEvent(
      {
        type: EVENT_VOICE_INTENT,
        projectId: input.projectId,
        scriptId: "",
        path: input.utterance.slice(0, 240),
        detail: `${title}: ${summary}`.slice(0, 500),
      },
      "live",
    );
    eventId = event.id;
  }
  const id = randomUUID();
  const createdAt = Date.now();
  input.db
    .prepare(
      "INSERT INTO voice_intent_decisions (id, project_id, segment_id, emit, title, summary, reason, event_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      input.projectId,
      input.segmentId,
      decision.emit ? 1 : 0,
      decision.title,
      decision.summary,
      decision.reason,
      eventId,
      createdAt,
    );
  return {
    id,
    projectId: input.projectId,
    segmentId: input.segmentId,
    emit: decision.emit,
    title: decision.title,
    summary: decision.summary,
    reason: decision.reason,
    eventId,
    createdAt,
  };
}

export async function registerVoiceModule(
  app: FastifyInstance,
  options: ModuleOptions,
): Promise<void> {
  const db = openVoiceDb(options.databasePath);
  const audioRoot = join(options.dataDir, "voice-audio");
  mkdirSync(audioRoot, { recursive: true });

  let sidecar: VoiceSidecarHandle | false = false;
  let listenProjectId = "";
  let listenSessionId = "";
  const browserSockets = new Set<WebSocket>();

  function broadcast(payload: unknown): void {
    const text = JSON.stringify(payload);
    for (const socket of browserSockets) {
      if (socket.readyState === 1) {
        socket.send(text);
      }
    }
  }

  async function ensureSidecar(): Promise<VoiceSidecarHandle> {
    if (sidecar !== false) {
      return sidecar;
    }
    const starter = options.startSidecar !== undefined ? options.startSidecar : startVoiceSidecar;
    const handle = await starter({
      mock: options.mockSidecar === true,
      onError: (message) => {
        app.log.warn({ message }, "voice sidecar");
      },
      onMessage: (message) => {
        void handleSidecarMessage(message).catch((err) => {
          app.log.error({ err }, "voice sidecar message failed");
        });
      },
    });
    sidecar = handle;
    return handle;
  }

  async function handleSidecarMessage(message: {
    kind: "partial" | "final" | "error";
    text: string;
    startedAt?: number;
    endedAt?: number;
    pcmB64?: string;
  }): Promise<void> {
    if (message.kind === "error") {
      broadcast({ kind: "error", text: message.text });
      return;
    }
    if (listenProjectId.length === 0 || listenSessionId.length === 0) {
      return;
    }
    const id = randomUUID();
    const createdAt = Date.now();
    let startedAt = createdAt / 1000;
    if (message.startedAt !== undefined) {
      startedAt = message.startedAt;
    }
    let endedAt = startedAt;
    if (message.endedAt !== undefined) {
      endedAt = message.endedAt;
    }
    let audioPath = "";
    if (message.kind === "final" && message.pcmB64 !== undefined && message.pcmB64.length > 0) {
      const pcm = Buffer.from(message.pcmB64, "base64");
      audioPath = join(audioRoot, `${id}.wav`);
      writePcmWav(audioPath, pcm);
    }
    if (message.kind === "final") {
      db.prepare(
        "INSERT INTO voice_segments (id, project_id, session_id, kind, text, started_at, ended_at, audio_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        id,
        listenProjectId,
        listenSessionId,
        "final",
        message.text,
        startedAt,
        endedAt,
        audioPath,
        createdAt,
      );
      broadcast({
        kind: "segment",
        segment: {
          id,
          projectId: listenProjectId,
          sessionId: listenSessionId,
          kind: "final",
          text: message.text,
          startedAt,
          endedAt,
          audioPath,
          createdAt,
        },
      });
      const decision = await scanVoiceUtterance({
        options,
        db,
        projectId: listenProjectId,
        segmentId: id,
        utterance: message.text,
      });
      broadcast({ kind: "decision", decision });
      return;
    }
    broadcast({
      kind: "partial",
      text: message.text,
      startedAt,
      endedAt,
    });
  }

  app.get<{ Querystring: { projectId?: string; limit?: string } }>(
    "/api/voice/segments",
    async (request, reply) => {
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
      let limit = 50;
      if (request.query.limit !== undefined) {
        const parsed = Number(request.query.limit);
        if (Number.isFinite(parsed) && parsed > 0 && parsed <= 200) {
          limit = Math.floor(parsed);
        }
      }
      for (const viewer of viewers) {
        if (!canSeeProject(options, projectId, viewer.sub)) {
          return reply.code(404).send({ error: "not found" });
        }
        return { segments: listVoiceSegments(db, projectId, limit) };
      }
      return reply.code(401).send({ error: "unauthorized" });
    },
  );

  app.get<{ Querystring: { projectId?: string; limit?: string } }>(
    "/api/voice/decisions",
    async (request, reply) => {
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
      let limit = 50;
      if (request.query.limit !== undefined) {
        const parsed = Number(request.query.limit);
        if (Number.isFinite(parsed) && parsed > 0 && parsed <= 200) {
          limit = Math.floor(parsed);
        }
      }
      for (const viewer of viewers) {
        if (!canSeeProject(options, projectId, viewer.sub)) {
          return reply.code(404).send({ error: "not found" });
        }
        return { decisions: listVoiceDecisions(db, projectId, limit) };
      }
      return reply.code(401).send({ error: "unauthorized" });
    },
  );

  app.get<{ Querystring: { projectId?: string } }>("/api/voice/status", async (request, reply) => {
    const viewers = await viewersFrom(request, options);
    if (viewers.length === 0) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    let projectId = "";
    if (request.query.projectId !== undefined) {
      projectId = request.query.projectId.trim();
    }
    for (const viewer of viewers) {
      if (projectId.length > 0 && !canSeeProject(options, projectId, viewer.sub)) {
        return reply.code(404).send({ error: "not found" });
      }
      return {
        listening: listenProjectId.length > 0,
        projectId: listenProjectId,
        sessionId: listenSessionId,
        sidecar: sidecar !== false,
      };
    }
    return reply.code(401).send({ error: "unauthorized" });
  });

  app.get<{ Params: { segmentId: string } }>(
    "/api/voice/segments/:segmentId/audio",
    async (request, reply) => {
      const viewers = await viewersFrom(request, options);
      if (viewers.length === 0) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const parsed = segmentRowSchema.safeParse(
        db.prepare("SELECT * FROM voice_segments WHERE id = ?").get(request.params.segmentId),
      );
      if (parsed.success !== true) {
        return reply.code(404).send({ error: "not found" });
      }
      const segment = segmentFromRow(parsed.data);
      if (segment === false) {
        return reply.code(404).send({ error: "not found" });
      }
      for (const viewer of viewers) {
        if (!canSeeProject(options, segment.projectId, viewer.sub)) {
          return reply.code(404).send({ error: "not found" });
        }
        if (segment.audioPath.length === 0 || existsSync(segment.audioPath) !== true) {
          return reply.code(404).send({ error: "audio missing" });
        }
        reply.header("Content-Type", "audio/wav");
        return reply.send(readFileSync(segment.audioPath));
      }
      return reply.code(401).send({ error: "unauthorized" });
    },
  );

  app.get<{ Querystring: { projectId?: string } }>(
    "/api/v1/voice/stream",
    { websocket: true },
    (socket, request) => {
      void (async () => {
        const viewers = await viewersFrom(request, options);
        if (viewers.length === 0) {
          socket.close(4401, "unauthorized");
          return;
        }
        let projectId = "";
        if (request.query.projectId !== undefined) {
          projectId = request.query.projectId.trim();
        }
        if (projectId.length === 0) {
          socket.close(4400, "projectId required");
          return;
        }
        let allowed = false;
        for (const viewer of viewers) {
          if (canSeeProject(options, projectId, viewer.sub)) {
            allowed = true;
          }
        }
        if (allowed !== true) {
          socket.close(4404, "not found");
          return;
        }
        try {
          await ensureSidecar();
        } catch (err) {
          const message = err instanceof Error ? err.message : "sidecar failed";
          socket.send(JSON.stringify({ kind: "error", text: message }));
          socket.close(1011, "sidecar failed");
          return;
        }
        const sessionId = randomUUID();
        listenProjectId = projectId;
        listenSessionId = sessionId;
        db.prepare(
          "INSERT INTO voice_sessions (id, project_id, created_at, ended_at) VALUES (?, ?, ?, ?)",
        ).run(sessionId, projectId, Date.now(), 0);
        browserSockets.add(socket);
        socket.send(
          JSON.stringify({
            kind: "hello",
            projectId,
            sessionId,
            listening: true,
          }),
        );
        socket.on("message", (raw) => {
          if (sidecar === false) {
            return;
          }
          if (typeof raw === "string") {
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch {
              return;
            }
            const opSchema = z.object({ op: z.string() });
            const op = opSchema.safeParse(parsed);
            if (op.success === true && op.data.op === "flush") {
              sidecar.flush();
            }
            return;
          }
          if (Buffer.isBuffer(raw)) {
            sidecar.sendPcm(raw);
            return;
          }
          if (Array.isArray(raw)) {
            sidecar.sendPcm(Buffer.concat(raw));
            return;
          }
        });
        socket.on("close", () => {
          browserSockets.delete(socket);
          if (browserSockets.size === 0) {
            db.prepare("UPDATE voice_sessions SET ended_at = ? WHERE id = ?").run(
              Date.now(),
              listenSessionId,
            );
            listenProjectId = "";
            listenSessionId = "";
          }
        });
      })();
    },
  );
}
