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

/**
 * Where the rule scanner has read up to, or null when it has never run for this
 * project — in which case no line is pending and the window applies to all of
 * them.
 */
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

/** Drops scanned lines that have fallen out of the newest VOICE_SEGMENT_KEEP. */
export function pruneVoiceSegments(
  db: Database.Database,
  projectId: string,
  keep: number = VOICE_SEGMENT_KEEP,
): number {
  const survivors = `
    SELECT id FROM voice_segments
     WHERE project_id = @projectId
     ORDER BY created_at DESC, id DESC
     LIMIT @keep
  `;
  const cursor = scanCursor(db, projectId);
  if (cursor === null) {
    const result = db
      .prepare(
        `DELETE FROM voice_segments
          WHERE project_id = @projectId
            AND id NOT IN (${survivors})`,
      )
      .run({ projectId, keep });
    return result.changes;
  }
  const result = db
    .prepare(
      `DELETE FROM voice_segments
        WHERE project_id = @projectId
          AND (
            created_at < @cursorCreatedAt
            OR (created_at = @cursorCreatedAt AND id <= @cursorSegmentId)
          )
          AND id NOT IN (${survivors})`,
    )
    .run({
      projectId,
      keep,
      cursorCreatedAt: cursor.createdAt,
      cursorSegmentId: cursor.segmentId,
    });
  return result.changes;
}
