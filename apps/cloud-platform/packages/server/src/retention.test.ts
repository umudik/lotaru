import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { openVoiceDb } from "./modules/voice.js";
import {
  AGENT_RUN_OUTPUT_MAX,
  clampRunOutput,
  openAgentsDb,
  pruneAgentRuns,
} from "./modules/agents.js";
import { pruneVoiceSegments, scanCursor } from "./voice-retention.js";

const PROJECT = "proj-retention";

function voiceHarness(): ReturnType<typeof openVoiceDb> {
  const dir = mkdtempSync(join(tmpdir(), "lotaru-retention-"));
  return openVoiceDb(join(dir, "app.sqlite"));
}

/** Segment ids are sortable so the cursor comparison in the prune is testable. */
function segmentId(index: number): string {
  return `seg-${String(index).padStart(4, "0")}`;
}

function addSegments(db: ReturnType<typeof openVoiceDb>, count: number, from = 0): void {
  const insert = db.prepare(
    "INSERT INTO voice_segments (id, project_id, session_id, kind, text, started_at, ended_at, audio_path, created_at) VALUES (?, ?, ?, 'final', ?, 0, 0, '', ?)",
  );
  for (let index = from; index < from + count; index += 1) {
    insert.run(segmentId(index), PROJECT, "sess", `line ${String(index)}`, index);
  }
}

function segmentCount(db: ReturnType<typeof openVoiceDb>): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM voice_segments WHERE project_id = ?")
    .get(PROJECT) as { n: number };
  return row.n;
}

