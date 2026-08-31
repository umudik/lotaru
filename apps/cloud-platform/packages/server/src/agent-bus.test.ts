import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { createIdentity } from "./modules/identity.js";
import { fireAgentsForEvent, registerAgentsModule } from "./modules/agents.js";
import { registerVoiceRulesModule } from "./modules/voice-rules.js";
import type { LotaruEvent } from "./events.js";

const PROJECT = "proj-agent-bus";

type Bus = {
  events: LotaruEvent[];
  emit: (partial: {
    type: string;
    projectId: string;
    scriptId: string;
    path: string;
    detail: string;
    agentChain?: readonly string[];
  }) => LotaruEvent;
  settle: () => Promise<void>;
};

type Harness = {
  app: FastifyInstance;
  databasePath: string;
  bus: Bus;
  fire: (eventType: string, detail: string) => Promise<void>;
};

/**
 * A stand-in for the real publisher: it records what was emitted and hands the
 * event back to the agents, chain and all, the way script-runner does.
 */
async function bootstrap(replies: Record<string, string> = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "lotaru-agent-bus-"));
  const databasePath = join(dir, "app.sqlite");
  const app = Fastify({ logger: false });
  const identity = await createIdentity({
    publicUrl: "http://127.0.0.1:4317",
    dataDir: dir,
  });
  const events: LotaruEvent[] = [];
  const inFlight: Promise<void>[] = [];
  let counter = 0;

  const runAgent = async (input: { prompt: string }): Promise<string> => {
    for (const [needle, reply] of Object.entries(replies)) {
      if (input.prompt.includes(needle)) {
        return reply;
      }
    }
    return "ok";
  };

  const emit: Bus["emit"] = (partial) => {
    counter += 1;
    const event: LotaruEvent = {
      id: `evt-${String(counter)}`,
      type: partial.type,
      projectId: partial.projectId,
      scriptId: partial.scriptId,
      path: partial.path,
      detail: partial.detail,
      createdAt: counter,
    };
    events.push(event);
    inFlight.push(
      fireAgentsForEvent({
        databasePath,
        projectId: event.projectId,
        eventId: event.id,
        eventType: event.type,
        path: event.path,
        detail: event.detail,
        agentChain: partial.agentChain,
        projectCwd: () => dir,
        runAgent,
        emitEvent: emit,
      }),
    );
    return event;
  };

  const settle = async (): Promise<void> => {
    while (inFlight.length > 0) {
      const pending = inFlight.splice(0, inFlight.length);
      await Promise.all(pending);
    }
  };

  await registerVoiceRulesModule(app, { databasePath, identity, projectAccess: () => true });
  await registerAgentsModule(app, {
    databasePath,
    identity,
    projectAccess: () => true,
    projectCwd: () => dir,
    runAgent,
    emitEvent: emit,
  });

  const fire = async (eventType: string, detail: string): Promise<void> => {
    emit({ type: eventType, projectId: PROJECT, scriptId: "", path: "", detail });
    await settle();
  };

  return { app, databasePath, bus: { events, emit, settle }, fire };
}

async function createAgent(
  app: FastifyInstance,
  body: Record<string, unknown>,
): Promise<{ id: string; slug: string; outputEventType: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/agents",
    payload: Object.assign({ projectId: PROJECT }, body),
  });
  assert.equal(res.statusCode, 201);
  return res.json() as { id: string; slug: string; outputEventType: string };
}

async function runsOf(app: FastifyInstance, agentId: string): Promise<{ output: string }[]> {
  const res = await app.inject({ method: "GET", url: `/api/agents/${agentId}/runs` });
  assert.equal(res.statusCode, 200);
  return (res.json() as { runs: { output: string }[] }).runs;
}

