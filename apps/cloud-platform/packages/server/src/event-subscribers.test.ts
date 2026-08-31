import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { countSubscribersByEvent, listEventSubscribers } from "./event-subscribers.js";
import { openAgentsDb, uniqueAgentSlug } from "./modules/agents.js";
import { cachedSqlite } from "./sqlite-cache.js";

const PROJECT = "proj-subs";

function harness(): string {
  const dir = mkdtempSync(join(tmpdir(), "lotaru-subs-"));
  const databasePath = join(dir, "app.sqlite");
  openAgentsDb(databasePath);
  const db = cachedSqlite("subs-test", databasePath, (handle) => {
    handle.exec(`
      CREATE TABLE IF NOT EXISTS script_scripts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        trigger_bus_event TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1
      );
    `);
  });
  const script = db.prepare(
    "INSERT INTO script_scripts (id, project_id, name, trigger_type, trigger_bus_event, enabled) VALUES (?, ?, ?, ?, ?, 1)",
  );
  script.run(randomUUID(), PROJECT, "On the clock", "scheduled", "");
  script.run(randomUUID(), PROJECT, "On save", "save", "");
  script.run(randomUUID(), PROJECT, "On boot", "startup", "");
  script.run(randomUUID(), PROJECT, "By hand", "manual", "");
  script.run(randomUUID(), PROJECT, "On a rule", "event", "voice.rule.hatirlatma");
  return databasePath;
}

function addAgent(databasePath: string, title: string, trigger: string, eventType: string): void {
  const db = openAgentsDb(databasePath);
  const id = randomUUID();
  db.prepare(
    "INSERT INTO lotaru_agents (id, project_id, title, slug, prompt, trigger_kind, event_type, schedule_hour, schedule_minute, include_voice, action, note_book_title, enabled, created_at, created_by) VALUES (?, ?, ?, ?, 'p', ?, ?, 21, 0, 0, 'none', '', 1, 'now', 'test')",
  ).run(id, PROJECT, title, uniqueAgentSlug(db, PROJECT, title, id), trigger, eventType);
}

describe("event subscribers", () => {
  it("counts a script's trigger kind as the event it really listens for", () => {
    const databasePath = harness();
    const counts = countSubscribersByEvent({ databasePath, projectId: PROJECT });
    assert.equal(counts["clock.tick"], 1);
    assert.equal(counts["file.changed"], 1);
    assert.equal(counts["app.started"], 1);
    assert.equal(counts["voice.rule.hatirlatma"], 1);
  });

  it("leaves manual scripts out — they subscribe to nothing", () => {
    const databasePath = harness();
    const all = Object.values(countSubscribersByEvent({ databasePath, projectId: PROJECT }));
    let total = 0;
    for (const count of all) {
      total += count;
    }
    assert.equal(total, 4);
  });

  it("names the scheduled script when asked who listens to the clock", () => {
    const databasePath = harness();
    const subscribers = listEventSubscribers({
      databasePath,
      projectId: PROJECT,
      eventType: "clock.tick",
    });
    assert.equal(subscribers.length, 1);
    assert.equal(subscribers[0]?.label, "On the clock");
    assert.equal(subscribers[0]?.kind, "script");
  });

  it("counts a daily agent as a clock subscriber", () => {
    const databasePath = harness();
    addAgent(databasePath, "Nightly journal", "schedule", "");
    addAgent(databasePath, "Reminder note", "event", "voice.rule.hatirlatma");
    const counts = countSubscribersByEvent({ databasePath, projectId: PROJECT });
    assert.equal(counts["clock.tick"], 2);
    assert.equal(counts["voice.rule.hatirlatma"], 2);
  });

  it("resolves the note.page.written alias onto note.page.created", () => {
    const databasePath = harness();
    addAgent(databasePath, "Note watcher", "event", "note.page.written");
    const subscribers = listEventSubscribers({
      databasePath,
      projectId: PROJECT,
      eventType: "note.page.created",
    });
    assert.equal(subscribers.length, 1);
    assert.equal(subscribers[0]?.label, "Note watcher");
  });
});
