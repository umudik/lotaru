import Database from "better-sqlite3";
import { publishLotaruEvent, type LotaruPublishInput } from "./event-bus.js";
import { EVENT_VOICE_BATCH, ruleEventType, type LotaruEvent } from "./events.js";
import { runLocalOllamaPrompt } from "./agent-prompt.js";
import { cachedSqlite } from "./sqlite-cache.js";
import {
  listEnabledVoiceRules,
  openVoiceRulesDb,
  recordRuleHit,
} from "./voice-rule-store.js";
import {
  parseVoiceRuleMatches,
  voiceRulePrompt,
  VOICE_RULE_SYSTEM,
  type VoiceRule,
  type VoiceRuleMatch,
} from "./voice-rules.js";

/** How long the scanner lets transcript lines pile up before it reads them. */
export const VOICE_BATCH_INTERVAL_MS = 120_000;

/** Newest-first cap so one long session cannot blow up the prompt. */
export const VOICE_BATCH_MAX_SEGMENTS = 120;

export type VoiceScanResult = {
  ran: boolean;
  scanned: number;
  matched: number;
  skipped: string;
};

type PendingSegment = {
  id: string;
  text: string;
  createdAt: number;
};

type BatchStateRow = {
  project_id: string;
  last_created_at: number;
  last_segment_id: string;
};

type EmitFn = (partial: LotaruPublishInput) => LotaruEvent;

