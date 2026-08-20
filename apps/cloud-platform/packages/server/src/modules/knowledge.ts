import Database from "better-sqlite3";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getProjectById, userCanAccessProject } from "../../../../../task-bridge/apps/backend/dist/services/project-registry.js";
import { loadAppSettings, openSettingsDb } from "../app-settings.js";
import {
  AGENT_TIMEOUT_MS,
  agentCliSpec,
  spawnAgentCli,
  type AgentKind,
  type AgentMode,
} from "../agent-runtime.js";
import { loadAgentProfile, openAgentDb } from "../agent-store.js";
import { requireExistingDirectory } from "../folder-path.js";
import { languageLabel } from "../note-language.js";
import { runOllamaChat } from "../ollama.js";
import type { Identity } from "./identity.js";

export type KnowledgeIntent = "process" | "api" | "overview";
export type KnowledgeAudience = "developer" | "ops" | "frontend";
export type KnowledgeView = "all" | "documentation" | "diagrams";
export type KnowledgeOutputKind = "document" | "diagram";

type KnowledgeOutput = {
  currentBody: string;
  proposedBody: string;
  currentVersion: number;
  proposedVersion: number;
  sourcesText: string;
};

type KnowledgeItem = {
  id: string;
  projectId: string;
  subject: string;
  intent: KnowledgeIntent;
  audience: KnowledgeAudience;
  language: string;
  stale: boolean;
  createdAt: string;
  createdBy: string;
  document: KnowledgeOutput;
  diagram: KnowledgeOutput;
};

type Viewer = { email: string; sub: string };

const itemRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  subject: z.string(),
  intent: z.string(),
  audience: z.string(),
  language: z.string(),
  stale: z.number(),
  created_at: z.string(),
  created_by: z.string(),
});

const outputRowSchema = z.object({
  item_id: z.string(),
  current_body: z.string(),
  proposed_body: z.string(),
  current_version: z.number(),
  proposed_version: z.number(),
  sources_text: z.string(),
});

export type AgentRunFn = (input: {
  kind: AgentKind;
  mode: AgentMode;
  prompt: string;
  cwd: string;
}) => Promise<string>;

type AgentHost = {
  databasePath: string;
  projectCwd?: (projectId: string) => string;
  runAgent?: AgentRunFn;
};

type KnowledgeOptions = AgentHost & {
  identity: Identity;
  projectAccess?: (projectId: string, userId: string) => boolean;
};

const createSchema = z.object({
  projectId: z.string().trim().min(1),
  subject: z.string().trim().min(1),
  intent: z.enum(["process", "api", "overview"]),
  audience: z.enum(["developer", "ops", "frontend"]),
  language: z.string().trim().min(1),
});

const patchBriefSchema = z.object({
  subject: z.string().trim().min(1).optional(),
  intent: z.enum(["process", "api", "overview"]).optional(),
  audience: z.enum(["developer", "ops", "frontend"]).optional(),
  language: z.string().trim().min(1).optional(),
  stale: z.boolean().optional(),
});

const patchOutputSchema = z.object({
  currentBody: z.string().optional(),
  proposedBody: z.string().optional(),
  sourcesText: z.string().optional(),
});

function canSeeProject(options: KnowledgeOptions, projectId: string, userId: string): boolean {
  if (options.projectAccess !== undefined) {
    return options.projectAccess(projectId, userId);
  }
  return userCanAccessProject(projectId, userId);
}

function isIntent(value: string): value is KnowledgeIntent {
  return value === "process" || value === "api" || value === "overview";
}

function isAudience(value: string): value is KnowledgeAudience {
  return value === "developer" || value === "ops" || value === "frontend";
}

function parseView(value: string): KnowledgeView {
  if (value === "documentation" || value === "diagrams") {
    return value;
  }
  return "all";
}

function emptyOutput(): KnowledgeOutput {
  return {
    currentBody: "",
    proposedBody: "",
    currentVersion: 0,
    proposedVersion: 0,
    sourcesText: "",
  };
}

function outputFromRow(row: z.infer<typeof outputRowSchema>): KnowledgeOutput {
  return {
    currentBody: row.current_body,
    proposedBody: row.proposed_body,
    currentVersion: row.current_version,
    proposedVersion: row.proposed_version,
    sourcesText: row.sources_text,
  };
}

function outputHasContent(output: KnowledgeOutput): boolean {
  return output.currentVersion > 0 || output.proposedVersion > 0 || output.currentBody.trim().length > 0 || output.proposedBody.trim().length > 0;
}

