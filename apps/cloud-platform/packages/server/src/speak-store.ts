import { randomUUID } from "node:crypto";
import { z } from "zod";
import { cachedSqlite } from "./sqlite-cache.js";
import { USER_IO_STREAM } from "./user-io.js";

export const SPEAK_SOURCES = ["ui", "mcp", "note"] as const;
export const SPEAK_STATUSES = ["queued", "ready", "played", "failed"] as const;
export const SPEAK_KEEP = 50;
export const SPEAK_QUEUE_FULL = "Speak queue is full";
export const SPEAK_ALREADY_FAILED = "Speak already failed";

export type SpeakSource = (typeof SPEAK_SOURCES)[number];
export type SpeakStatus = (typeof SPEAK_STATUSES)[number];

export type SpeakUtterance = {
  id: string;
  projectId: string;
  text: string;
  source: SpeakSource;
  status: SpeakStatus;
  error: string;
  createdAt: number;
  createdBy: string;
};

const SPEAK_TEXT_MAX = 4000;
const SPEAK_ROW_SQL =
  "id, project_id, text, source, status, error, created_at, created_by";

export const sourceSchema = z.enum(SPEAK_SOURCES);
export const statusSchema = z.enum(SPEAK_STATUSES);

const utteranceRowSchema = z.object({
  id: z.string().min(1),
  project_id: z.string().min(1),
  text: z.string(),
  source: sourceSchema,
  status: statusSchema,
  error: z.string(),
  created_at: z.number(),
  created_by: z.string(),
});

export type EnqueueSpeakInput = {
  projectId: string;
  text: string;
  source: SpeakSource;
  createdBy: string;
};

export function openSpeakDb(databasePath: string) {
  return cachedSqlite("speak", databasePath, (db) => {
    db.pragma("busy_timeout = 5000");
    db.exec(`
      CREATE TABLE IF NOT EXISTS speak_utterances (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        text TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        created_by TEXT NOT NULL,
        audio BLOB
      );
      CREATE INDEX IF NOT EXISTS idx_speak_project_created
        ON speak_utterances(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_speak_project_status
        ON speak_utterances(project_id, status, created_at ASC);
    `);
  });
}

function rowToUtterance(row: unknown): SpeakUtterance {
  const parsed = utteranceRowSchema.safeParse(row);
  if (parsed.success !== true) {
    throw new Error("Invalid speak utterance row");
  }
  return {
    id: parsed.data.id,
    projectId: parsed.data.project_id,
    text: parsed.data.text,
    source: parsed.data.source,
    status: parsed.data.status,
    error: parsed.data.error,
    createdAt: parsed.data.created_at,
    createdBy: parsed.data.created_by,
  };
}

function rowsToUtterances(rows: readonly unknown[]): SpeakUtterance[] {
  const utterances: SpeakUtterance[] = [];
  for (const row of rows) {
    utterances.push(rowToUtterance(row));
  }
  return utterances;
}

function playableNewestFirst(playable: readonly SpeakUtterance[]): SpeakUtterance[] {
  const newest: SpeakUtterance[] = [];
  let index = playable.length;
  while (index > 0) {
    index -= 1;
    const row = playable[index];
    if (row === undefined) {
      continue;
    }
    newest.push(row);
  }
  return newest;
}

function mergeSpeakRecent(
  playable: readonly SpeakUtterance[],
  history: readonly SpeakUtterance[],
): SpeakUtterance[] {
  const seen = new Set<string>();
  const merged: SpeakUtterance[] = [];
  const newestPlayable = playableNewestFirst(playable);
  for (const row of newestPlayable) {
    seen.add(row.id);
    merged.push(row);
  }
  for (const row of history) {
    if (seen.has(row.id) === true) {
      continue;
    }
    merged.push(row);
  }
  return merged;
}

function requireSpeakUtterance(databasePath: string, id: string): SpeakUtterance {
  const stored = getSpeakUtterance(databasePath, id);
  if (stored === undefined) {
    throw new Error("speak utterance missing");
  }
  return stored;
}

