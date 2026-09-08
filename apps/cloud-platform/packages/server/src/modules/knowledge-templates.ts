import Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  userCanAccessProject,
} from "../../../../../task-bridge/apps/backend/dist/services/project-registry.js";
import { runProjectAgentPrompt } from "../agent-prompt.js";
import type { AgentKind, AgentMode } from "../agent-runtime.js";
import { subscriberMaySelect, type NamedEventTemplate } from "../event-registry.js";
import { connectedKindsAt } from "../connection-store.js";
import { cachedSqlite } from "../sqlite-cache.js";
import { requireConnectedAiToolId } from "../ai-health.js";
import { openSettingsDb } from "../app-settings.js";
import { calendarHitsNow, parseCalendarCron } from "../calendar-schedule.js";
import type { Identity } from "./identity.js";

export type KnowledgeKind = "document" | "diagram";

export type KnowledgeTemplate = {
  id: string;
  projectId: string;
  kind: KnowledgeKind;
  title: string;
  eventType: string;
  scheduleCron: string;
  description: string;
  language: string;
  aiToolId: string;
  enabled: boolean;
  marketplaceId: string;
  createdAt: string;
  createdBy: string;
};

export type KnowledgeArtifact = {
  id: string;
  projectId: string;
  templateId: string;
  templateTitle: string;
  kind: KnowledgeKind;
  title: string;
  body: string;
  language: string;
  eventType: string;
  eventId: string;
  createdAt: string;
};

type Viewer = { email: string; sub: string };

type AgentRunFn = (input: {
  kind: AgentKind;
  mode: AgentMode;
  prompt: string;
  cwd: string;
}) => Promise<string>;

type ModuleOptions = {
  databasePath: string;
  identity: Identity;
  projectAccess?: (projectId: string, userId: string) => boolean;
  projectCwd?: (projectId: string) => string;
  runAgent?: AgentRunFn;
};

const kindSchema = z.enum(["document", "diagram"]);

const templateRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  kind: z.string(),
  title: z.string(),
  event_type: z.string(),
  schedule_cron: z.string(),
  description: z.string(),
  language: z.string(),
  ai_tool_id: z.string(),
  enabled: z.number(),
  marketplace_id: z.string(),
  created_at: z.string(),
  created_by: z.string(),
});

const namedTemplateRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  event_type: z.string(),
  schedule_cron: z.string(),
  enabled: z.number(),
});

const artifactRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  template_id: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  language: z.string(),
  event_type: z.string(),
  event_id: z.string(),
  created_at: z.string(),
});

const createTemplateSchema = z.object({
  projectId: z.string().trim().min(1),
  kind: kindSchema,
  title: z.string().trim().min(1),
  eventType: z.string().trim().min(1),
  scheduleCron: z.string().optional(),
  description: z.string().trim(),
  language: z.string().trim().min(1),
  aiToolId: z.string().trim().optional(),
  enabled: z.boolean().optional(),
});

const patchTemplateSchema = z.object({
  title: z.string().trim().min(1).optional(),
  eventType: z.string().trim().min(1).optional(),
  scheduleCron: z.string().optional(),
  description: z.string().trim().optional(),
  language: z.string().trim().min(1).optional(),
  aiToolId: z.string().trim().optional(),
  enabled: z.boolean().optional(),
});

const patchArtifactSchema = z.object({
  title: z.string().trim().min(1).optional(),
  body: z.string().optional(),
});

function canSeeProject(options: ModuleOptions, projectId: string, userId: string): boolean {
  if (options.projectAccess !== undefined) {
    return options.projectAccess(projectId, userId);
  }
  return userCanAccessProject(projectId, userId);
}

function requireOfferedEventType(databasePath: string, eventType: string): void {
  if (subscriberMaySelect(eventType, connectedKindsAt(databasePath)) !== true) {
    throw new Error("Unknown event type");
  }
}