export function openKnowledgeDb(databasePath: string): Database.Database {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      intent TEXT NOT NULL,
      audience TEXT NOT NULL,
      language TEXT NOT NULL,
      stale INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_items_project ON knowledge_items(project_id);
    CREATE TABLE IF NOT EXISTS knowledge_documents (
      item_id TEXT PRIMARY KEY,
      current_body TEXT NOT NULL DEFAULT '',
      proposed_body TEXT NOT NULL DEFAULT '',
      current_version INTEGER NOT NULL DEFAULT 0,
      proposed_version INTEGER NOT NULL DEFAULT 0,
      sources_text TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (item_id) REFERENCES knowledge_items(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS knowledge_diagrams (
      item_id TEXT PRIMARY KEY,
      current_body TEXT NOT NULL DEFAULT '',
      proposed_body TEXT NOT NULL DEFAULT '',
      current_version INTEGER NOT NULL DEFAULT 0,
      proposed_version INTEGER NOT NULL DEFAULT 0,
      sources_text TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (item_id) REFERENCES knowledge_items(id) ON DELETE CASCADE
    );
  `);
  return db;
}

function outputTable(kind: KnowledgeOutputKind): string {
  if (kind === "document") {
    return "knowledge_documents";
  }
  return "knowledge_diagrams";
}

function getOutput(db: Database.Database, kind: KnowledgeOutputKind, itemId: string): KnowledgeOutput {
  const table = outputTable(kind);
  const parsed = outputRowSchema.safeParse(
    db.prepare(`SELECT * FROM ${table} WHERE item_id = ?`).get(itemId),
  );
  if (parsed.success !== true) {
    return emptyOutput();
  }
  return outputFromRow(parsed.data);
}

function itemsById(db: Database.Database, id: string): KnowledgeItem[] {
  const parsed = itemRowSchema.safeParse(db.prepare("SELECT * FROM knowledge_items WHERE id = ?").get(id));
  if (parsed.success !== true) {
    return [];
  }
  if (!isIntent(parsed.data.intent) || !isAudience(parsed.data.audience)) {
    return [];
  }
  return [
    {
      id: parsed.data.id,
      projectId: parsed.data.project_id,
      subject: parsed.data.subject,
      intent: parsed.data.intent,
      audience: parsed.data.audience,
      language: parsed.data.language,
      stale: parsed.data.stale === 1,
      createdAt: parsed.data.created_at,
      createdBy: parsed.data.created_by,
      document: getOutput(db, "document", parsed.data.id),
      diagram: getOutput(db, "diagram", parsed.data.id),
    },
  ];
}

async function viewersFrom(request: FastifyRequest, options: KnowledgeOptions): Promise<Viewer[]> {
  const user = await options.identity.userFrom(request);
  if (user === null) {
    return [];
  }
  return [{ email: user.email, sub: user.id }];
}

function projectCwd(options: AgentHost, projectId: string): string {
  if (options.projectCwd !== undefined) {
    return options.projectCwd(projectId);
  }
  const project = getProjectById(projectId);
  if (project === null) {
    throw new Error("Project folder is missing");
  }
  return requireExistingDirectory(project.repoPath);
}

function documentationPrompt(item: KnowledgeItem): string {
  const label = languageLabel(item.language);
  return [
    `Write project documentation for this knowledge brief.`,
    `Subject: ${item.subject}`,
    `Intent: ${item.intent}`,
    `Audience: ${item.audience}`,
    `Language: ${label}`,
    `Return only the document in ${label}. Do not wrap it in commentary.`,
    `Current document:`,
    item.document.currentBody,
  ].join("\n");
}

function diagramPrompt(item: KnowledgeItem): string {
  return [
    `Write a Mermaid diagram for this knowledge brief.`,
    `Subject: ${item.subject}`,
    `Intent: ${item.intent}`,
    `Audience: ${item.audience}`,
    `Return only Mermaid source. No markdown fences.`,
    `Current diagram:`,
    item.diagram.currentBody,
  ].join("\n");
}

async function defaultRunAgent(
  options: AgentHost,
  input: { kind: AgentKind; mode: AgentMode; prompt: string; cwd: string },
): Promise<string> {
  if (options.runAgent !== undefined) {
    return options.runAgent(input);
  }
  if (input.kind === "ollama") {
    const settingsDb = openSettingsDb(options.databasePath);
    const settings = loadAppSettings(settingsDb);
    return runOllamaChat(settings.ollamaHost, settings.ollamaModel, "You write knowledge artifacts.", input.prompt);
  }
  const profile = loadAgentProfile(openAgentDb(options.databasePath));
  const spec = agentCliSpec({
    kind: input.kind,
    mode: input.mode,
    command: profile.command,
    prompt: input.prompt,
  });
  return spawnAgentCli(spec, input.cwd, AGENT_TIMEOUT_MS);
}

function writeOutput(
  db: Database.Database,
  kind: KnowledgeOutputKind,
  itemId: string,
  output: KnowledgeOutput,
): void {
  const table = outputTable(kind);
  db.prepare(
    `UPDATE ${table} SET current_body = ?, proposed_body = ?, current_version = ?, proposed_version = ?, sources_text = ? WHERE item_id = ?`,
  ).run(
    output.currentBody,
    output.proposedBody,
    output.currentVersion,
    output.proposedVersion,
    output.sourcesText,
    itemId,
  );
}

function applyProposed(
  db: Database.Database,
  kind: KnowledgeOutputKind,
  item: KnowledgeItem,
  text: string,
): void {
  let output = item.document;
  if (kind === "diagram") {
    output = item.diagram;
  }
  writeOutput(db, kind, item.id, {
    currentBody: output.currentBody,
    proposedBody: text,
    currentVersion: output.currentVersion,
    proposedVersion: output.currentVersion + 1,
    sourcesText: output.sourcesText,
  });
}

export async function runKnowledgeAutomation(input: {
  databasePath: string;
  itemId: string;
  projectId: string;
  outputs: readonly KnowledgeOutputKind[];
  runAgent?: AgentRunFn;
  projectCwd?: (projectId: string) => string;
}): Promise<void> {
  const db = openKnowledgeDb(input.databasePath);
  const found = itemsById(db, input.itemId);
  const matched: KnowledgeItem[] = [];
  for (const item of found) {
    if (item.projectId === input.projectId) {
      matched.push(item);
    }
  }
  if (matched.length === 0) {
    throw new Error("knowledge not found");
  }
  const host: AgentHost = {
    databasePath: input.databasePath,
    projectCwd: input.projectCwd,
    runAgent: input.runAgent,
  };
  for (const item of matched) {
    try {
      for (const kind of input.outputs) {
        const freshItems = itemsById(db, item.id);
        if (freshItems.length === 0) {
          throw new Error("knowledge not found");
        }
        for (const fresh of freshItems) {
          let prompt = documentationPrompt(fresh);
          if (kind === "diagram") {
            prompt = diagramPrompt(fresh);
          }
          const profile = loadAgentProfile(openAgentDb(input.databasePath));
          const cwd = projectCwd(host, item.projectId);
          const text = await defaultRunAgent(host, {
            kind: profile.kind,
            mode: profile.mode,
            prompt,
            cwd,
          });
          if (text.trim().length === 0) {
            throw new Error("Agent returned empty text");
          }
          applyProposed(db, kind, fresh, text);
        }
      }
      db.prepare("UPDATE knowledge_items SET stale = 0 WHERE id = ?").run(item.id);
    } catch (err) {
      db.prepare("UPDATE knowledge_items SET stale = 1 WHERE id = ?").run(item.id);
      throw err;
    }
  }
}

export async function registerKnowledgeModule(
  app: FastifyInstance,
  options: KnowledgeOptions,
): Promise<void> {
  const db = openKnowledgeDb(options.databasePath);

  async function requireItem(
    request: FastifyRequest,
    reply: { code: (status: number) => { send: (body: { error: string }) => unknown } },
    itemId: string,
  ): Promise<KnowledgeItem[]> {
    const viewers = await viewersFrom(request, options);
    if (viewers.length === 0) {
      reply.code(401).send({ error: "unauthorized" });
      return [];
    }
    const items = itemsById(db, itemId);
    const visible: KnowledgeItem[] = [];
    for (const viewer of viewers) {
      for (const item of items) {
        if (canSeeProject(options, item.projectId, viewer.sub)) {
          visible.push(item);
        }
      }
    }
    if (visible.length === 0) {
      reply.code(404).send({ error: "not found" });
      return [];
    }
    return visible;
  }

  function saveOutput(kind: KnowledgeOutputKind, itemId: string, output: KnowledgeOutput): void {
    writeOutput(db, kind, itemId, output);
  }

  function patchOutput(kind: KnowledgeOutputKind, item: KnowledgeItem, patch: z.infer<typeof patchOutputSchema>): KnowledgeItem {
    let output = item.document;
    if (kind === "diagram") {
      output = item.diagram;
    }
    let currentBody = output.currentBody;
    let currentVersion = output.currentVersion;
    let proposedBody = output.proposedBody;
    let proposedVersion = output.proposedVersion;
    let sourcesText = output.sourcesText;
    if (patch.currentBody !== undefined) {
      currentBody = patch.currentBody;
      currentVersion = output.currentVersion + 1;
    }
    if (patch.proposedBody !== undefined) {
      proposedBody = patch.proposedBody;
      proposedVersion = currentVersion + 1;
    }
    if (patch.sourcesText !== undefined) {
      sourcesText = patch.sourcesText;
    }
    const next: KnowledgeOutput = {
      currentBody,
      proposedBody,
      currentVersion,
      proposedVersion,
      sourcesText,
    };
    saveOutput(kind, item.id, next);
    const stored = itemsById(db, item.id);
    for (const nextItem of stored) {
      return nextItem;
    }
    throw new Error("knowledge missing");
  }

  function approveOutput(kind: KnowledgeOutputKind, item: KnowledgeItem): KnowledgeItem[] {
    let output = item.document;
    if (kind === "diagram") {
      output = item.diagram;
    }
    if (output.proposedBody.trim().length === 0) {
      return [];
    }
    const next: KnowledgeOutput = {
      currentBody: output.proposedBody,
      proposedBody: "",
      currentVersion: output.proposedVersion,
      proposedVersion: 0,
      sourcesText: output.sourcesText,
    };
    saveOutput(kind, item.id, next);
    return itemsById(db, item.id);
  }

  app.get<{ Querystring: { projectId?: string; view?: string } }>("/api/knowledge", async (request, reply) => {
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
    let viewRaw = "all";
    if (request.query.view !== undefined) {
      viewRaw = request.query.view;
    }
    const view = parseView(viewRaw);
    const items: KnowledgeItem[] = [];
    for (const viewer of viewers) {
      if (!canSeeProject(options, projectId, viewer.sub)) {
        return reply.code(404).send({ error: "not found" });
      }
      const raw = db
        .prepare("SELECT id FROM knowledge_items WHERE project_id = ? ORDER BY created_at DESC")
        .all(projectId);
      if (Array.isArray(raw) !== true) {
        continue;
      }
      for (const entry of raw) {
        const parsed = z.object({ id: z.string() }).safeParse(entry);
        if (parsed.success !== true) {
          continue;
        }
        const loaded = itemsById(db, parsed.data.id);
        for (const item of loaded) {
          if (view === "documentation" && !outputHasContent(item.document)) {
            continue;
          }
          if (view === "diagrams" && !outputHasContent(item.diagram)) {
            continue;
          }
          items.push(item);
        }
      }
    }
    return { items };
  });

  app.post("/api/knowledge", async (request, reply) => {
    const viewers = await viewersFrom(request, options);
    if (viewers.length === 0) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid knowledge" });
    }
    for (const viewer of viewers) {
      if (!canSeeProject(options, parsed.data.projectId, viewer.sub)) {
        return reply.code(404).send({ error: "not found" });
      }
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      db.prepare(
        "INSERT INTO knowledge_items (id, project_id, subject, intent, audience, language, stale, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)",
      ).run(
        id,
        parsed.data.projectId,
        parsed.data.subject.slice(0, 200),
        parsed.data.intent,
        parsed.data.audience,
        parsed.data.language,
        createdAt,
        viewer.email,
      );
      db.prepare("INSERT INTO knowledge_documents (item_id) VALUES (?)").run(id);
      db.prepare("INSERT INTO knowledge_diagrams (item_id) VALUES (?)").run(id);
      const created = itemsById(db, id);
      for (const item of created) {
        return reply.code(201).send(item);
      }
      return reply.code(500).send({ error: "knowledge missing" });
    }
    return reply.code(401).send({ error: "unauthorized" });
  });

  app.get<{ Params: { itemId: string } }>(
    "/api/knowledge/:itemId([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})",
    async (request, reply) => {
    const loaded = await requireItem(request, reply, request.params.itemId);
    for (const item of loaded) {
      return item;
    }
    return;
  });

  app.patch<{ Params: { itemId: string } }>(
    "/api/knowledge/:itemId([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})",
    async (request, reply) => {
    const loaded = await requireItem(request, reply, request.params.itemId);
    for (const item of loaded) {
      const parsed = patchBriefSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid knowledge" });
      }
      let subject = item.subject;
      if (parsed.data.subject !== undefined) {
        subject = parsed.data.subject.slice(0, 200);
      }
      let intent = item.intent;
      if (parsed.data.intent !== undefined) {
        intent = parsed.data.intent;
      }
      let audience = item.audience;
      if (parsed.data.audience !== undefined) {
        audience = parsed.data.audience;
      }
      let language = item.language;
      if (parsed.data.language !== undefined) {
        language = parsed.data.language;
      }
      let stale = item.stale ? 1 : 0;
      if (parsed.data.stale !== undefined) {
        stale = parsed.data.stale ? 1 : 0;
      }
      db.prepare(
        "UPDATE knowledge_items SET subject = ?, intent = ?, audience = ?, language = ?, stale = ? WHERE id = ?",
      ).run(subject, intent, audience, language, stale, item.id);
      const nextItems = itemsById(db, item.id);
      for (const next of nextItems) {
        return next;
      }
      return reply.code(404).send({ error: "not found" });
    }
    return;
  });

  app.delete<{ Params: { itemId: string } }>(
    "/api/knowledge/:itemId([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})",
    async (request, reply) => {
    const loaded = await requireItem(request, reply, request.params.itemId);
    for (const item of loaded) {
      db.prepare("DELETE FROM knowledge_items WHERE id = ?").run(item.id);
      return { ok: true };
    }
    return;
  });

  app.patch<{ Params: { itemId: string } }>(
    "/api/knowledge/:itemId([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/document",
    async (request, reply) => {
    const loaded = await requireItem(request, reply, request.params.itemId);
    for (const item of loaded) {
      const parsed = patchOutputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid document" });
      }
      return patchOutput("document", item, parsed.data);
    }
    return;
  });

  app.patch<{ Params: { itemId: string } }>(
    "/api/knowledge/:itemId([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/diagram",
    async (request, reply) => {
    const loaded = await requireItem(request, reply, request.params.itemId);
    for (const item of loaded) {
      const parsed = patchOutputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid diagram" });
      }
      return patchOutput("diagram", item, parsed.data);
    }
    return;
  });

  app.post<{ Params: { itemId: string } }>(
    "/api/knowledge/:itemId([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/document/approve",
    async (request, reply) => {
    const loaded = await requireItem(request, reply, request.params.itemId);
    for (const item of loaded) {
      const next = approveOutput("document", item);
      if (next.length === 0) {
        return reply.code(400).send({ error: "Nothing to approve" });
      }
      for (const approved of next) {
        return approved;
      }
    }
    return;
  });

  app.post<{ Params: { itemId: string } }>(
    "/api/knowledge/:itemId([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/diagram/approve",
    async (request, reply) => {
    const loaded = await requireItem(request, reply, request.params.itemId);
    for (const item of loaded) {
      const next = approveOutput("diagram", item);
      if (next.length === 0) {
        return reply.code(400).send({ error: "Nothing to approve" });
      }
      for (const approved of next) {
        return approved;
      }
    }
    return;
  });

  app.post<{ Params: { itemId: string } }>(
    "/api/knowledge/:itemId([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/document/propose",
    async (request, reply) => {
    const loaded = await requireItem(request, reply, request.params.itemId);
    for (const item of loaded) {
      const profile = loadAgentProfile(openAgentDb(options.databasePath));
      try {
        const cwd = projectCwd(options, item.projectId);
        const text = await defaultRunAgent(options, {
          kind: profile.kind,
          mode: profile.mode,
          prompt: documentationPrompt(item),
          cwd,
        });
        if (text.trim().length === 0) {
          return reply.code(502).send({ error: "Agent returned empty text" });
        }
        return patchOutput("document", item, { proposedBody: text });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Agent failed";
        return reply.code(502).send({ error: message });
      }
    }
    return;
  });

  app.post<{ Params: { itemId: string } }>(
    "/api/knowledge/:itemId([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/diagram/propose",
    async (request, reply) => {
    const loaded = await requireItem(request, reply, request.params.itemId);
    for (const item of loaded) {
      const profile = loadAgentProfile(openAgentDb(options.databasePath));
      try {
        const cwd = projectCwd(options, item.projectId);
        const text = await defaultRunAgent(options, {
          kind: profile.kind,
          mode: profile.mode,
          prompt: diagramPrompt(item),
          cwd,
        });
        if (text.trim().length === 0) {
          return reply.code(502).send({ error: "Agent returned empty text" });
        }
        return patchOutput("diagram", item, { proposedBody: text });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Agent failed";
        return reply.code(502).send({ error: message });
      }
    }
    return;
  });
}
