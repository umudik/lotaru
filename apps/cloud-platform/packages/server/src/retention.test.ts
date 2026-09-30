import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  AGENT_RUN_OUTPUT_MAX,
  clampRunOutput,
  openAgentsDb,
  pruneAgentRuns,
} from "./modules/agents.js";

const PROJECT = "proj-retention";

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