function openBatchDb(databasePath: string): Database.Database {
  return cachedSqlite("voice-batch", databasePath, (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS voice_batch_state (
        project_id TEXT PRIMARY KEY,
        last_scan_at INTEGER NOT NULL DEFAULT 0
      );
    `);
    const columns = db.prepare("PRAGMA table_info(voice_batch_state)").all() as { name: string }[];
    let hasCreatedAt = false;
    let hasSegmentId = false;
    for (const column of columns) {
      if (column.name === "last_created_at") {
        hasCreatedAt = true;
      }
      if (column.name === "last_segment_id") {
        hasSegmentId = true;
      }
    }
    if (hasCreatedAt !== true) {
      db.exec(
        "ALTER TABLE voice_batch_state ADD COLUMN last_created_at INTEGER NOT NULL DEFAULT 0",
      );
      db.exec("UPDATE voice_batch_state SET last_created_at = last_scan_at");
    }
    if (hasSegmentId !== true) {
      db.exec("ALTER TABLE voice_batch_state ADD COLUMN last_segment_id TEXT NOT NULL DEFAULT ''");
    }
  });
}

function readState(db: Database.Database, projectId: string): BatchStateRow {
  const row = db
    .prepare(
      "SELECT project_id, last_created_at, last_segment_id FROM voice_batch_state WHERE project_id = ?",
    )
    .get(projectId) as BatchStateRow | undefined;
  if (row === undefined) {
    return { project_id: projectId, last_created_at: 0, last_segment_id: "" };
  }
  return row;
}

function readLastScanAt(db: Database.Database, projectId: string): number {
  const row = db
    .prepare("SELECT last_scan_at FROM voice_batch_state WHERE project_id = ?")
    .get(projectId) as { last_scan_at: number } | undefined;
  if (row === undefined) {
    return 0;
  }
  return row.last_scan_at;
}

/**
 * The cursor advances to the last segment actually read, never to wall-clock
 * time — lines that arrive while the model is thinking must survive to the
 * next scan.
 */
function writeCursor(
  db: Database.Database,
  projectId: string,
  scannedAt: number,
  last: PendingSegment | null,
): void {
  const state = readState(db, projectId);
  let createdAt = state.last_created_at;
  let segmentId = state.last_segment_id;
  if (last !== null) {
    createdAt = last.createdAt;
    segmentId = last.id;
  }
  db.prepare(
    `INSERT INTO voice_batch_state (project_id, last_scan_at, last_created_at, last_segment_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       last_scan_at = excluded.last_scan_at,
       last_created_at = excluded.last_created_at,
       last_segment_id = excluded.last_segment_id`,
  ).run(projectId, scannedAt, createdAt, segmentId);
}

function listPendingSegments(
  db: Database.Database,
  state: BatchStateRow,
): PendingSegment[] {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'voice_segments'")
    .get() as { name: string } | undefined;
  if (table === undefined) {
    return [];
  }
  const rows = db
    .prepare(
      `SELECT id, text, created_at FROM voice_segments
       WHERE kind = 'final'
         AND (created_at > ? OR (created_at = ? AND id > ?))
       ORDER BY created_at ASC, id ASC
       LIMIT ?`,
    )
    .all(
      state.last_created_at,
      state.last_created_at,
      state.last_segment_id,
      VOICE_BATCH_MAX_SEGMENTS,
    ) as { id: string; text: string; created_at: number }[];
  const pending: PendingSegment[] = [];
  for (const row of rows) {
    if (row.text.trim().length === 0) {
      continue;
    }
    pending.push({ id: row.id, text: row.text.trim(), createdAt: row.created_at });
  }
  return pending;
}

/**
 * Every match is emitted. Deciding whether two asks are "the same thing" is a
 * judgement call, and this layer has no business making it — the subscriber
 * reading the event does.
 */
function emitRuleMatch(input: {
  databasePath: string;
  projectId: string;
  rule: VoiceRule;
  match: VoiceRuleMatch;
  emit: EmitFn;
}): void {
  let title = input.match.title;
  if (title.length === 0) {
    title = input.match.summary.slice(0, 120);
  }
  const event = input.emit({
    type: ruleEventType(input.rule.slug),
    projectId: input.projectId,
    path: title.slice(0, 240),
    detail: input.match.summary.slice(0, 500),
  });
  recordRuleHit(openVoiceRulesDb(input.databasePath), {
    projectId: input.projectId,
    ruleId: input.rule.id,
    match: input.match,
    eventId: event.id,
  });
}

export async function scanVoiceBatchForProject(input: {
  databasePath: string;
  projectId: string;
  force?: boolean;
  now?: number;
  runScanner?: (payload: { systemPrompt: string; prompt: string }) => Promise<string>;
  emit?: EmitFn;
}): Promise<VoiceScanResult> {
  let emit: EmitFn;
  if (input.emit !== undefined) {
    emit = input.emit;
  } else {
    emit = (partial) => publishLotaruEvent(partial, "live");
  }
  let now = Date.now();
  if (input.now !== undefined) {
    now = input.now;
  }
  const force = input.force === true;
  const rules = listEnabledVoiceRules(openVoiceRulesDb(input.databasePath), input.projectId);
  if (rules.length === 0) {
    return { ran: false, scanned: 0, matched: 0, skipped: "no enabled rules" };
  }
  const db = openBatchDb(input.databasePath);
  const lastScanAt = readLastScanAt(db, input.projectId);
  if (force !== true && now - lastScanAt < VOICE_BATCH_INTERVAL_MS) {
    return { ran: false, scanned: 0, matched: 0, skipped: "waiting for the next scan window" };
  }
  const pending = listPendingSegments(db, readState(db, input.projectId));
  if (pending.length === 0) {
    // Still stamp the scan time so an idle project does not re-check every tick.
    writeCursor(db, input.projectId, now, null);
    return { ran: false, scanned: 0, matched: 0, skipped: "no new transcript lines" };
  }
  const lines: string[] = [];
  for (const segment of pending) {
    lines.push(segment.text);
  }
  const transcript = lines.join("\n");
  const prompt = voiceRulePrompt({ transcript, rules });
  let raw = "";
  try {
    if (input.runScanner !== undefined) {
      raw = await input.runScanner({ systemPrompt: VOICE_RULE_SYSTEM, prompt });
    } else {
      // Whichever engine Settings points at: local Ollama, or a CLI agent.
      raw = await runLocalOllamaPrompt({
        databasePath: input.databasePath,
        systemPrompt: VOICE_RULE_SYSTEM,
        prompt,
      });
    }
  } catch (err: unknown) {
    // Leave the cursor alone: these lines get another chance once the model is
    // reachable again.
    const message = err instanceof Error ? err.message : "scanner unavailable";
    return { ran: false, scanned: pending.length, matched: 0, skipped: message };
  }
  const matches = parseVoiceRuleMatches(raw, rules);
  // Advance past the lines the model already read before emitting anything. The
  // model call is the part that fails; publishing is local. Doing it in this
  // order means a crash mid-publish drops events rather than replaying the whole
  // batch and double-firing every subscriber.
  writeCursor(db, input.projectId, now, pending[pending.length - 1]);
  let matched = 0;
  for (const match of matches) {
    let rule: VoiceRule | null = null;
    for (const entry of rules) {
      if (entry.slug === match.slug) {
        rule = entry;
      }
    }
    if (rule === null) {
      continue;
    }
    emitRuleMatch({
      databasePath: input.databasePath,
      projectId: input.projectId,
      rule,
      match,
      emit,
    });
    matched += 1;
  }
  emit({
    type: EVENT_VOICE_BATCH,
    projectId: input.projectId,
    path: String(pending.length),
    detail: `${String(matched)} rule match(es) from ${String(pending.length)} transcript line(s)`,
  });
  return { ran: true, scanned: pending.length, matched, skipped: "" };
}

export async function tickVoiceBatchScans(input: {
  databasePath: string;
  projectIds: readonly string[];
}): Promise<void> {
  for (const projectId of input.projectIds) {
    if (projectId.length === 0) {
      continue;
    }
    await scanVoiceBatchForProject({
      databasePath: input.databasePath,
      projectId,
    });
  }
}
