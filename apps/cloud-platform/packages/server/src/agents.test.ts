import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { createIdentity } from "./modules/identity.js";
import {
  openAgentsDb,
  recoverStaleAgentRuns,
  registerAgentsModule,
  scheduleIsDue,
} from "./modules/agents.js";

describe("scheduleIsDue", () => {
  it("is false before scheduled hour", () => {
    const now = new Date(2026, 7, 21, 20, 59, 0);
    assert.equal(scheduleIsDue({ scheduleHour: 21, scheduleMinute: 0 }, now), false);
  });

  it("is true at scheduled minute", () => {
    const now = new Date(2026, 7, 21, 21, 0, 0);
    assert.equal(scheduleIsDue({ scheduleHour: 21, scheduleMinute: 0 }, now), true);
  });

  it("is true after scheduled time same day", () => {
    const now = new Date(2026, 7, 21, 22, 15, 0);
    assert.equal(scheduleIsDue({ scheduleHour: 21, scheduleMinute: 0 }, now), true);
  });

  it("is false on the wrong weekday even after the clock time", () => {
    const now = new Date(2026, 8, 8, 18, 0, 0);
    assert.equal(now.getDay(), 2);
    assert.equal(
      scheduleIsDue({ scheduleHour: 9, scheduleMinute: 0, scheduleCron: "0 9 * * 1" }, now),
      false,
    );
    const monday = new Date(2026, 8, 7, 18, 0, 0);
    assert.equal(monday.getDay(), 1);
    assert.equal(
      scheduleIsDue({ scheduleHour: 9, scheduleMinute: 0, scheduleCron: "0 9 * * 1" }, monday),
      true,
    );
  });
});

describe("recoverStaleAgentRuns", () => {
  it("marks long-running rows as error", () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-agents-stale-"));
    const databasePath = join(dir, "app.sqlite");
    const db = openAgentsDb(databasePath);
    const agentId = randomUUID();
    db.prepare(
      "INSERT INTO lotaru_agents (id, project_id, title, prompt, trigger_kind, event_type, schedule_hour, schedule_minute, include_voice, note_book_title, enabled, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      agentId,
      "proj-a",
      "Daily",
      "Write journal",
      "schedule",
      "",
      21,
      0,
      0,
      "",
      1,
      new Date().toISOString(),
      "test@example.com",
    );
    const runId = randomUUID();
    const staleStart = new Date(Date.now() - 300_000).toISOString();
    db.prepare(
      "INSERT INTO lotaru_agent_runs (id, agent_id, project_id, status, output, error, started_at, finished_at) VALUES (?, ?, ?, ?, '', '', ?, '')",
    ).run(runId, agentId, "proj-a", "running", staleStart);
    recoverStaleAgentRuns(db);
    const row = db
      .prepare("SELECT status, error FROM lotaru_agent_runs WHERE id = ?")
      .get(runId) as { status: string; error: string };
    assert.equal(row.status, "error");
    assert.match(row.error, /interrupted/i);
  });
});

describe("manual agent run", () => {
  it("returns 409 while the same agent is already running", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-agents-run-"));
    const databasePath = join(dir, "app.sqlite");
    const db = openAgentsDb(databasePath);
    const agentId = randomUUID();
    db.prepare(
      "INSERT INTO lotaru_agents (id, project_id, title, prompt, trigger_kind, event_type, schedule_hour, schedule_minute, include_voice, note_book_title, enabled, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      agentId,
      "proj-a",
      "Manual",
      "Summarize",
      "event",
      "clock.tick",
      21,
      0,
      0,
      "",
      1,
      new Date().toISOString(),
      "test@example.com",
    );
    const app = Fastify({ logger: false });
    const identity = await createIdentity({
      publicUrl: "http://127.0.0.1:4317",
      dataDir: dir,
    });
    let release: () => void = () => {
      return;
    };
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await registerAgentsModule(app, {
      databasePath,
      identity,
      projectAccess: () => true,
      projectCwd: () => dir,
      runAgent: async () => {
        await gate;
        return "done";
      },
    });
    t.after(async () => {
      release();
      await app.close();
    });
    const first = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/run`,
    });
    assert.equal(first.statusCode, 202);
    const second = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/run`,
    });
    assert.equal(second.statusCode, 409);
    release();
  });

  it("returns 409 when a db run row is still running", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-agents-db-run-"));
    const databasePath = join(dir, "app.sqlite");
    const db = openAgentsDb(databasePath);
    const agentId = randomUUID();
    db.prepare(
      "INSERT INTO lotaru_agents (id, project_id, title, prompt, trigger_kind, event_type, schedule_hour, schedule_minute, include_voice, note_book_title, enabled, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      agentId,
      "proj-a",
      "Manual",
      "Summarize",
      "event",
      "clock.tick",
      21,
      0,
      0,
      "",
      1,
      new Date().toISOString(),
      "test@example.com",
    );
    db.prepare(
      "INSERT INTO lotaru_agent_runs (id, agent_id, project_id, status, output, error, started_at, finished_at) VALUES (?, ?, ?, ?, '', '', ?, '')",
    ).run(randomUUID(), agentId, "proj-a", "running", new Date().toISOString());
    const app = Fastify({ logger: false });
    const identity = await createIdentity({
      publicUrl: "http://127.0.0.1:4317",
      dataDir: dir,
    });
    await registerAgentsModule(app, {
      databasePath,
      identity,
      projectAccess: () => true,
      projectCwd: () => dir,
      runAgent: async () => "done",
    });
    t.after(async () => {
      await app.close();
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/run`,
    });
    assert.equal(res.statusCode, 409);
  });
});
