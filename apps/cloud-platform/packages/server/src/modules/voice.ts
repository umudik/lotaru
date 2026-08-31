import Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { z } from "zod";
import {
  userCanAccessProject,
} from "../../../../../task-bridge/apps/backend/dist/services/project-registry.js";
import { publishLotaruEvent } from "../event-bus.js";
import { pruneVoiceSegments } from "../voice-retention.js";
import { EVENT_VOICE_SEGMENT } from "../events.js";
import {
  probeVoiceSidecar,
  startVoiceSidecar,
  startVoiceSidecarWithRetry,
  type VoiceSidecarHandle,
} from "../voice-sidecar.js";
import type { Identity } from "./identity.js";

type Viewer = { email: string; sub: string };

type ModuleOptions = {
  databasePath: string;
  identity: Identity;
  dataDir: string;
  projectAccess?: (projectId: string, userId: string) => boolean;
  startSidecar?: typeof startVoiceSidecar;
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
    CREATE INDEX IF NOT EXISTS idx_voice_segments_project_cursor ON voice_segments(project_id, created_at DESC, id DESC);
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

export function encodeVoiceSegmentCursor(createdAt: number, id: string): string {
  if (id.trim().length === 0) {
    throw new Error("Invalid voice cursor");
  }
  if (Number.isFinite(createdAt) !== true) {
    throw new Error("Invalid voice cursor");
  }
  const packed = `${String(createdAt)}\n${id}`;
  return Buffer.from(packed, "utf8").toString("base64url");
}

export function decodeVoiceSegmentCursor(raw: string): { createdAt: number; id: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Invalid voice cursor");
  }
  const text = Buffer.from(trimmed, "base64url").toString("utf8");
  const parts = text.split("\n");
  if (parts.length !== 2) {
    throw new Error("Invalid voice cursor");
  }
  const createdRaw = parts[0];
  const id = parts[1];
  if (createdRaw === undefined || id === undefined) {
    throw new Error("Invalid voice cursor");
  }
  if (/^[0-9]+$/.test(createdRaw) !== true) {
    throw new Error("Invalid voice cursor");
  }
  const createdAt = Number.parseInt(createdRaw, 10);
  if (Number.isFinite(createdAt) !== true || String(createdAt) !== createdRaw) {
    throw new Error("Invalid voice cursor");
  }
  if (id.trim().length === 0) {
    throw new Error("Invalid voice cursor");
  }
  return { createdAt, id };
}

export type VoiceSegmentPage = {
  segments: VoiceSegment[];
  next: string[];
};