function countSpeakPlayable(databasePath: string): number {
  const db = openSpeakDb(databasePath);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS queued
       FROM speak_utterances
       WHERE status IN ('queued', 'ready')`,
    )
    .get();
  const parsed = z.object({ queued: z.coerce.number().int().nonnegative() }).safeParse(row);
  if (parsed.success !== true) {
    throw new Error("Invalid speak queue count");
  }
  return parsed.data.queued;
}

function clipSpeakText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Nothing to read");
  }
  if (trimmed.length <= SPEAK_TEXT_MAX) {
    return trimmed;
  }
  return trimmed.slice(0, SPEAK_TEXT_MAX);
}

function pruneSpeakHistory(databasePath: string): void {
  const db = openSpeakDb(databasePath);
  db.prepare(
    `DELETE FROM speak_utterances
     WHERE id IN (
       SELECT id FROM (
         SELECT id FROM speak_utterances
         WHERE status IN ('played', 'failed')
         ORDER BY created_at DESC, rowid DESC
         LIMIT -1 OFFSET ?
       ) overflow
     )`,
  ).run(SPEAK_KEEP);
}

export function enqueueSpeakUtterance(
  databasePath: string,
  input: EnqueueSpeakInput,
): SpeakUtterance {
  const text = clipSpeakText(input.text);
  if (countSpeakPlayable(databasePath) >= SPEAK_KEEP) {
    throw new Error(SPEAK_QUEUE_FULL);
  }
  const sourceParsed = sourceSchema.safeParse(input.source);
  if (sourceParsed.success !== true) {
    throw new Error("Invalid speak source");
  }
  const createdBy = input.createdBy.trim();
  let actor = createdBy;
  if (actor.length === 0) {
    actor = "lotaru";
  }
  const id = randomUUID();
  const createdAt = Date.now();
  const db = openSpeakDb(databasePath);
  db.prepare(
    `INSERT INTO speak_utterances
      (id, project_id, text, source, status, error, created_at, created_by, audio)
     VALUES (?, ?, ?, ?, 'queued', '', ?, ?, NULL)`,
  ).run(id, USER_IO_STREAM, text, sourceParsed.data, createdAt, actor);
  pruneSpeakHistory(databasePath);
  return requireSpeakUtterance(databasePath, id);
}

export function getSpeakUtterance(
  databasePath: string,
  id: string,
): SpeakUtterance | undefined {
  const parsedId = z.string().trim().min(1).safeParse(id);
  if (parsedId.success !== true) {
    return undefined;
  }
  const db = openSpeakDb(databasePath);
  const row = db
    .prepare(
      `SELECT ${SPEAK_ROW_SQL}
       FROM speak_utterances WHERE id = ?`,
    )
    .get(parsedId.data);
  if (row === undefined) {
    return undefined;
  }
  return rowToUtterance(row);
}

export function listSpeakUtterances(
  databasePath: string,
  status: SpeakStatus | undefined,
): SpeakUtterance[] {
  const db = openSpeakDb(databasePath);
  if (status !== undefined) {
    const filtered = db
      .prepare(
        `SELECT ${SPEAK_ROW_SQL}
         FROM speak_utterances WHERE status = ?
         ORDER BY created_at ASC, rowid ASC LIMIT ?`,
      )
      .all(status, SPEAK_KEEP);
    return rowsToUtterances(filtered);
  }
  const playable = listSpeakPlayable(databasePath);
  const historyRows = db
    .prepare(
      `SELECT ${SPEAK_ROW_SQL}
       FROM speak_utterances
       WHERE status IN ('played', 'failed')
       ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(SPEAK_KEEP);
  return mergeSpeakRecent(playable, rowsToUtterances(historyRows));
}

export function listSpeakPlayable(
  databasePath: string,
): SpeakUtterance[] {
  const db = openSpeakDb(databasePath);
  const rows = db
    .prepare(
      `SELECT ${SPEAK_ROW_SQL}
       FROM speak_utterances
       WHERE status IN ('queued', 'ready')
       ORDER BY created_at ASC, rowid ASC LIMIT ?`,
    )
    .all(SPEAK_KEEP);
  return rowsToUtterances(rows);
}

export function saveSpeakAudio(
  databasePath: string,
  id: string,
  audio: Buffer,
): SpeakUtterance {
  if (audio.byteLength === 0) {
    throw new Error("Speech failed");
  }
  const db = openSpeakDb(databasePath);
  const written = db
    .prepare(
      `UPDATE speak_utterances
       SET audio = ?, status = 'ready', error = ''
       WHERE id = ? AND status IN ('queued', 'ready', 'failed')`,
    )
    .run(audio, id);
  if (written.changes === 0) {
    throw new Error("speak utterance missing");
  }
  return requireSpeakUtterance(databasePath, id);
}

export function failSpeakUtterance(
  databasePath: string,
  id: string,
  message: string,
): SpeakUtterance {
  let errorText = message.trim();
  if (errorText.length === 0) {
    errorText = "Speech failed";
  }
  const db = openSpeakDb(databasePath);
  db.prepare(
    `UPDATE speak_utterances SET status = 'failed', error = ?
     WHERE id = ? AND status IN ('queued', 'ready', 'failed')`,
  ).run(errorText.slice(0, 500), id);
  return requireSpeakUtterance(databasePath, id);
}

export function markSpeakPlayed(databasePath: string, id: string): SpeakUtterance {
  const stored = requireSpeakUtterance(databasePath, id);
  if (stored.status === "played") {
    return stored;
  }
  if (stored.status === "failed") {
    throw new Error(SPEAK_ALREADY_FAILED);
  }
  const db = openSpeakDb(databasePath);
  const written = db
    .prepare(
      `UPDATE speak_utterances SET status = 'played'
       WHERE id = ? AND status IN ('queued', 'ready')`,
    )
    .run(id);
  if (written.changes === 0) {
    throw new Error("speak utterance missing");
  }
  return requireSpeakUtterance(databasePath, id);
}

function audioBufferFromCell(cell: unknown): Buffer | undefined {
  if (cell instanceof Buffer) {
    if (cell.byteLength === 0) {
      return undefined;
    }
    return cell;
  }
  if (cell instanceof Uint8Array) {
    if (cell.byteLength === 0) {
      return undefined;
    }
    return Buffer.from(cell);
  }
  return undefined;
}

export function loadSpeakAudio(databasePath: string, id: string): Buffer | undefined {
  const db = openSpeakDb(databasePath);
  const row = db.prepare("SELECT audio FROM speak_utterances WHERE id = ?").get(id);
  const parsed = z.object({ audio: z.unknown() }).safeParse(row);
  if (parsed.success !== true) {
    return undefined;
  }
  return audioBufferFromCell(parsed.data.audio);
}
