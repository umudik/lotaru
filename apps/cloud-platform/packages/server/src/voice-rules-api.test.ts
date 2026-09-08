import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { createIdentity } from "./modules/identity.js";
import {
  fireAgentsForEvent,
  pendingAgentFires,
  registerAgentsModule,
} from "./modules/agents.js";
import { registerVoiceRulesModule } from "./modules/voice-rules.js";
import { openSettingsDb } from "./app-settings.js";
import { ensureGithubSchema, saveGithubToken } from "./github-store.js";

const PROJECT = "proj-rules-api";

async function bootstrap(): Promise<{ app: FastifyInstance; databasePath: string }> {
  const dir = mkdtempSync(join(tmpdir(), "lotaru-rules-api-"));
  const databasePath = join(dir, "app.sqlite");
  const app = Fastify({ logger: false });
  const identity = await createIdentity({
    publicUrl: "http://127.0.0.1:4317",
    dataDir: dir,
  });
  await registerVoiceRulesModule(app, {
    databasePath,
    identity,
    projectAccess: () => true,
  });
  await registerAgentsModule(app, {
    databasePath,
    identity,
    projectAccess: () => true,
    projectCwd: () => dir,
    runAgent: async () => "done",
  });
  return { app, databasePath };
}

async function createRule(
  app: FastifyInstance,
  name: string,
  instruction: string,
): Promise<{ id: string; slug: string; eventType: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/voice-rules",
    payload: { projectId: PROJECT, name, instruction },
  });
  assert.equal(res.statusCode, 201);
  return res.json() as { id: string; slug: string; eventType: string };
}