describe("agents that write to the bus", () => {
  it("mints an event type from the agent title", async (t) => {
    const { app } = await bootstrap();
    t.after(async () => {
      await app.close();
    });
    const agent = await createAgent(app, {
      title: "Günlük Özet",
      prompt: "Summarise.",
      trigger: "event",
      eventType: "task.created",
      action: "event",
    });
    assert.equal(agent.slug, "gunluk-ozet");
    assert.equal(agent.outputEventType, "agent.out.gunluk-ozet");
  });

  it("offers the minted event to other subscribers, but only while it publishes", async (t) => {
    const { app } = await bootstrap();
    t.after(async () => {
      await app.close();
    });
    const agent = await createAgent(app, {
      title: "Digest",
      prompt: "Summarise.",
      trigger: "event",
      eventType: "task.created",
      action: "none",
    });

    const quiet = await app.inject({ method: "GET", url: `/api/event-types?projectId=${PROJECT}` });
    const quietTypes = (quiet.json() as { eventTypes: { type: string }[] }).eventTypes;
    assert.equal(
      quietTypes.some((entry) => entry.type === agent.outputEventType),
      false,
    );

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/agents/${agent.id}`,
      payload: { action: "event" },
    });
    assert.equal(patched.statusCode, 200);

    const res = await app.inject({ method: "GET", url: `/api/event-types?projectId=${PROJECT}` });
    const entry = (res.json() as { eventTypes: { type: string; label: string; kind: string }[] })
      .eventTypes.find((candidate) => candidate.type === agent.outputEventType);
    assert.equal(entry?.kind, "agent");
    assert.equal(entry?.label, "Digest");
  });

  it("publishes the reply as the event payload", async (t) => {
    const { app, bus, fire } = await bootstrap({ Summarise: "three things happened" });
    t.after(async () => {
      await app.close();
    });
    const agent = await createAgent(app, {
      title: "Digest",
      prompt: "Summarise.",
      trigger: "event",
      eventType: "task.created",
      action: "event",
    });

    await fire("task.created", "a task landed");

    const published = bus.events.find((event) => event.type === agent.outputEventType);
    assert.notEqual(published, undefined);
    assert.equal(published?.detail, "three things happened");
    assert.equal(published?.path, agent.id);
  });

  it("wakes a second agent with the first one's reply", async (t) => {
    const { app, fire } = await bootstrap({
      Summarise: "three things happened",
      "React to": "noted",
    });
    t.after(async () => {
      await app.close();
    });
    const first = await createAgent(app, {
      title: "Digest",
      prompt: "Summarise.",
      trigger: "event",
      eventType: "task.created",
      action: "event",
    });
    const second = await createAgent(app, {
      title: "Reader",
      prompt: "React to the digest.",
      trigger: "event",
      eventType: first.outputEventType,
      action: "none",
    });

    await fire("task.created", "a task landed");

    const secondRuns = await runsOf(app, second.id);
    assert.equal(secondRuns.length, 1);
    assert.equal(secondRuns[0]?.output, "noted");
  });

  it("stops a cycle instead of running it forever", async (t) => {
    const { app, fire } = await bootstrap();
    t.after(async () => {
      await app.close();
    });
    // Two agents pointed at each other: each hears the other's output.
    const ping = await createAgent(app, {
      title: "Ping",
      prompt: "Ping.",
      trigger: "event",
      eventType: "agent.out.pong",
      action: "event",
    });
    const pong = await createAgent(app, {
      title: "Pong",
      prompt: "Pong.",
      trigger: "event",
      eventType: ping.outputEventType,
      action: "event",
    });

    await fire(pong.outputEventType, "kickoff");

    assert.equal((await runsOf(app, ping.id)).length, 1);
    assert.equal((await runsOf(app, pong.id)).length, 1);
  });

  it("refuses to delete an agent something still listens for", async (t) => {
    const { app } = await bootstrap();
    t.after(async () => {
      await app.close();
    });
    const first = await createAgent(app, {
      title: "Digest",
      prompt: "Summarise.",
      trigger: "event",
      eventType: "task.created",
      action: "event",
    });
    const second = await createAgent(app, {
      title: "Reader",
      prompt: "React.",
      trigger: "event",
      eventType: first.outputEventType,
      action: "none",
    });

    const blocked = await app.inject({ method: "DELETE", url: `/api/agents/${first.id}` });
    assert.equal(blocked.statusCode, 409);
    const body = blocked.json() as { error: string; subscribers: { kind: string }[] };
    assert.match(body.error, /Reader/);
    assert.equal(body.subscribers[0]?.kind, "agent");

    assert.equal(
      (await app.inject({ method: "DELETE", url: `/api/agents/${second.id}` })).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ method: "DELETE", url: `/api/agents/${first.id}` })).statusCode,
      200,
    );
  });

  it("keeps the event id put when the agent is renamed", async (t) => {
    const { app } = await bootstrap();
    t.after(async () => {
      await app.close();
    });
    const agent = await createAgent(app, {
      title: "Digest",
      prompt: "Summarise.",
      trigger: "event",
      eventType: "task.created",
      action: "event",
    });
    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/agents/${agent.id}`,
      payload: { title: "Daily digest" },
    });
    assert.equal(renamed.statusCode, 200);
    const body = renamed.json() as { title: string; outputEventType: string };
    assert.equal(body.title, "Daily digest");
    assert.equal(body.outputEventType, agent.outputEventType);
  });

  it("lists who is listening to the agent", async (t) => {
    const { app } = await bootstrap();
    t.after(async () => {
      await app.close();
    });
    const first = await createAgent(app, {
      title: "Digest",
      prompt: "Summarise.",
      trigger: "event",
      eventType: "task.created",
      action: "event",
    });
    await createAgent(app, {
      title: "Reader",
      prompt: "React.",
      trigger: "event",
      eventType: first.outputEventType,
      action: "none",
    });
    const res = await app.inject({ method: "GET", url: `/api/agents/${first.id}/subscribers` });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      eventType: string;
      subscribers: { kind: string; label: string }[];
    };
    assert.equal(body.eventType, first.outputEventType);
    assert.equal(body.subscribers[0]?.label, "Reader");
  });
});
