import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  userCanAccessProject,
} from "../../../../../task-bridge/apps/backend/dist/services/project-registry.js";
import { activeAgentKind, runProjectAgentPrompt } from "../agent-prompt.js";
import { ruleEventType } from "../events.js";
import {
  countSubscribersByEvent,
  describeSubscribers,
  listEventSubscribers,
} from "../event-subscribers.js";
import { selectableEventTypes } from "../event-registry.js";
import { listAgentEventSources } from "../agent-events.js";
import { scanVoiceBatchForProject } from "../voice-batch.js";
import {
  getRule,
  HIT_HISTORY_LIMIT,
  listEnabledVoiceRules,
  listRuleHits,
  listVoiceRules,
  openVoiceRulesDb,
  RULE_INSTRUCTION_MAX,
  RULE_NAME_MAX,
  uniqueRuleSlug,
  withRuleEventType,
} from "../voice-rule-store.js";
import {
  parseVoiceRuleMatches,
  voiceRulePrompt,
  VOICE_RULE_SYSTEM,
  type VoiceRule,
} from "../voice-rules.js";
import type { Identity } from "./identity.js";

type Viewer = { email: string; sub: string };

type ModuleOptions = {
  databasePath: string;
  identity: Identity;
  projectAccess?: (projectId: string, userId: string) => boolean;
};

const createRuleSchema = z.object({
  projectId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(RULE_NAME_MAX),
  slug: z.string().trim().max(48).optional(),
  instruction: z.string().trim().min(1).max(RULE_INSTRUCTION_MAX),
  enabled: z.boolean().optional(),
});

const patchRuleSchema = z.object({
  name: z.string().trim().min(1).max(RULE_NAME_MAX).optional(),
  slug: z.string().trim().max(48).optional(),
  instruction: z.string().trim().min(1).max(RULE_INSTRUCTION_MAX).optional(),
  enabled: z.boolean().optional(),
});

const testRuleSchema = z.object({
  projectId: z.string().trim().min(1),
  transcript: z.string().trim().min(1).max(20_000),
});

const scanSchema = z.object({
  projectId: z.string().trim().min(1),
});

function canSeeProject(options: ModuleOptions, projectId: string, userId: string): boolean {
  if (options.projectAccess !== undefined) {
    return options.projectAccess(projectId, userId);
  }
  return userCanAccessProject(projectId, userId);
}

async function viewersFrom(request: FastifyRequest, options: ModuleOptions): Promise<Viewer[]> {
  const user = await options.identity.userFrom(request);
  if (user === null) {
    return [];
  }
  return [{ email: user.email, sub: user.id }];
}