function bindTemplateTrigger(
  databasePath: string,
  eventType: string,
  scheduleCron: string,
): { eventType: string; scheduleCron: string } {
  const offered = eventType.trim();
  if (offered.length === 0) {
    throw new Error("event type required");
  }
  requireOfferedEventType(databasePath, offered);
  if (scheduleCron.trim().length > 0) {
    return { eventType: offered, scheduleCron: "" };
  }
  return { eventType: offered, scheduleCron: "" };
}

function templateDueAt(template: KnowledgeTemplate, at: Date): boolean {
  const cron = template.scheduleCron.trim();
  if (cron.length === 0) {
    return true;
  }
  try {
    const spec = parseCalendarCron(cron);
    return calendarHitsNow(spec, at);
  } catch {
    return false;
  }
}

const pragmaColumnSchema = z.object({
  name: z.string(),
});

function knowledgeTableHasColumn(db: Database.Database, column: string): boolean {
  const raw = db.prepare("PRAGMA table_info(knowledge_templates)").all();
  if (Array.isArray(raw) !== true) {
    return false;
  }
  for (const entry of raw) {
    const parsed = pragmaColumnSchema.safeParse(entry);
    if (parsed.success !== true) {
      continue;
    }
    if (parsed.data.name === column) {
      return true;
    }
  }
  return false;
}

