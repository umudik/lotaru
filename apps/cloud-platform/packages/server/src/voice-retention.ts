import type Database from "better-sqlite3";

/**
 * Listening writes one row per spoken line and nothing ever read them back out,
 * so the transcript grew for as long as the app ran. It keeps a window now, the
 * way the events log does.
 *
 * The one thing it must not do is forget a line the rule scanner has not read
 * yet. The scanner walks a cursor through voice_segments; a row past that
 * cursor is still owed a pass, and deleting it would drop something the speaker
 * said before any rule ever saw it. So the window only ever closes over lines
 * that have already been scanned — and when the scanner is stalled, nothing is
 * pruned at all. Growth while the engine is down is the lesser problem.
 */
export const VOICE_SEGMENT_KEEP = 20_000;

type ScanCursor = {
  createdAt: number;
  segmentId: string;
};

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined;
  return row !== undefined;
}

export function scanCursor(db: Database.Database, projectId: string): ScanCursor | null {
  if (tableExists(db, "voice_batch_state") !== true) {
    return null;
  }
  const row = db
    .prepare(
      "SELECT last_created_at, last_segment_id FROM voice_batch_state WHERE project_id = ?",
    )
    .get(projectId) as { last_created_at: number; last_segment_id: string } | undefined;
  if (row === undefined) {
    return null;
  }
  return { createdAt: row.last_created_at, segmentId: row.last_segment_id };
}

export function slowestScanCursor(db: Database.Database): ScanCursor | null {
  if (tableExists(db, "voice_batch_state") !== true) {
    return null;
  }
  const rows = db
    .prepare("SELECT last_created_at, last_segment_id FROM voice_batch_state")
    .all() as { last_created_at: number; last_segment_id: string }[];
  if (Array.isArray(rows) !== true || rows.length === 0) {
    return null;
  }
  let slowest: ScanCursor | null = null;
  for (const row of rows) {
    const candidate: ScanCursor = {
      createdAt: row.last_created_at,
      segmentId: row.last_segment_id,
    };
    if (slowest === null) {
      slowest = candidate;
      continue;
    }
    if (candidate.createdAt < slowest.createdAt) {
      slowest = candidate;
      continue;
    }
    if (candidate.createdAt === slowest.createdAt && candidate.segmentId < slowest.segmentId) {
      slowest = candidate;
    }
  }
  return slowest;
}

export function pruneVoiceSegments(
  db: Database.Database,
  keep: number = VOICE_SEGMENT_KEEP,
): number {
  const survivors = `
    SELECT id FROM voice_segments
     ORDER BY created_at DESC, id DESC
     LIMIT @keep
  `;
  const cursor = slowestScanCursor(db);
  if (cursor === null) {
    const result = db
      .prepare(
        `DELETE FROM voice_segments
          WHERE id NOT IN (${survivors})`,
      )
      .run({ keep });
    return result.changes;
  }
  const result = db
    .prepare(
      `DELETE FROM voice_segments
        WHERE (
            created_at < @cursorCreatedAt
            OR (created_at = @cursorCreatedAt AND id <= @cursorSegmentId)
          )
          AND id NOT IN (${survivors})`,
    )
    .run({
      keep,
      cursorCreatedAt: cursor.createdAt,
      cursorSegmentId: cursor.segmentId,
    });
  return result.changes;
}