export async function registerVoiceRulesModule(
  app: FastifyInstance,
  options: ModuleOptions,
): Promise<void> {
  const db = openVoiceRulesDb(options.databasePath);

  app.get<{ Querystring: { projectId?: string } }>("/api/voice-rules", async (request, reply) => {
    const viewers = await viewersFrom(request, options);
    if (viewers.length === 0) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    let projectId = "";
    if (request.query.projectId !== undefined) {
      projectId = request.query.projectId.trim();
    }
    if (projectId.length === 0) {
      return reply.code(400).send({ error: "projectId required" });
    }
    if (canSeeProject(options, projectId, viewers[0].sub) !== true) {
      return reply.code(404).send({ error: "not found" });
    }
    const counts = countSubscribersByEvent({
      databasePath: options.databasePath,
      projectId,
    });
    const rules = listVoiceRules(db, projectId).map((rule) => {
      const withEvent = withRuleEventType(rule);
      const subscribers = counts[withEvent.eventType];
      return Object.assign({}, withEvent, {
        subscriberCount: subscribers === undefined ? 0 : subscribers,
      });
    });
    return {
      rules,
      hits: listRuleHits(db, projectId, HIT_HISTORY_LIMIT),
      // Matching runs on whatever Settings → AI points at.
      runtime: activeAgentKind(options.databasePath),
    };
  });

  app.get<{ Params: { ruleId: string } }>(
    "/api/voice-rules/:ruleId/subscribers",
    async (request, reply) => {
      const viewers = await viewersFrom(request, options);
      if (viewers.length === 0) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const existing = getRule(db, request.params.ruleId);
      if (existing === null) {
        return reply.code(404).send({ error: "not found" });
      }
      if (canSeeProject(options, existing.projectId, viewers[0].sub) !== true) {
        return reply.code(404).send({ error: "not found" });
      }
      return {
        subscribers: listEventSubscribers({
          databasePath: options.databasePath,
          projectId: existing.projectId,
          eventType: ruleEventType(existing.slug),
        }),
      };
    },
  );

  // Single source of truth for every event a subscriber can pick from: the
  // fixed platform catalogue plus whatever rules and agents this project has
  // minted.
  app.get<{ Querystring: { projectId?: string } }>("/api/event-types", async (request, reply) => {
    const viewers = await viewersFrom(request, options);
    if (viewers.length === 0) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    let projectId = "";
    if (request.query.projectId !== undefined) {
      projectId = request.query.projectId.trim();
    }
    if (projectId.length === 0) {
      return reply.code(400).send({ error: "projectId required" });
    }
    if (canSeeProject(options, projectId, viewers[0].sub) !== true) {
      return reply.code(404).send({ error: "not found" });
    }
    const eventTypes: { type: string; label: string; kind: "platform" | "rule" | "agent" }[] = [];
    for (const type of selectableEventTypes()) {
      eventTypes.push({ type, label: "", kind: "platform" });
    }
    for (const rule of listVoiceRules(db, projectId)) {
      eventTypes.push({
        type: ruleEventType(rule.slug),
        label: rule.name,
        kind: "rule",
      });
    }
    for (const source of listAgentEventSources(options.databasePath, projectId)) {
      eventTypes.push({
        type: source.eventType,
        label: source.title,
        kind: "agent",
      });
    }
    return { eventTypes };
  });

  app.post("/api/voice-rules", async (request, reply) => {
    const viewers = await viewersFrom(request, options);
    if (viewers.length === 0) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = createRuleSchema.safeParse(request.body);
    if (parsed.success !== true) {
      return reply.code(400).send({ error: "Invalid rule" });
    }
    if (canSeeProject(options, parsed.data.projectId, viewers[0].sub) !== true) {
      return reply.code(404).send({ error: "not found" });
    }
    let requested = parsed.data.name;
    if (parsed.data.slug !== undefined && parsed.data.slug.trim().length > 0) {
      requested = parsed.data.slug;
    }
    let slug = "";
    try {
      slug = uniqueRuleSlug(db, parsed.data.projectId, requested, "");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Invalid rule id";
      return reply.code(400).send({ error: message });
    }
    let enabled = true;
    if (parsed.data.enabled === false) {
      enabled = false;
    }
    const rule: VoiceRule = {
      id: randomUUID(),
      projectId: parsed.data.projectId,
      name: parsed.data.name,
      slug,
      instruction: parsed.data.instruction,
      enabled,
      createdAt: new Date().toISOString(),
      createdBy: viewers[0].email,
    };
    db.prepare(
      "INSERT INTO voice_rules (id, project_id, name, slug, instruction, enabled, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      rule.id,
      rule.projectId,
      rule.name,
      rule.slug,
      rule.instruction,
      rule.enabled ? 1 : 0,
      rule.createdAt,
      rule.createdBy,
    );
    return reply.code(201).send(withRuleEventType(rule));
  });

  app.patch<{ Params: { ruleId: string } }>("/api/voice-rules/:ruleId", async (request, reply) => {
    const viewers = await viewersFrom(request, options);
    if (viewers.length === 0) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const existing = getRule(db, request.params.ruleId);
    if (existing === null) {
      return reply.code(404).send({ error: "not found" });
    }
    if (canSeeProject(options, existing.projectId, viewers[0].sub) !== true) {
      return reply.code(404).send({ error: "not found" });
    }
    const parsed = patchRuleSchema.safeParse(request.body);
    if (parsed.success !== true) {
      return reply.code(400).send({ error: "Invalid rule" });
    }
    let name = existing.name;
    if (parsed.data.name !== undefined) {
      name = parsed.data.name;
    }
    let instruction = existing.instruction;
    if (parsed.data.instruction !== undefined) {
      instruction = parsed.data.instruction;
    }
    let enabled = existing.enabled;
    if (parsed.data.enabled !== undefined) {
      enabled = parsed.data.enabled;
    }
    // The slug is the event type other features subscribe to, so it only moves
    // when the caller asks for it by name — and never out from under a
    // subscriber, the same way a foreign key refuses to strand its references.
    let slug = existing.slug;
    if (parsed.data.slug !== undefined && parsed.data.slug.trim().length > 0) {
      try {
        slug = uniqueRuleSlug(db, existing.projectId, parsed.data.slug, existing.id);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Invalid rule id";
        return reply.code(400).send({ error: message });
      }
      if (slug !== existing.slug) {
        const subscribers = listEventSubscribers({
          databasePath: options.databasePath,
          projectId: existing.projectId,
          eventType: ruleEventType(existing.slug),
        });
        if (subscribers.length > 0) {
          return reply.code(409).send({
            error: `Event id is in use by ${describeSubscribers(subscribers)}. Point them somewhere else first.`,
            subscribers,
          });
        }
      }
    }
    db.prepare(
      "UPDATE voice_rules SET name = ?, slug = ?, instruction = ?, enabled = ? WHERE id = ?",
    ).run(name, slug, instruction, enabled ? 1 : 0, existing.id);
    const next = getRule(db, existing.id);
    if (next === null) {
      return reply.code(404).send({ error: "not found" });
    }
    return withRuleEventType(next);
  });

  app.delete<{ Params: { ruleId: string } }>("/api/voice-rules/:ruleId", async (request, reply) => {
    const viewers = await viewersFrom(request, options);
    if (viewers.length === 0) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const existing = getRule(db, request.params.ruleId);
    if (existing === null) {
      return reply.code(404).send({ error: "not found" });
    }
    if (canSeeProject(options, existing.projectId, viewers[0].sub) !== true) {
      return reply.code(404).send({ error: "not found" });
    }
    // Refuse to delete an event something still listens for. Detach the
    // listeners first and the rule becomes deletable.
    const subscribers = listEventSubscribers({
      databasePath: options.databasePath,
      projectId: existing.projectId,
      eventType: ruleEventType(existing.slug),
    });
    if (subscribers.length > 0) {
      return reply.code(409).send({
        error: `Still listened to by ${describeSubscribers(subscribers)}. Remove or repoint them first.`,
        subscribers,
      });
    }
    db.prepare("DELETE FROM voice_rules WHERE id = ?").run(existing.id);
    return { ok: true };
  });

  // Dry run: match a pasted transcript without emitting anything, so rules can
  // be tuned without speaking into a microphone.
  app.post("/api/voice-rules/test", async (request, reply) => {
    const viewers = await viewersFrom(request, options);
    if (viewers.length === 0) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = testRuleSchema.safeParse(request.body);
    if (parsed.success !== true) {
      return reply.code(400).send({ error: "Invalid request" });
    }
    if (canSeeProject(options, parsed.data.projectId, viewers[0].sub) !== true) {
      return reply.code(404).send({ error: "not found" });
    }
    const rules = listEnabledVoiceRules(db, parsed.data.projectId);
    if (rules.length === 0) {
      return { matches: [], ran: false, error: "No enabled rules to match against" };
    }
    let raw = "";
    try {
      raw = await runProjectAgentPrompt({
        databasePath: options.databasePath,
        projectId: parsed.data.projectId,
        systemPrompt: VOICE_RULE_SYSTEM,
        prompt: voiceRulePrompt({ transcript: parsed.data.transcript, rules }),
        mode: "ask",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Scanner unavailable";
      return { matches: [], ran: false, error: message };
    }
    return { matches: parseVoiceRuleMatches(raw, rules), ran: true, error: "" };
  });

  // Force the periodic scan to run right now instead of waiting for the timer.
  app.post("/api/voice-rules/scan", async (request, reply) => {
    const viewers = await viewersFrom(request, options);
    if (viewers.length === 0) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = scanSchema.safeParse(request.body);
    if (parsed.success !== true) {
      return reply.code(400).send({ error: "Invalid request" });
    }
    if (canSeeProject(options, parsed.data.projectId, viewers[0].sub) !== true) {
      return reply.code(404).send({ error: "not found" });
    }
    return scanVoiceBatchForProject({
      databasePath: options.databasePath,
      projectId: parsed.data.projectId,
      force: true,
    });
  });
}
