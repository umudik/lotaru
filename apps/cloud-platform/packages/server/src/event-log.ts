import type Database from "better-sqlite3";
import { z } from "zod";
import { EVENT_CLOCK_TICK, type LotaruEvent } from "./events.js";

const EVENT_LOG_KEEP = 2000;
const EVENT_PAGE_MAX = 200;
const EVENT_PAGE_DEFAULT = 40;

/**
 * The clock fires every ten seconds — 8640 rows a day, per project. Under one
 * shared cap it evicts every event worth reading within hours, so it gets its
 * own much smaller budget and everything else keeps the full window.
 */
const EVENT_LOG_KEEP_CLOCK = 60;

const eventRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  project_id: z.string(),
  script_id: z.string(),
  path: z.string(),
  detail: z.string(),
  created_at: z.number(),
});

const cursorCreatedSchema = z
  .string()
  .regex(/^[0-9]+$/)
  .refine((raw) => {
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 && String(parsed) === raw;
  });

export type EventListInput = {
  projectId: string;
  limit: number;
  type: string;
  cursor: string;
};

export type EventListPage = {
  events: LotaruEvent[];
  next: string[];
};

export function ensureEventLogSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lotaru_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      project_id TEXT NOT NULL,
      script_id TEXT NOT NULL,
      path TEXT NOT NULL,
      detail TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lotaru_events_project ON lotaru_events(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_lotaru_events_project_cursor ON lotaru_events(project_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_lotaru_events_project_type ON lotaru_events(project_id, type, created_at DESC, id DESC);
  `);
}

function eventFromCell(cell: z.infer<typeof eventRowSchema>): LotaruEvent {
  return {
    id: cell.id,
    type: cell.type,
    projectId: cell.project_id,
    scriptId: cell.script_id,
    path: cell.path,
    detail: cell.detail,
    createdAt: cell.created_at,
  };
}

export function encodeEventCursor(createdAt: number, id: string): string {
  const packed = `${String(createdAt)}\n${id}`;
  if (id.trim().length === 0) {
    throw new Error("Invalid event cursor");
  }
  if (Number.isFinite(createdAt) !== true) {
    throw new Error("Invalid event cursor");
  }
  return Buffer.from(packed, "utf8").toString("base64url");
}

export function decodeEventCursor(raw: string): { createdAt: number; id: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Invalid event cursor");
  }
  const text = Buffer.from(trimmed, "base64url").toString("utf8");
  const parts = text.split("\n");
  if (parts.length !== 2) {
    throw new Error("Invalid event cursor");
  }
  const createdRaw = parts[0];
  const id = parts[1];
  if (createdRaw === undefined || id === undefined) {
    throw new Error("Invalid event cursor");
  }
  const createdOk = cursorCreatedSchema.safeParse(createdRaw);
  if (createdOk.success !== true) {
    throw new Error("Invalid event cursor");
  }
  if (id.trim().length === 0) {
    throw new Error("Invalid event cursor");
  }
  return { createdAt: Number.parseInt(createdRaw, 10), id };
}

function filterTypes(type: string): string[] {
  const trimmed = type.trim();
  if (trimmed.length === 0) {
    return [];
  }
  if (trimmed === EVENT_CLOCK_TICK || trimmed === "schedule.fired") {
    return [EVENT_CLOCK_TICK, "schedule.fired"];
  }
  return [trimmed];
}

function pageLimit(limit: number): number {
  if (Number.isFinite(limit) !== true) {
    return EVENT_PAGE_DEFAULT;
  }
  if (limit < 1) {
    return EVENT_PAGE_DEFAULT;
  }
  if (limit > EVENT_PAGE_MAX) {
    return EVENT_PAGE_MAX;
  }
  return limit;
}

export function recordEvent(db: Database.Database, event: LotaruEvent): void {
  db.prepare(
    "INSERT INTO lotaru_events (id, type, project_id, script_id, path, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    event.id,
    event.type,
    event.projectId,
    event.scriptId,
    event.path,
    event.detail,
    event.createdAt,
  );
  pruneEventLog(db, event.projectId);
}

export function pruneEventLog(db: Database.Database, projectId: string): void {
  db.prepare(
    `DELETE FROM lotaru_events
     WHERE project_id = ? AND type IN (?, ?)
       AND id NOT IN (
         SELECT id FROM (
           SELECT id FROM lotaru_events
           WHERE project_id = ? AND type IN (?, ?)
           ORDER BY created_at DESC, id DESC
           LIMIT ?
         )
       )`,
  ).run(
    projectId,
    EVENT_CLOCK_TICK,
    "schedule.fired",
    projectId,
    EVENT_CLOCK_TICK,
    "schedule.fired",
    EVENT_LOG_KEEP_CLOCK,
  );
  db.prepare(
    `DELETE FROM lotaru_events
     WHERE project_id = ? AND type NOT IN (?, ?)
       AND id NOT IN (
         SELECT id FROM (
           SELECT id FROM lotaru_events
           WHERE project_id = ? AND type NOT IN (?, ?)
           ORDER BY created_at DESC, id DESC
           LIMIT ?
         )
       )`,
  ).run(
    projectId,
    EVENT_CLOCK_TICK,
    "schedule.fired",
    projectId,
    EVENT_CLOCK_TICK,
    "schedule.fired",
    EVENT_LOG_KEEP,
  );
}

export function listProjectEvents(db: Database.Database, input: EventListInput): EventListPage {
  const take = pageLimit(input.limit);
  const types = filterTypes(input.type);
  let filterMode = "all";
  let typeA = EVENT_CLOCK_TICK;
  let typeB = "schedule.fired";
  if (types.length === 1) {
    filterMode = "one";
    const only = types[0];
    if (only !== undefined) {
      typeA = only;
      typeB = only;
    }
  }
  if (types.length === 2) {
    filterMode = "clock";
    const first = types[0];
    const second = types[1];
    if (first !== undefined) {
      typeA = first;
    }
    if (second !== undefined) {
      typeB = second;
    }
  }
  const cursorRaw = input.cursor.trim();
  let hasCursor = 0;
  let cursorAt = 0;
  let cursorId = "-";
  if (cursorRaw.length > 0) {
    const cursor = decodeEventCursor(cursorRaw);
    hasCursor = 1;
    cursorAt = cursor.createdAt;
    cursorId = cursor.id;
  }
  const rows = db
    .prepare(
      `SELECT id, type, project_id, script_id, path, detail, created_at
       FROM lotaru_events
       WHERE project_id = @projectId
         AND (
           @filterMode = 'all'
           OR (@filterMode = 'one' AND type = @typeA)
           OR (@filterMode = 'clock' AND (type = @typeA OR type = @typeB))
         )
         AND (
           @hasCursor = 0
           OR created_at < @cursorAt
           OR (created_at = @cursorAt AND id < @cursorId)
         )
       ORDER BY created_at DESC, id DESC
       LIMIT @take`,
    )
    .all({
      projectId: input.projectId,
      filterMode,
      typeA,
      typeB,
      hasCursor,
      cursorAt,
      cursorId,
      take: take + 1,
    });
  const events: LotaruEvent[] = [];
  for (const row of rows) {
    const parsed = eventRowSchema.safeParse(row);
    if (parsed.success !== true) {
      continue;
    }
    events[events.length] = eventFromCell(parsed.data);
  }
  const next: string[] = [];
  if (events.length > take) {
    const page = events.slice(0, take);
    const last = page[page.length - 1];
    if (last !== undefined) {
      return { events: page, next: [encodeEventCursor(last.createdAt, last.id)] };
    }
    return { events: page, next };
  }
  return { events, next };
}

export function eventsById(db: Database.Database, projectId: string, eventId: string): LotaruEvent[] {
  const row = db
    .prepare(
      "SELECT id, type, project_id, script_id, path, detail, created_at FROM lotaru_events WHERE id = ?",
    )
    .get(eventId);
  const parsed = eventRowSchema.safeParse(row);
  if (parsed.success !== true) {
    return [];
  }
  const cell = parsed.data;
  if (cell.project_id !== projectId) {
    return [];
  }
  return [eventFromCell(cell)];
}