export function openKnowledgeTemplateDb(databasePath: string): Database.Database {
  return cachedSqlite("knowledge-templates", databasePath, (db) => {
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_templates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      event_type TEXT NOT NULL,
      schedule_cron TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL,
      language TEXT NOT NULL,
      ai_tool_id TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      marketplace_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_templates_project ON knowledge_templates(project_id, kind);
    CREATE INDEX IF NOT EXISTS idx_knowledge_templates_event ON knowledge_templates(project_id, event_type);
    CREATE TABLE IF NOT EXISTS knowledge_artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      template_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (template_id) REFERENCES knowledge_templates(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_artifacts_project ON knowledge_artifacts(project_id, kind);
  `);
  if (knowledgeTableHasColumn(db, "ai_tool_id") !== true) {
    db.exec("ALTER TABLE knowledge_templates ADD COLUMN ai_tool_id TEXT NOT NULL DEFAULT ''");
  }
  if (knowledgeTableHasColumn(db, "schedule_cron") !== true) {
    db.exec("ALTER TABLE knowledge_templates ADD COLUMN schedule_cron TEXT NOT NULL DEFAULT ''");
  }
  if (knowledgeTableHasColumn(db, "marketplace_id") !== true) {
    db.exec("ALTER TABLE knowledge_templates ADD COLUMN marketplace_id TEXT NOT NULL DEFAULT ''");
  }
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_templates_market ON knowledge_templates(project_id, marketplace_id) WHERE marketplace_id != ''",
  );
  });
}

function templateFromRow(row: z.infer<typeof templateRowSchema>): KnowledgeTemplate | null {
  const kindParsed = kindSchema.safeParse(row.kind);
  if (kindParsed.success !== true) {
    return null;
  }
  return {
    id: row.id,
    projectId: row.project_id,
    kind: kindParsed.data,
    title: row.title,
    eventType: row.event_type,
    scheduleCron: row.schedule_cron,
    description: row.description,
    language: row.language,
    aiToolId: row.ai_tool_id,
    enabled: row.enabled === 1,
    marketplaceId: row.marketplace_id,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

function artifactFromRow(
  row: z.infer<typeof artifactRowSchema>,
  templateTitle: string,
): KnowledgeArtifact | null {
  const kindParsed = kindSchema.safeParse(row.kind);
  if (kindParsed.success !== true) {
    return null;
  }
  return {
    id: row.id,
    projectId: row.project_id,
    templateId: row.template_id,
    templateTitle,
    kind: kindParsed.data,
    title: row.title,
    body: row.body,
    language: row.language,
    eventType: row.event_type,
    eventId: row.event_id,
    createdAt: row.created_at,
  };
}

function listTemplates(
  db: Database.Database,
  projectId: string,
  kind: KnowledgeKind,
): KnowledgeTemplate[] {
  const raw = db
    .prepare(
      "SELECT * FROM knowledge_templates WHERE project_id = ? AND kind = ? ORDER BY created_at DESC",
    )
    .all(projectId, kind);
  if (Array.isArray(raw) !== true) {
    return [];
  }
  const templates: KnowledgeTemplate[] = [];
  for (const entry of raw) {
    const parsed = templateRowSchema.safeParse(entry);
    if (parsed.success !== true) {
      continue;
    }
    const template = templateFromRow(parsed.data);
    if (template !== null) {
      templates.push(template);
    }
  }
  return templates;
}

function getTemplate(db: Database.Database, templateId: string): KnowledgeTemplate | null {
  const parsed = templateRowSchema.safeParse(
    db.prepare("SELECT * FROM knowledge_templates WHERE id = ?").get(templateId),
  );
  if (parsed.success !== true) {
    return null;
  }
  return templateFromRow(parsed.data);
}

function listArtifacts(
  db: Database.Database,
  projectId: string,
  kind: KnowledgeKind,
): KnowledgeArtifact[] {
  const raw = db
    .prepare(
      "SELECT * FROM knowledge_artifacts WHERE project_id = ? AND kind = ? ORDER BY created_at DESC",
    )
    .all(projectId, kind);
  if (Array.isArray(raw) !== true) {
    return [];
  }
  const artifacts: KnowledgeArtifact[] = [];
  for (const entry of raw) {
    const parsed = artifactRowSchema.safeParse(entry);
    if (parsed.success !== true) {
      continue;
    }
    const template = getTemplate(db, parsed.data.template_id);
    let templateTitle = parsed.data.template_id;
    if (template !== null) {
      templateTitle = template.title;
    }
    const artifact = artifactFromRow(parsed.data, templateTitle);
    if (artifact !== null) {
      artifacts.push(artifact);
    }
  }
  return artifacts;
}

function getArtifact(db: Database.Database, artifactId: string): KnowledgeArtifact | null {
  const parsed = artifactRowSchema.safeParse(
    db.prepare("SELECT * FROM knowledge_artifacts WHERE id = ?").get(artifactId),
  );
  if (parsed.success !== true) {
    return null;
  }
  const template = getTemplate(db, parsed.data.template_id);
  let templateTitle = parsed.data.template_id;
  if (template !== null) {
    templateTitle = template.title;
  }
  return artifactFromRow(parsed.data, templateTitle);
}

const KNOWLEDGE_AGENT_SYSTEM = "You write knowledge artifacts.";

function artifactPrompt(
  template: KnowledgeTemplate,
  eventType: string,
  detail: string,
  path: string,
): string {
  const lines = [
    `Create a ${template.kind} for this project.`,
    `Title: ${template.title}`,
    `Language: ${template.language}`,
    `Trigger event: ${eventType}`,
  ];
  if (path.length > 0) {
    lines.push(`Path: ${path}`);
  }
  if (detail.length > 0) {
    lines.push(`Detail: ${detail}`);
  }
  lines.push("Instructions:");
  lines.push(template.description);
  if (template.kind === "diagram") {
    lines.push("Return a 2D diagram description (mermaid or ascii) only.");
  } else {
    lines.push("Return the document body in markdown only.");
  }
  return lines.join("\n");
}

async function viewersFrom(request: FastifyRequest, options: ModuleOptions): Promise<Viewer[]> {
  const user = await options.identity.userFrom(request);
  if (user === null) {
    return [];
  }
  return [{ email: user.email, sub: user.id }];
}

/** Every event-driven template in the project, for the events log. */
export function listProjectEventTemplates(
  databasePath: string,
  projectId: string,
): NamedEventTemplate[] {
  const db = openKnowledgeTemplateDb(databasePath);
  const raw = db
    .prepare(
      "SELECT id, title, event_type, schedule_cron, enabled FROM knowledge_templates WHERE project_id = ?",
    )
    .all(projectId);
  const templates: NamedEventTemplate[] = [];
  if (Array.isArray(raw) !== true) {
    return templates;
  }
  for (const entry of raw) {
    const parsed = namedTemplateRowSchema.safeParse(entry);
    if (parsed.success !== true) {
      continue;
    }
    templates.push({
      id: parsed.data.id,
      title: parsed.data.title,
      eventType: parsed.data.event_type,
      scheduleCron: parsed.data.schedule_cron,
      enabled: parsed.data.enabled === 1,
    });
  }
  return templates;
}

export function listEnabledTemplatesForEvent(
  databasePath: string,
  projectId: string,
  eventType: string,
): KnowledgeTemplate[] {
  const db = openKnowledgeTemplateDb(databasePath);
  const raw = db
    .prepare(
      "SELECT * FROM knowledge_templates WHERE project_id = ? AND event_type = ? AND enabled = 1",
    )
    .all(projectId, eventType);
  if (Array.isArray(raw) !== true) {
    return [];
  }
  const templates: KnowledgeTemplate[] = [];
  for (const entry of raw) {
    const parsed = templateRowSchema.safeParse(entry);
    if (parsed.success !== true) {
      continue;
    }
    const template = templateFromRow(parsed.data);
    if (template !== null) {
      templates.push(template);
    }
  }
  return templates;
}

const marketplaceIdRowSchema = z.object({
  marketplace_id: z.string().min(1),
});

export function listMarketplaceInstallIds(db: Database.Database, projectId: string): string[] {
  const raw = db
    .prepare(
      "SELECT marketplace_id FROM knowledge_templates WHERE project_id = ? AND marketplace_id != ''",
    )
    .all(projectId);
  const ids: string[] = [];
  if (Array.isArray(raw) !== true) {
    return ids;
  }
  for (const entry of raw) {
    const parsed = marketplaceIdRowSchema.safeParse(entry);
    if (parsed.success !== true) {
      continue;
    }
    ids.push(parsed.data.marketplace_id);
  }
  return ids;
}

export function findMarketplaceInstall(
  db: Database.Database,
  projectId: string,
  marketplaceId: string,
): KnowledgeTemplate | null {
  const trimmed = marketplaceId.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = templateRowSchema.safeParse(
    db
      .prepare("SELECT * FROM knowledge_templates WHERE project_id = ? AND marketplace_id = ?")
      .get(projectId, trimmed),
  );
  if (parsed.success !== true) {
    return null;
  }
  return templateFromRow(parsed.data);
}

export function insertMarketplaceInstall(
  db: Database.Database,
  input: {
    projectId: string;
    marketplaceId: string;
    kind: KnowledgeKind;
    title: string;
    eventType: string;
    description: string;
    language: string;
    createdBy: string;
  },
): KnowledgeTemplate {
  const existing = findMarketplaceInstall(db, input.projectId, input.marketplaceId);
  if (existing !== null) {
    return existing;
  }
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    "INSERT INTO knowledge_templates (id, project_id, kind, title, event_type, schedule_cron, description, language, ai_tool_id, enabled, marketplace_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    input.projectId,
    input.kind,
    input.title.slice(0, 200),
    input.eventType,
    "",
    input.description,
    input.language,
    "",
    0,
    input.marketplaceId,
    createdAt,
    input.createdBy,
  );
  const created = getTemplate(db, id);
  if (created === null) {
    throw new Error("template missing");
  }
  return created;
}

export function deleteMarketplaceInstall(
  db: Database.Database,
  projectId: string,
  marketplaceId: string,
): KnowledgeTemplate | null {
  const existing = findMarketplaceInstall(db, projectId, marketplaceId);
  if (existing === null) {
    return null;
  }
  db.prepare("DELETE FROM knowledge_templates WHERE id = ?").run(existing.id);
  const gone = findMarketplaceInstall(db, projectId, marketplaceId);
  if (gone !== null) {
    throw new Error("uninstall failed");
  }
  return existing;
}

export async function fireKnowledgeTemplatesForEvent(input: {
  databasePath: string;
  projectId: string;
  eventId: string;
  eventType: string;
  path: string;
  detail: string;
  createdAt: number;
  projectCwd?: (projectId: string) => string;
  runAgent?: AgentRunFn;
  onAgentError?: (failure: { templateId: string; eventId: string; message: string }) => void;
}): Promise<void> {
  const templates = listEnabledTemplatesForEvent(
    input.databasePath,
    input.projectId,
    input.eventType,
  );
  if (templates.length === 0) {
    return;
  }
  const at = new Date(input.createdAt);
  const db = openKnowledgeTemplateDb(input.databasePath);
  for (const template of templates) {
    if (templateDueAt(template, at) !== true) {
      continue;
    }
    const artifactId = randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare(
      "INSERT INTO knowledge_artifacts (id, project_id, template_id, kind, title, body, language, event_type, event_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      artifactId,
      template.projectId,
      template.id,
      template.kind,
      template.title,
      "",
      template.language,
      input.eventType,
      input.eventId,
      createdAt,
    );
    try {
      const prompt = artifactPrompt(template, input.eventType, input.detail, input.path);
      const text = await runProjectAgentPrompt({
        databasePath: input.databasePath,
        projectId: template.projectId,
        prompt,
        systemPrompt: KNOWLEDGE_AGENT_SYSTEM,
        projectCwd: input.projectCwd,
        runAgent: input.runAgent,
        aiToolId: template.aiToolId,
      });
      if (text.trim().length > 0) {
        db.prepare("UPDATE knowledge_artifacts SET body = ? WHERE id = ?").run(text, artifactId);
      }
    } catch (err) {
      let message = "agent failed";
      if (err instanceof Error && err.message.length > 0) {
        message = err.message;
      }
      if (input.onAgentError !== undefined) {
        input.onAgentError({
          templateId: template.id,
          eventId: input.eventId,
          message,
        });
      }
      continue;
    }
  }
}

export async function registerKnowledgeTemplatesModule(
  app: FastifyInstance,
  options: ModuleOptions,
): Promise<void> {
  const db = openKnowledgeTemplateDb(options.databasePath);

  app.get<{ Querystring: { projectId?: string; kind?: string } }>(
    "/api/knowledge/templates",
    async (request, reply) => {
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
      const kindParsed = kindSchema.safeParse(request.query.kind);
      if (kindParsed.success !== true) {
        return reply.code(400).send({ error: "kind required" });
      }
      for (const viewer of viewers) {
        if (!canSeeProject(options, projectId, viewer.sub)) {
          return reply.code(404).send({ error: "not found" });
        }
        return { templates: listTemplates(db, projectId, kindParsed.data) };
      }
      return reply.code(401).send({ error: "unauthorized" });
    },
  );

  app.post("/api/knowledge/templates", async (request, reply) => {
    const viewers = await viewersFrom(request, options);
    if (viewers.length === 0) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = createTemplateSchema.safeParse(request.body);
    if (parsed.success !== true) {
      return reply.code(400).send({ error: "Invalid template" });
    }
    let incomingCron = "";
    if (parsed.data.scheduleCron !== undefined) {
      incomingCron = parsed.data.scheduleCron;
    }
    let bound;
    try {
      bound = bindTemplateTrigger(options.databasePath, parsed.data.eventType, incomingCron);
    } catch {
      return reply.code(400).send({ error: "Invalid template" });
    }
    for (const viewer of viewers) {
      if (!canSeeProject(options, parsed.data.projectId, viewer.sub)) {
        return reply.code(404).send({ error: "not found" });
      }
      let enabled = 1;
      if (parsed.data.enabled === false) {
        enabled = 0;
      }
      let aiToolId = "";
      try {
        if (parsed.data.aiToolId !== undefined) {
          aiToolId = await requireConnectedAiToolId(
            openSettingsDb(options.databasePath),
            parsed.data.aiToolId,
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Invalid AI tool";
        return reply.code(400).send({ error: message });
      }
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      db.prepare(
        "INSERT INTO knowledge_templates (id, project_id, kind, title, event_type, schedule_cron, description, language, ai_tool_id, enabled, marketplace_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        id,
        parsed.data.projectId,
        parsed.data.kind,
        parsed.data.title.slice(0, 200),
        bound.eventType,
        bound.scheduleCron,
        parsed.data.description,
        parsed.data.language,
        aiToolId,
        enabled,
        "",
        createdAt,
        viewer.email,
      );
      const created = getTemplate(db, id);
      if (created === null) {
        return reply.code(500).send({ error: "template missing" });
      }
      return reply.code(201).send(created);
    }
    return reply.code(401).send({ error: "unauthorized" });
  });

  app.patch<{ Params: { templateId: string } }>(
    "/api/knowledge/templates/:templateId",
    async (request, reply) => {
      const viewers = await viewersFrom(request, options);
      if (viewers.length === 0) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const existing = getTemplate(db, request.params.templateId);
      if (existing === null) {
        return reply.code(404).send({ error: "not found" });
      }
      const parsed = patchTemplateSchema.safeParse(request.body);
      if (parsed.success !== true) {
        return reply.code(400).send({ error: "Invalid template" });
      }
      for (const viewer of viewers) {
        if (!canSeeProject(options, existing.projectId, viewer.sub)) {
          return reply.code(404).send({ error: "not found" });
        }
        let title = existing.title;
        if (parsed.data.title !== undefined) {
          title = parsed.data.title.slice(0, 200);
        }
        let incomingEvent = existing.eventType;
        if (parsed.data.eventType !== undefined) {
          incomingEvent = parsed.data.eventType;
        }
        let incomingCron = existing.scheduleCron;
        if (parsed.data.scheduleCron !== undefined) {
          incomingCron = parsed.data.scheduleCron;
        }
        let bound;
        try {
          bound = bindTemplateTrigger(options.databasePath, incomingEvent, incomingCron);
        } catch {
          return reply.code(400).send({ error: "Invalid template" });
        }
        let description = existing.description;
        if (parsed.data.description !== undefined) {
          description = parsed.data.description;
        }
        let language = existing.language;
        if (parsed.data.language !== undefined) {
          language = parsed.data.language;
        }
        let enabled = existing.enabled ? 1 : 0;
        if (parsed.data.enabled !== undefined) {
          enabled = parsed.data.enabled ? 1 : 0;
        }
        let aiToolId = existing.aiToolId;
        if (parsed.data.aiToolId !== undefined) {
          try {
            aiToolId = await requireConnectedAiToolId(
              openSettingsDb(options.databasePath),
              parsed.data.aiToolId,
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : "Invalid AI tool";
            return reply.code(400).send({ error: message });
          }
        }
        db.prepare(
          "UPDATE knowledge_templates SET title = ?, event_type = ?, schedule_cron = ?, description = ?, language = ?, ai_tool_id = ?, enabled = ? WHERE id = ?",
        ).run(title, bound.eventType, bound.scheduleCron, description, language, aiToolId, enabled, existing.id);
        const updated = getTemplate(db, existing.id);
        if (updated === null) {
          return reply.code(500).send({ error: "template missing" });
        }
        return updated;
      }
      return reply.code(401).send({ error: "unauthorized" });
    },
  );

  app.delete<{ Params: { templateId: string } }>(
    "/api/knowledge/templates/:templateId",
    async (request, reply) => {
      const viewers = await viewersFrom(request, options);
      if (viewers.length === 0) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const existing = getTemplate(db, request.params.templateId);
      if (existing === null) {
        return reply.code(404).send({ error: "not found" });
      }
      for (const viewer of viewers) {
        if (!canSeeProject(options, existing.projectId, viewer.sub)) {
          return reply.code(404).send({ error: "not found" });
        }
        db.prepare("DELETE FROM knowledge_templates WHERE id = ?").run(existing.id);
        return { ok: true };
      }
      return reply.code(401).send({ error: "unauthorized" });
    },
  );

  app.get<{ Querystring: { projectId?: string; kind?: string } }>(
    "/api/knowledge/artifacts",
    async (request, reply) => {
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
      const kindParsed = kindSchema.safeParse(request.query.kind);
      if (kindParsed.success !== true) {
        return reply.code(400).send({ error: "kind required" });
      }
      for (const viewer of viewers) {
        if (!canSeeProject(options, projectId, viewer.sub)) {
          return reply.code(404).send({ error: "not found" });
        }
        return { artifacts: listArtifacts(db, projectId, kindParsed.data) };
      }
      return reply.code(401).send({ error: "unauthorized" });
    },
  );

  app.get<{ Params: { artifactId: string } }>(
    "/api/knowledge/artifacts/:artifactId",
    async (request, reply) => {
      const viewers = await viewersFrom(request, options);
      if (viewers.length === 0) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const artifact = getArtifact(db, request.params.artifactId);
      if (artifact === null) {
        return reply.code(404).send({ error: "not found" });
      }
      for (const viewer of viewers) {
        if (!canSeeProject(options, artifact.projectId, viewer.sub)) {
          return reply.code(404).send({ error: "not found" });
        }
        return artifact;
      }
      return reply.code(401).send({ error: "unauthorized" });
    },
  );

  app.patch<{ Params: { artifactId: string } }>(
    "/api/knowledge/artifacts/:artifactId",
    async (request, reply) => {
      const viewers = await viewersFrom(request, options);
      if (viewers.length === 0) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const existing = getArtifact(db, request.params.artifactId);
      if (existing === null) {
        return reply.code(404).send({ error: "not found" });
      }
      const parsed = patchArtifactSchema.safeParse(request.body);
      if (parsed.success !== true) {
        return reply.code(400).send({ error: "Invalid artifact" });
      }
      for (const viewer of viewers) {
        if (!canSeeProject(options, existing.projectId, viewer.sub)) {
          return reply.code(404).send({ error: "not found" });
        }
        let title = existing.title;
        if (parsed.data.title !== undefined) {
          title = parsed.data.title.slice(0, 200);
        }
        let body = existing.body;
        if (parsed.data.body !== undefined) {
          body = parsed.data.body;
        }
        db.prepare("UPDATE knowledge_artifacts SET title = ?, body = ? WHERE id = ?").run(
          title,
          body,
          existing.id,
        );
        const updated = getArtifact(db, existing.id);
        if (updated === null) {
          return reply.code(500).send({ error: "artifact missing" });
        }
        return updated;
      }
      return reply.code(401).send({ error: "unauthorized" });
    },
  );

  app.delete<{ Params: { artifactId: string } }>(
    "/api/knowledge/artifacts/:artifactId",
    async (request, reply) => {
      const viewers = await viewersFrom(request, options);
      if (viewers.length === 0) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const existing = getArtifact(db, request.params.artifactId);
      if (existing === null) {
        return reply.code(404).send({ error: "not found" });
      }
      for (const viewer of viewers) {
        if (!canSeeProject(options, existing.projectId, viewer.sub)) {
          return reply.code(404).send({ error: "not found" });
        }
        db.prepare("DELETE FROM knowledge_artifacts WHERE id = ?").run(existing.id);
        return { ok: true };
      }
      return reply.code(401).send({ error: "unauthorized" });
    },
  );

  app.addHook("onClose", async () => {
    db.close();
  });
}
