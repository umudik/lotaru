import type Database from "better-sqlite3";
import { z } from "zod";
import type { LotaruEvent } from "./events.js";

const EVENT_LOG_KEEP = 2000;

const eventRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  project_id: z.string(),
  script_id: z.string(),
  path: z.string(),
  detail: z.string(),
  created_at: z.number(),
});

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
  `);
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
  db.prepare(
    "DELETE FROM lotaru_events WHERE project_id = ? AND id NOT IN (SELECT id FROM (SELECT id FROM lotaru_events WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?))",
  ).run(event.projectId, event.projectId, EVENT_LOG_KEEP);
}

export function listProjectEvents(db: Database.Database, projectId: string, limit: number): LotaruEvent[] {
  let take = 50;
  if (Number.isFinite(limit) && limit > 0 && limit <= 200) {
    take = limit;
  }
  const rows = db
    .prepare(
      "SELECT id, type, project_id, script_id, path, detail, created_at FROM lotaru_events WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
    )
    .all(projectId, take);
  const events: LotaruEvent[] = [];
  for (const row of rows) {
    const parsed = eventRowSchema.safeParse(row);
    if (parsed.success !== true) {
      continue;
    }
    const cell = parsed.data;
    events.push({
      id: cell.id,
      type: cell.type,
      projectId: cell.project_id,
      scriptId: cell.script_id,
      path: cell.path,
      detail: cell.detail,
      createdAt: cell.created_at,
    });
  }
  return events;
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
  return [
    {
      id: cell.id,
      type: cell.type,
      projectId: cell.project_id,
      scriptId: cell.script_id,
      path: cell.path,
      detail: cell.detail,
      createdAt: cell.created_at,
    },
  ];
}
