import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { z } from "zod";
import {
  fireKnowledgeTemplatesForEvent,
  openKnowledgeTemplateDb,
} from "./modules/knowledge-templates.js";
import { templateListensToEvent } from "./event-registry.js";
import { EVENT_CLOCK_EVERY_1M } from "./events.js";
import { openAgentDb, saveAgentProfile } from "./agent-store.js";

const PROJECT_ID = "proj-templates";

const artifactRowSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  body: z.string(),
});

describe("knowledge templates fire", () => {
  it("appends a new artifact for each matching event fire", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-knowledge-templates-"));
    const databasePath = join(dir, "app.sqlite");
    const db = openKnowledgeTemplateDb(databasePath);
    saveAgentProfile(openAgentDb(databasePath), {
      kind: "ollama",
      mode: "ask",
      command: "",
    });
    const templateId = randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare(
      "INSERT INTO knowledge_templates (id, project_id, kind, title, event_type, description, language, enabled, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      templateId,
      PROJECT_ID,
      "document",
      "Quality report",
      "file.changed",
      "Summarize what changed.",
      "en",
      1,
      createdAt,
      "tester@lotaru.local",
    );

    const bodies: string[] = [];
    await fireKnowledgeTemplatesForEvent({
      databasePath,
      projectId: PROJECT_ID,
      eventId: "evt-1",
      eventType: "file.changed",
      path: "src/a.ts",
      detail: "edited",
      createdAt: Date.now(),
      projectCwd: () => dir,
      runAgent: async () => {
        bodies.push("body-one");
        return "body-one";
      },
    });
    await fireKnowledgeTemplatesForEvent({
      databasePath,
      projectId: PROJECT_ID,
      eventId: "evt-2",
      eventType: "file.changed",
      path: "src/b.ts",
      detail: "edited",
      createdAt: Date.now(),
      projectCwd: () => dir,
      runAgent: async () => {
        bodies.push("body-two");
        return "body-two";
      },
    });

    const raw = db
      .prepare(
        "SELECT id, event_id, body FROM knowledge_artifacts WHERE project_id = ? AND template_id = ? ORDER BY created_at ASC",
      )
      .all(PROJECT_ID, templateId);
    assert.equal(Array.isArray(raw), true);
    const artifacts = [];
    for (const entry of raw) {
      const parsed = artifactRowSchema.safeParse(entry);
      if (parsed.success !== true) {
        continue;
      }
      artifacts.push(parsed.data);
    }
    assert.equal(artifacts.length, 2);
    assert.equal(bodies.length, 2);
    assert.notEqual(artifacts[0].id, artifacts[1].id);
    assert.equal(artifacts[0].event_id, "evt-1");
    assert.equal(artifacts[1].event_id, "evt-2");
    assert.equal(artifacts[0].body, "body-one");
    assert.equal(artifacts[1].body, "body-two");
  });

  it("keeps an empty artifact body when the agent fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-knowledge-templates-fail-"));
    const databasePath = join(dir, "app.sqlite");
    const db = openKnowledgeTemplateDb(databasePath);
    saveAgentProfile(openAgentDb(databasePath), {
      kind: "ollama",
      mode: "ask",
      command: "",
    });
    const templateId = randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare(
      "INSERT INTO knowledge_templates (id, project_id, kind, title, event_type, description, language, enabled, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      templateId,
      PROJECT_ID,
      "document",
      "Quality report",
      "file.changed",
      "Summarize what changed.",
      "en",
      1,
      createdAt,
      "tester@lotaru.local",
    );

    const errors: string[] = [];
    await fireKnowledgeTemplatesForEvent({
      databasePath,
      projectId: PROJECT_ID,
      eventId: "evt-fail",
      eventType: "file.changed",
      path: "src/c.ts",
      detail: "edited",
      createdAt: Date.now(),
      projectCwd: () => dir,
      runAgent: async () => {
        throw new Error("Ollama unavailable");
      },
      onAgentError: (failure) => {
        errors.push(failure.message);
      },
    });

    const raw = db
      .prepare(
        "SELECT body FROM knowledge_artifacts WHERE project_id = ? AND template_id = ?",
      )
      .all(PROJECT_ID, templateId);
    assert.equal(Array.isArray(raw), true);
    assert.equal(raw.length, 1);
    const rowSchema = z.object({ body: z.string() });
    const parsed = rowSchema.safeParse(raw[0]);
    if (parsed.success !== true) {
      assert.fail("artifact row missing");
    }
    assert.equal(parsed.data.body, "");
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Ollama unavailable/);
  });

  it("fires a calendar template only on the matching clock minute", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-knowledge-calendar-"));
    const databasePath = join(dir, "app.sqlite");
    const db = openKnowledgeTemplateDb(databasePath);
    saveAgentProfile(openAgentDb(databasePath), {
      kind: "ollama",
      mode: "ask",
      command: "",
    });
    const templateId = randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare(
      "INSERT INTO knowledge_templates (id, project_id, kind, title, event_type, schedule_cron, description, language, enabled, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      templateId,
      PROJECT_ID,
      "diagram",
      "Weekly map",
      EVENT_CLOCK_EVERY_1M,
      "0 3 * * 1",
      "Draw the service map.",
      "en",
      1,
      createdAt,
      "tester@lotaru.local",
    );
    const monday = new Date(2026, 8, 7, 3, 0, 0);
    assert.equal(monday.getDay(), 1);
    const tuesday = new Date(2026, 8, 8, 3, 0, 0);
    assert.equal(tuesday.getDay(), 2);
    await fireKnowledgeTemplatesForEvent({
      databasePath,
      projectId: PROJECT_ID,
      eventId: "evt-tue",
      eventType: EVENT_CLOCK_EVERY_1M,
      path: "clock",
      detail: "tick",
      createdAt: tuesday.getTime(),
      projectCwd: () => dir,
      runAgent: async () => {
        return "should-not-run";
      },
    });
    const missed = db
      .prepare("SELECT id FROM knowledge_artifacts WHERE template_id = ?")
      .all(templateId);
    assert.equal(Array.isArray(missed), true);
    assert.equal(missed.length, 0);
    await fireKnowledgeTemplatesForEvent({
      databasePath,
      projectId: PROJECT_ID,
      eventId: "evt-mon",
      eventType: EVENT_CLOCK_EVERY_1M,
      path: "clock",
      detail: "tick",
      createdAt: monday.getTime(),
      projectCwd: () => dir,
      runAgent: async () => {
        return "mermaid-weekly";
      },
    });
    const hit = db
      .prepare("SELECT body FROM knowledge_artifacts WHERE template_id = ?")
      .all(templateId);
    assert.equal(Array.isArray(hit), true);
    assert.equal(hit.length, 1);
    const bodyParsed = z.object({ body: z.string() }).safeParse(hit[0]);
    if (bodyParsed.success !== true) {
      assert.fail("calendar artifact missing");
    }
    assert.equal(bodyParsed.data.body, "mermaid-weekly");
    assert.equal(
      templateListensToEvent(
        {
          id: templateId,
          title: "Weekly map",
          eventType: EVENT_CLOCK_EVERY_1M,
          scheduleCron: "0 3 * * 1",
          enabled: true,
        },
        {
          id: "e-mon",
          type: EVENT_CLOCK_EVERY_1M,
          projectId: PROJECT_ID,
          scriptId: "clock",
          path: "clock",
          detail: "tick",
          createdAt: monday.getTime(),
        },
      ),
      true,
    );
    assert.equal(
      templateListensToEvent(
        {
          id: templateId,
          title: "Weekly map",
          eventType: EVENT_CLOCK_EVERY_1M,
          scheduleCron: "0 3 * * 1",
          enabled: true,
        },
        {
          id: "e-tue",
          type: EVENT_CLOCK_EVERY_1M,
          projectId: PROJECT_ID,
          scriptId: "clock",
          path: "clock",
          detail: "tick",
          createdAt: tuesday.getTime(),
        },
      ),
      false,
    );
  });
});