export function pageVoiceSegments(
  db: Database.Database,
  projectId: string,
  limit: number,
  cursor: string,
): VoiceSegmentPage {
  let pageSize = 40;
  if (Number.isFinite(limit) === true && limit >= 1 && limit <= 200) {
    pageSize = Math.floor(limit);
  }
  const fetchLimit = pageSize + 1;
  let raw: unknown[] = [];
  if (cursor.trim().length === 0) {
    raw = db
      .prepare(
        "SELECT * FROM voice_segments WHERE project_id = ? AND kind = 'final' ORDER BY created_at DESC, id DESC LIMIT ?",
      )
      .all(projectId, fetchLimit);
  } else {
    const decoded = decodeVoiceSegmentCursor(cursor);
    raw = db
      .prepare(
        `SELECT * FROM voice_segments
         WHERE project_id = ? AND kind = 'final'
           AND (created_at < ? OR (created_at = ? AND id < ?))
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(projectId, decoded.createdAt, decoded.createdAt, decoded.id, fetchLimit);
  }
  if (Array.isArray(raw) !== true) {
    return { segments: [], next: [] };
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
  const next: string[] = [];
  if (segments.length > pageSize) {
    const page = segments.slice(0, pageSize);
    const last = page[page.length - 1];
    if (last !== undefined) {
      next.push(encodeVoiceSegmentCursor(last.createdAt, last.id));
    }
    return { segments: page, next };
  }
  return { segments, next };
}

export function listVoiceSegments(
  db: Database.Database,
  projectId: string,
  limit: number,
): VoiceSegment[] {
  return pageVoiceSegments(db, projectId, limit, "").segments;
}

export async function registerVoiceModule(
  app: FastifyInstance,
  options: ModuleOptions,
): Promise<void> {
  const db = openVoiceDb(options.databasePath);

  let sidecar: VoiceSidecarHandle | false = false;
  let listenProjectId = "";
  let listenSessionId = "";
  const browserSockets = new Set<WebSocket>();
  let sidecarReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let sidecarReconnectAttempt = 0;
  let sidecarConnectGeneration = 0;

  function broadcast(payload: unknown): void {
    const text = JSON.stringify(payload);
    for (const socket of browserSockets) {
      if (socket.readyState === 1) {
        socket.send(text);
      }
    }
  }

  function clearSidecarReconnectTimer(): void {
    if (sidecarReconnectTimer !== null) {
      clearTimeout(sidecarReconnectTimer);
      sidecarReconnectTimer = null;
    }
  }

  function releaseSidecar(): void {
    clearSidecarReconnectTimer();
    sidecarConnectGeneration += 1;
    if (sidecar !== false) {
      sidecar.close();
      sidecar = false;
    }
  }

  function shutdownVoiceClients(): void {
    releaseSidecar();
    for (const socket of browserSockets) {
      socket.close(1001, "server shutting down");
    }
    browserSockets.clear();
  }

  function sidecarCallbacks(generation: number): {
    onMessage: (message: {
      kind: "partial" | "final" | "error";
      text: string;
      startedAt?: number;
      endedAt?: number;
    }) => void;
    onError: (message: string) => void;
    onClose: () => void;
  } {
    return {
      onError: (message) => {
        if (generation !== sidecarConnectGeneration) {
          return;
        }
        app.log.warn({ message }, "voice sidecar");
        broadcast({ kind: "error", text: message });
      },
      onClose: () => {
        if (generation !== sidecarConnectGeneration) {
          return;
        }
        if (sidecar === false) {
          return;
        }
        app.log.warn("voice sidecar closed");
        sidecar = false;
        broadcast({
          kind: "error",
          text: "Speech engine disconnected — reconnecting…",
        });
        scheduleSidecarReconnect();
      },
      onMessage: (message) => {
        if (generation !== sidecarConnectGeneration) {
          return;
        }
        void handleSidecarMessage(message).catch((err) => {
          app.log.error({ err }, "voice sidecar message failed");
        });
      },
    };
  }

  function scheduleSidecarReconnect(): void {
    if (browserSockets.size === 0) {
      return;
    }
    if (sidecar !== false) {
      return;
    }
    if (sidecarReconnectTimer !== null) {
      return;
    }
    const delay = Math.min(500 * 2 ** Math.min(sidecarReconnectAttempt, 6), 10_000);
    sidecarReconnectAttempt += 1;
    sidecarReconnectTimer = setTimeout(() => {
      sidecarReconnectTimer = null;
      void ensureSidecar("hold").catch((err) => {
        const message = err instanceof Error ? err.message : "sidecar reconnect failed";
        app.log.warn({ message }, "voice sidecar reconnect");
        broadcast({ kind: "error", text: `${message} — retrying…` });
        scheduleSidecarReconnect();
      });
    }, delay);
  }

  async function ensureSidecar(mode: "open" | "hold"): Promise<VoiceSidecarHandle> {
    if (sidecar !== false) {
      return sidecar;
    }
    clearSidecarReconnectTimer();
    sidecarConnectGeneration += 1;
    const generation = sidecarConnectGeneration;
    const callbacks = sidecarCallbacks(generation);
    if (options.startSidecar !== undefined) {
      const handle = await options.startSidecar(callbacks);
      if (generation !== sidecarConnectGeneration) {
        handle.close();
        throw new Error("Speech engine connect superseded");
      }
      sidecar = handle;
      sidecarReconnectAttempt = 0;
      app.log.info({ mode: handle.mode, port: handle.port }, "voice sidecar ready");
      broadcast({ kind: "sidecar", status: "ready" });
      return handle;
    }
    let healthTimeoutMs = 15_000;
    let maxAttempts = 0;
    if (mode === "open") {
      healthTimeoutMs = 30_000;
      maxAttempts = 12;
    }
    const handle = await startVoiceSidecarWithRetry({
      ...callbacks,
      shouldContinue: () => {
        if (generation !== sidecarConnectGeneration) {
          return false;
        }
        if (mode === "hold") {
          return browserSockets.size > 0;
        }
        return true;
      },
      healthTimeoutMs,
      maxAttempts,
    });
    if (generation !== sidecarConnectGeneration) {
      handle.close();
      throw new Error("Speech engine connect superseded");
    }
    sidecar = handle;
    sidecarReconnectAttempt = 0;
    app.log.info({ mode: handle.mode, port: handle.port }, "voice sidecar ready");
    broadcast({ kind: "sidecar", status: "ready" });
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
        "",
        createdAt,
      );
      pruneVoiceSegments(db, listenProjectId);
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
          audioPath: "",
          createdAt,
        },
      });
      publishLotaruEvent(
        {
          type: EVENT_VOICE_SEGMENT,
          projectId: listenProjectId,
          scriptId: "",
          path: id,
          detail: message.text.slice(0, 500),
        },
        "live",
      );
      return;
    }
    broadcast({
      kind: "partial",
      text: message.text,
      startedAt,
      endedAt,
    });
  }

  app.get<{ Querystring: { projectId?: string; limit?: string; cursor?: string } }>(
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
      let limit = 40;
      if (request.query.limit !== undefined) {
        const parsed = Number(request.query.limit);
        if (Number.isFinite(parsed) && parsed > 0 && parsed <= 200) {
          limit = Math.floor(parsed);
        }
      }
      let cursor = "";
      if (request.query.cursor !== undefined) {
        cursor = request.query.cursor.trim();
      }
      for (const viewer of viewers) {
        if (!canSeeProject(options, projectId, viewer.sub)) {
          return reply.code(403).send({ error: "project access denied" });
        }
        try {
          return pageVoiceSegments(db, projectId, limit, cursor);
        } catch {
          return reply.code(400).send({ error: "invalid cursor" });
        }
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
        return reply.code(403).send({ error: "project access denied" });
      }
      const probe = await probeVoiceSidecar();
      return {
        listening: listenProjectId.length > 0,
        projectId: listenProjectId,
        sessionId: listenSessionId,
        sidecar: sidecar !== false,
        sidecarMode: sidecar === false ? "none" : sidecar.mode,
        sidecarReachable: probe.reachable,
        sidecarUrl: probe.url,
        sidecarModel: probe.model,
        sidecarLanguage: probe.language,
        sidecarDevice: probe.device,
      };
    }
    return reply.code(401).send({ error: "unauthorized" });
  });

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
          await ensureSidecar("open");
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
            releaseSidecar();
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

  app.addHook("preClose", async () => {
    shutdownVoiceClients();
  });

  app.addHook("onClose", async () => {
    db.close();
  });
}