function setCursor(db: ReturnType<typeof openVoiceDb>, index: number): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS voice_batch_state (
      project_id TEXT PRIMARY KEY,
      last_scan_at INTEGER NOT NULL DEFAULT 0,
      last_created_at INTEGER NOT NULL DEFAULT 0,
      last_segment_id TEXT NOT NULL DEFAULT ''
    );
  `);
  db.prepare(
    `INSERT INTO voice_batch_state (project_id, last_scan_at, last_created_at, last_segment_id)
     VALUES (?, 0, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       last_created_at = excluded.last_created_at,
       last_segment_id = excluded.last_segment_id`,
  ).run(PROJECT, index, segmentId(index));
}

describe("voice segment retention", () => {
  it("keeps the newest window when no scanner has ever run", () => {
    const db = voiceHarness();
    addSegments(db, 10);
    assert.equal(scanCursor(db, PROJECT), null);

    const removed = pruneVoiceSegments(db, PROJECT, 4);
    assert.equal(removed, 6);
    assert.equal(segmentCount(db), 4);

    const oldest = db
      .prepare(
        "SELECT id FROM voice_segments WHERE project_id = ? ORDER BY created_at ASC LIMIT 1",
      )
      .get(PROJECT) as { id: string };
    assert.equal(oldest.id, segmentId(6));
  });

  it("never drops a line the scanner has not read yet", () => {
    const db = voiceHarness();
    addSegments(db, 10);
    // The scanner stalled after line 2, so 3..9 are still owed a pass.
    setCursor(db, 2);

    const removed = pruneVoiceSegments(db, PROJECT, 4);
    assert.equal(removed, 3);
    assert.equal(segmentCount(db), 7);

    const survivors = db
      .prepare("SELECT id FROM voice_segments WHERE project_id = ? ORDER BY created_at ASC")
      .all(PROJECT) as { id: string }[];
    assert.equal(survivors[0]?.id, segmentId(3));
  });

  it("prunes nothing while every line is still pending", () => {
    const db = voiceHarness();
    addSegments(db, 10);
    setCursor(db, -1);
    assert.equal(pruneVoiceSegments(db, PROJECT, 2), 0);
    assert.equal(segmentCount(db), 10);
  });

  it("resumes pruning once the scanner catches up", () => {
    const db = voiceHarness();
    addSegments(db, 10);
    setCursor(db, -1);
    assert.equal(pruneVoiceSegments(db, PROJECT, 4), 0);

    setCursor(db, 9);
    assert.equal(pruneVoiceSegments(db, PROJECT, 4), 6);
    assert.equal(segmentCount(db), 4);
  });

  it("leaves another project's lines alone", () => {
    const db = voiceHarness();
    addSegments(db, 6);
    db.prepare(
      "INSERT INTO voice_segments (id, project_id, session_id, kind, text, started_at, ended_at, audio_path, created_at) VALUES ('other', 'proj-other', 'sess', 'final', 'x', 0, 0, '', 0)",
    ).run();

    pruneVoiceSegments(db, PROJECT, 2);
    const other = db
      .prepare("SELECT COUNT(*) AS n FROM voice_segments WHERE project_id = 'proj-other'")
      .get() as { n: number };
    assert.equal(other.n, 1);
  });
});

describe("agent run retention", () => {
  it("keeps the newest runs and drops the rest", () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-retention-runs-"));
    const db = openAgentsDb(join(dir, "app.sqlite"));
    const agentId = randomUUID();
    db.prepare(
      "INSERT INTO lotaru_agents (id, project_id, title, slug, prompt, trigger_kind, event_type, schedule_hour, schedule_minute, include_voice, action, note_book_title, enabled, created_at, created_by) VALUES (?, ?, 'A', 'a', 'p', 'event', 'task.created', 21, 0, 0, 'none', '', 1, 'now', 'test')",
    ).run(agentId, PROJECT);
    const insert = db.prepare(
      "INSERT INTO lotaru_agent_runs (id, agent_id, project_id, status, output, error, started_at, finished_at) VALUES (?, ?, ?, 'done', '', '', ?, '')",
    );
    for (let index = 0; index < 12; index += 1) {
      insert.run(`run-${String(index).padStart(3, "0")}`, agentId, PROJECT, `2026-01-${String(index + 1).padStart(2, "0")}`);
    }

    assert.equal(pruneAgentRuns(db, agentId, 5), 7);
    const rows = db
      .prepare("SELECT id FROM lotaru_agent_runs WHERE agent_id = ? ORDER BY started_at ASC")
      .all(agentId) as { id: string }[];
    assert.equal(rows.length, 5);
    assert.equal(rows[0]?.id, "run-007");
  });

  it("leaves another agent's runs alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-retention-runs2-"));
    const db = openAgentsDb(join(dir, "app.sqlite"));
    const insertAgent = db.prepare(
      "INSERT INTO lotaru_agents (id, project_id, title, slug, prompt, trigger_kind, event_type, schedule_hour, schedule_minute, include_voice, action, note_book_title, enabled, created_at, created_by) VALUES (?, ?, ?, ?, 'p', 'event', 'task.created', 21, 0, 0, 'none', '', 1, 'now', 'test')",
    );
    const kept = randomUUID();
    const other = randomUUID();
    insertAgent.run(kept, PROJECT, "A", "a");
    insertAgent.run(other, PROJECT, "B", "b");
    const insert = db.prepare(
      "INSERT INTO lotaru_agent_runs (id, agent_id, project_id, status, output, error, started_at, finished_at) VALUES (?, ?, ?, 'done', '', '', ?, '')",
    );
    for (let index = 0; index < 4; index += 1) {
      insert.run(`a-${String(index)}`, kept, PROJECT, `2026-01-0${String(index + 1)}`);
      insert.run(`b-${String(index)}`, other, PROJECT, `2026-01-0${String(index + 1)}`);
    }

    pruneAgentRuns(db, kept, 1);
    const remaining = db
      .prepare("SELECT COUNT(*) AS n FROM lotaru_agent_runs WHERE agent_id = ?")
      .get(other) as { n: number };
    assert.equal(remaining.n, 4);
  });
});

describe("clampRunOutput", () => {
  it("leaves a normal reply untouched", () => {
    assert.equal(clampRunOutput("a short reply"), "a short reply");
  });

  it("marks a reply it had to cut", () => {
    const long = "x".repeat(AGENT_RUN_OUTPUT_MAX + 500);
    const clamped = clampRunOutput(long);
    assert.equal(clamped.length < long.length, true);
    assert.match(clamped, /\[truncated\]$/);
  });
});