describe("voice rules API", () => {
  it("derives an event type from the rule name", async (t) => {
    const { app } = await bootstrap();
    t.after(async () => {
      await app.close();
    });
    const rule = await createRule(app, "Hatırlatma", "Konuşan bir hatırlatma bırakırsa.");
    assert.equal(rule.slug, "hatirlatma");
    assert.equal(rule.eventType, "voice.rule.hatirlatma");
  });

  it("keeps event types unique within a project", async (t) => {
    const { app } = await bootstrap();
    t.after(async () => {
      await app.close();
    });
    const first = await createRule(app, "Task", "Bir iş açılmasını isterse.");
    const second = await createRule(app, "Task", "Başka bir kural.");
    assert.equal(first.slug, "task");
    assert.equal(second.slug, "task-2");
  });

  it("rejects a name with nothing to slugify", async (t) => {
    const { app } = await bootstrap();
    t.after(async () => {
      await app.close();
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/voice-rules",
      payload: { projectId: PROJECT, name: "!!!", instruction: "x" },
    });
    assert.equal(res.statusCode, 400);
  });

  it("offers rule events alongside platform events", async (t) => {
    const { app } = await bootstrap();
    t.after(async () => {
      await app.close();
    });
    await createRule(app, "Hatırlatma", "Konuşan bir hatırlatma bırakırsa.");
    const res = await app.inject({
      method: "GET",
      url: `/api/event-types?projectId=${PROJECT}`,
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      eventTypes: { type: string; label: string; kind: string }[];
    };
    const rule = body.eventTypes.find((entry) => entry.type === "voice.rule.hatirlatma");
    assert.notEqual(rule, undefined);
    assert.equal(rule?.kind, "rule");
    assert.equal(rule?.label, "Hatırlatma");
    const platform = body.eventTypes.find((entry) => entry.type === "task.created");
    assert.equal(platform?.kind, "platform");
    const namedClock = body.eventTypes.find((entry) => entry.type === "clock.at.monday-15");
    assert.equal(namedClock?.kind, "platform");
    assert.equal(namedClock?.label, "Monday at 15:00");
    const github = body.eventTypes.find((entry) => entry.type === "github.pull_request.opened");
    assert.equal(github, undefined);
  });

  it("offers GitHub events as connection events after a token is saved", async (t) => {
    const { app, databasePath } = await bootstrap();
    t.after(async () => {
      await app.close();
    });
    const settingsDb = openSettingsDb(databasePath);
    ensureGithubSchema(settingsDb);
    saveGithubToken(settingsDb, "ghp_connection_events");
    const res = await app.inject({
      method: "GET",
      url: `/api/event-types?projectId=${PROJECT}`,
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      eventTypes: { type: string; label: string; kind: string; sourceId: string; sourceLabel: string }[];
    };
    const opened = body.eventTypes.find((entry) => entry.type === "github.pull_request.opened");
    assert.equal(opened?.kind, "connection");
    assert.equal(opened?.label, "Pull request opened");
    assert.equal(opened?.sourceId, "github");
    assert.equal(opened?.sourceLabel, "GitHub");
    const installed = body.eventTypes.find((entry) => entry.type === "github.installation");
    assert.equal(installed?.label, "App installed");
    assert.equal(installed?.sourceId, "github");
  });

  it("lets an agent subscribe to a rule event", async (t) => {
    const { app } = await bootstrap();
    t.after(async () => {
      await app.close();
    });
    const rule = await createRule(app, "Hatırlatma", "Konuşan bir hatırlatma bırakırsa.");
    const res = await app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        projectId: PROJECT,
        title: "Note the reminder",
        prompt: "Write the reminder down.",
        trigger: "event",
        eventType: rule.eventType,
        action: "note",
        noteBookTitle: "Reminders",
      },
    });
    assert.equal(res.statusCode, 201);
    const agent = res.json() as { eventType: string; action: string };
    assert.equal(agent.eventType, "voice.rule.hatirlatma");
    assert.equal(agent.action, "note");
  });

  it("rejects an agent pointed at an event type nobody mints", async (t) => {
    const { app } = await bootstrap();
    t.after(async () => {
      await app.close();
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        projectId: PROJECT,
        title: "Bad",
        prompt: "x",
        trigger: "event",
        eventType: "not.a.real.event",
      },
    });
    assert.equal(res.statusCode, 400);
  });

  it("refuses to delete a rule something still listens for", async (t) => {
    const { app } = await bootstrap();
    t.after(async () => {
      await app.close();
    });
    const rule = await createRule(app, "Hatırlatma", "Konuşan bir hatırlatma bırakırsa.");
    const agent = await app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        projectId: PROJECT,
        title: "Note the reminder",
        prompt: "Write it down.",
        trigger: "event",
        eventType: rule.eventType,
        action: "note",
      },
    });
    assert.equal(agent.statusCode, 201);

    const blocked = await app.inject({
      method: "DELETE",
      url: `/api/voice-rules/${rule.id}`,
    });
    assert.equal(blocked.statusCode, 409);
    const blockedBody = blocked.json() as {
      error: string;
      subscribers: { kind: string; label: string }[];
    };
    assert.match(blockedBody.error, /Note the reminder/);
    assert.equal(blockedBody.subscribers[0]?.kind, "agent");

    // Detach the listener and the rule becomes deletable.
    const agentId = (agent.json() as { id: string }).id;
    const detached = await app.inject({ method: "DELETE", url: `/api/agents/${agentId}` });
    assert.equal(detached.statusCode, 200);
    const removed = await app.inject({
      method: "DELETE",
      url: `/api/voice-rules/${rule.id}`,
    });
    assert.equal(removed.statusCode, 200);
  });

  it("refuses to move an event id out from under a listener", async (t) => {
    const { app } = await bootstrap();
    t.after(async () => {
      await app.close();
    });
    const rule = await createRule(app, "Hatırlatma", "Konuşan bir hatırlatma bırakırsa.");
    await app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        projectId: PROJECT,
        title: "Note the reminder",
        prompt: "Write it down.",
        trigger: "event",
        eventType: rule.eventType,
      },
    });
    const moved = await app.inject({
      method: "PATCH",
      url: `/api/voice-rules/${rule.id}`,
      payload: { slug: "baska-id" },
    });
    assert.equal(moved.statusCode, 409);

    // Renaming leaves the event id alone, so it stays allowed.
    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/voice-rules/${rule.id}`,
      payload: { name: "Hatırlatmalar" },
    });
    assert.equal(renamed.statusCode, 200);
    assert.equal((renamed.json() as { slug: string }).slug, "hatirlatma");
  });

  it("reports the listener count and the listeners themselves", async (t) => {
    const { app } = await bootstrap();
    t.after(async () => {
      await app.close();
    });
    const rule = await createRule(app, "Hatırlatma", "Konuşan bir hatırlatma bırakırsa.");
    await app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        projectId: PROJECT,
        title: "Note the reminder",
        prompt: "Write it down.",
        trigger: "event",
        eventType: rule.eventType,
      },
    });
    const listed = await app.inject({
      method: "GET",
      url: `/api/voice-rules?projectId=${PROJECT}`,
    });
    const body = listed.json() as {
      rules: { subscriberCount: number }[];
      runtime: string;
    };
    assert.equal(body.rules[0]?.subscriberCount, 1);
    assert.equal(body.runtime, "ollama");

    const subscribers = await app.inject({
      method: "GET",
      url: `/api/voice-rules/${rule.id}/subscribers`,
    });
    const subs = subscribers.json() as { subscribers: { kind: string; label: string }[] };
    assert.equal(subs.subscribers.length, 1);
    assert.equal(subs.subscribers[0]?.label, "Note the reminder");
  });

  it("queues a second event that lands while the agent is still running", async (t) => {
    const { app, databasePath } = await bootstrap();
    let release: () => void = () => {
      return;
    };
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let runs = 0;
    const fire = async (): Promise<void> => {
      await fireAgentsForEvent({
        databasePath,
        projectId: PROJECT,
        eventId: `evt-${String(runs)}`,
        eventType: "voice.rule.hatirlatma",
        path: "Ali",
        detail: "Ali aranacak",
        projectCwd: () => tmpdir(),
        runAgent: async () => {
          runs += 1;
          await gate;
          return "done";
        },
      });
    };
    t.after(async () => {
      release();
      await app.close();
    });

    const rule = await createRule(app, "Hatırlatma", "Konuşan bir hatırlatma bırakırsa.");
    const created = await app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        projectId: PROJECT,
        title: "Serial agent",
        prompt: "x",
        trigger: "event",
        eventType: rule.eventType,
      },
    });
    const agentId = (created.json() as { id: string }).id;

    void fire();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(runs, 1);

    // Second event arrives mid-run: it waits rather than being dropped.
    await fire();
    assert.equal(pendingAgentFires(agentId), 1);

    release();
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(runs, 2);
    assert.equal(pendingAgentFires(agentId), 0);
  });

  it("edits and deletes a rule", async (t) => {
    const { app } = await bootstrap();
    t.after(async () => {
      await app.close();
    });
    const rule = await createRule(app, "Karar", "Bir karara varırsa.");
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/voice-rules/${rule.id}`,
      payload: { name: "Kararlar", enabled: false },
    });
    assert.equal(patched.statusCode, 200);
    const updated = patched.json() as { name: string; slug: string; enabled: boolean };
    assert.equal(updated.name, "Kararlar");
    // Renaming must not move the event other features already subscribe to.
    assert.equal(updated.slug, "karar");
    assert.equal(updated.enabled, false);

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/voice-rules/${rule.id}`,
    });
    assert.equal(removed.statusCode, 200);
    const listed = await app.inject({
      method: "GET",
      url: `/api/voice-rules?projectId=${PROJECT}`,
    });
    const body = listed.json() as { rules: { id: string }[] };
    assert.equal(body.rules.length, 0);
  });
});
