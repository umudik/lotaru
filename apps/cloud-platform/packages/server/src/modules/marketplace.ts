import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  userCanAccessProject,
} from "../../../../../task-bridge/apps/backend/dist/services/project-registry.js";
import { loadAppSettings, openSettingsDb } from "../app-settings.js";
import { EVENT_FILE_CHANGED } from "../events.js";
import { subscriberMaySelect } from "../event-registry.js";
import { connectedKindsAt } from "../connection-store.js";
import {
  MARKETPLACE_CATALOG,
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_PACK_FORMAT,
  MARKETPLACE_PACK_VERSION,
  isBuiltinMarketplaceId,
  marketplaceCategoryLabel,
  marketplacePackFromItems,
  parseMarketplacePack,
} from "../marketplace-catalog.js";
import type { MarketplaceCatalogItem, MarketplacePack } from "../marketplace-catalog.js";
import type { Identity } from "./identity.js";
import {
  deleteMarketplaceInstall,
  findMarketplaceInstall,
  insertMarketplaceInstall,
  listMarketplaceInstallIds,
  openKnowledgeTemplateDb,
} from "./knowledge-templates.js";
import {
  deleteMarketplaceScript,
  findMarketplaceScript,
  insertMarketplaceScript,
  listMarketplaceScriptIds,
} from "../marketplace-script-store.js";
import {
  deleteMarketplaceTask,
  findMarketplaceTask,
  insertMarketplaceTask,
  listMarketplaceTaskIds,
} from "../marketplace-task-store.js";
import {
  deleteImportedMarketplaceItem,
  listImportedMarketplaceItems,
  upsertImportedMarketplaceItem,
} from "../marketplace-import-store.js";

type MarketplaceOptions = {
  databasePath: string;
  identity: Identity;
  projectAccess?: (projectId: string, userId: string) => boolean;
};

type Viewer = { email: string; sub: string };

const projectQuerySchema = z.object({
  projectId: z.string().trim().min(1),
});

const installBodySchema = z
  .object({
    projectId: z.string().trim().min(1),
    catalogId: z.string().trim().min(1),
  })
  .strict();

const importBodySchema = z
  .object({
    projectId: z.string().trim().min(1),
    format: z.literal(MARKETPLACE_PACK_FORMAT),
    version: z.literal(MARKETPLACE_PACK_VERSION),
    items: z.array(z.unknown()).min(1).max(400),
  })
  .strict();

const uninstallParamsSchema = z.object({
  catalogId: z.string().trim().min(1),
});

function canSeeProject(options: MarketplaceOptions, projectId: string, userId: string): boolean {
  const custom = options.projectAccess;
  if (custom !== undefined) {
    const allowed = custom(projectId, userId);
    if (allowed === true) {
      return true;
    }
    return false;
  }
  const registry = userCanAccessProject(projectId, userId);
  if (registry === true) {
    return true;
  }
  return false;
}

async function viewersFrom(request: FastifyRequest, options: MarketplaceOptions): Promise<Viewer[]> {
  const user = await options.identity.userFrom(request);
  if (user === null) {
    return [];
  }
  const email = user.email.trim();
  const sub = user.id.trim();
  if (email.length === 0 || sub.length === 0) {
    return [];
  }
  return [{ email, sub }];
}

function requireFileChanged(databasePath: string): void {
  const kinds = connectedKindsAt(databasePath);
  const offered = subscriberMaySelect(EVENT_FILE_CHANGED, kinds);
  if (offered === true) {
    return;
  }
  throw new Error("file.changed is not available");
}

function projectCatalogItems(databasePath: string, projectId: string): MarketplaceCatalogItem[] {
  const items: MarketplaceCatalogItem[] = [];
  const seen = new Set<string>();
  for (const entry of MARKETPLACE_CATALOG) {
    seen.add(entry.id);
    items.push(entry);
  }
  for (const imported of listImportedMarketplaceItems(databasePath, projectId)) {
    if (seen.has(imported.id) === true) {
      continue;
    }
    seen.add(imported.id);
    items.push(imported);
  }
  return items;
}

function catalogItemForProject(
  databasePath: string,
  projectId: string,
  catalogId: string,
): MarketplaceCatalogItem | null {
  for (const item of projectCatalogItems(databasePath, projectId)) {
    if (item.id === catalogId) {
      return item;
    }
  }
  return null;
}

function installedSet(ids: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const id of ids) {
    const trimmed = id.trim();
    if (trimmed.length === 0) {
      continue;
    }
    set.add(trimmed);
  }
  return set;
}

function dropMarketplaceInstalls(
  databasePath: string,
  db: ReturnType<typeof openKnowledgeTemplateDb>,
  projectId: string,
  catalogId: string,
): boolean {
  const knowledgeGone = deleteMarketplaceInstall(db, projectId, catalogId);
  if (knowledgeGone !== null) {
    return true;
  }
  const scriptGone = deleteMarketplaceScript(databasePath, projectId, catalogId);
  if (scriptGone !== null) {
    return true;
  }
  const taskGone = deleteMarketplaceTask(databasePath, projectId, catalogId);
  if (taskGone !== null) {
    return true;
  }
  return false;
}

export async function registerMarketplaceModule(
  app: FastifyInstance,
  options: MarketplaceOptions,
): Promise<void> {
  const db = openKnowledgeTemplateDb(options.databasePath);

  app.get<{ Querystring: { projectId?: string } }>(
    "/api/marketplace/catalog",
    async (request, reply) => {
      const viewers = await viewersFrom(request, options);
      if (viewers.length === 0) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const parsed = projectQuerySchema.safeParse(request.query);
      if (parsed.success !== true) {
        return reply.code(400).send({ error: "projectId required" });
      }
      for (const viewer of viewers) {
        if (canSeeProject(options, parsed.data.projectId, viewer.sub) !== true) {
          return reply.code(404).send({ error: "not found" });
        }
        const installed = installedSet(
          listMarketplaceInstallIds(db, parsed.data.projectId)
            .concat(listMarketplaceScriptIds(options.databasePath, parsed.data.projectId))
            .concat(listMarketplaceTaskIds(options.databasePath, parsed.data.projectId)),
        );
        const catalog = projectCatalogItems(options.databasePath, parsed.data.projectId);
        const items = [];
        for (const entry of catalog) {
          const categoryLabel = marketplaceCategoryLabel(entry.category);
          items.push({
            id: entry.id,
            kind: entry.kind,
            category: entry.category,
            categoryLabel,
            title: entry.title,
            summary: entry.summary,
            source: entry.source,
            installed: installed.has(entry.id),
            imported: isBuiltinMarketplaceId(entry.id) !== true,
          });
        }
        return { categories: MARKETPLACE_CATEGORIES, items };
      }
      return reply.code(401).send({ error: "unauthorized" });
    },
  );

  app.post("/api/marketplace/install", async (request, reply) => {
    const viewers = await viewersFrom(request, options);
    if (viewers.length === 0) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = installBodySchema.safeParse(request.body);
    if (parsed.success !== true) {
      return reply.code(400).send({ error: "Invalid install" });
    }
    for (const viewer of viewers) {
      if (canSeeProject(options, parsed.data.projectId, viewer.sub) !== true) {
        return reply.code(404).send({ error: "not found" });
      }
      const item = catalogItemForProject(
        options.databasePath,
        parsed.data.projectId,
        parsed.data.catalogId,
      );
      if (item === null) {
        return reply.code(404).send({ error: "not found" });
      }
      if (item.kind === "script") {
        const already = findMarketplaceScript(options.databasePath, parsed.data.projectId, item.id);
        if (already !== null) {
          return {
            id: already.id,
            projectId: parsed.data.projectId,
            kind: item.kind,
            title: item.title,
            marketplaceId: item.id,
            enabled: false,
          };
        }
        const created = insertMarketplaceScript({
          databasePath: options.databasePath,
          projectId: parsed.data.projectId,
          ownerId: viewer.sub,
          item,
        });
        return reply.code(201).send({
          id: created.id,
          projectId: parsed.data.projectId,
          kind: item.kind,
          title: item.title,
          marketplaceId: item.id,
          enabled: false,
        });
      }
      if (item.kind === "task") {
        const already = findMarketplaceTask(options.databasePath, parsed.data.projectId, item.id);
        if (already !== null) {
          return {
            id: already.stageId,
            projectId: parsed.data.projectId,
            kind: item.kind,
            title: item.title,
            marketplaceId: item.id,
            enabled: true,
          };
        }
        const created = insertMarketplaceTask({
          databasePath: options.databasePath,
          projectId: parsed.data.projectId,
          item,
        });
        return reply.code(201).send({
          id: created.stageId,
          projectId: parsed.data.projectId,
          kind: item.kind,
          title: item.title,
          marketplaceId: item.id,
          enabled: true,
        });
      }
      try {
        requireFileChanged(options.databasePath);
      } catch {
        return reply.code(400).send({ error: "Invalid install" });
      }
      if (item.kind !== "document" && item.kind !== "diagram") {
        return reply.code(400).send({ error: "Invalid install" });
      }
      const settings = loadAppSettings(openSettingsDb(options.databasePath));
      const already = findMarketplaceInstall(db, parsed.data.projectId, item.id);
      if (already !== null) {
        return already;
      }
      const created = insertMarketplaceInstall(db, {
        projectId: parsed.data.projectId,
        marketplaceId: item.id,
        kind: item.kind,
        title: item.title,
        eventType: EVENT_FILE_CHANGED,
        description: item.description,
        language: settings.targetLanguage,
        createdBy: viewer.email,
      });
      return reply.code(201).send(created);
    }
    return reply.code(401).send({ error: "unauthorized" });
  });

  app.delete<{ Params: { catalogId: string }; Querystring: { projectId?: string } }>(
    "/api/marketplace/installs/:catalogId",
    async (request, reply) => {
      const viewers = await viewersFrom(request, options);
      if (viewers.length === 0) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const paramsParsed = uninstallParamsSchema.safeParse(request.params);
      const queryParsed = projectQuerySchema.safeParse(request.query);
      if (paramsParsed.success !== true || queryParsed.success !== true) {
        return reply.code(400).send({ error: "catalogId and projectId required" });
      }
      for (const viewer of viewers) {
        if (canSeeProject(options, queryParsed.data.projectId, viewer.sub) !== true) {
          return reply.code(404).send({ error: "not found" });
        }
        if (dropMarketplaceInstalls(
          options.databasePath,
          db,
          queryParsed.data.projectId,
          paramsParsed.data.catalogId,
        ) === true) {
          return reply.code(204).send();
        }
        return reply.code(404).send({ error: "not found" });
      }
      return reply.code(401).send({ error: "unauthorized" });
    },
  );

  app.get<{ Querystring: { projectId?: string } }>(
    "/api/marketplace/export",
    async (request, reply) => {
      const viewers = await viewersFrom(request, options);
      if (viewers.length === 0) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const parsed = projectQuerySchema.safeParse(request.query);
      if (parsed.success !== true) {
        return reply.code(400).send({ error: "projectId required" });
      }
      for (const viewer of viewers) {
        if (canSeeProject(options, parsed.data.projectId, viewer.sub) !== true) {
          return reply.code(404).send({ error: "not found" });
        }
        const catalog = projectCatalogItems(options.databasePath, parsed.data.projectId);
        const pack = marketplacePackFromItems(catalog);
        reply.header("Content-Disposition", 'attachment; filename="lotaru-marketplace.json"');
        return pack;
      }
      return reply.code(401).send({ error: "unauthorized" });
    },
  );

  app.post("/api/marketplace/import", async (request, reply) => {
    const viewers = await viewersFrom(request, options);
    if (viewers.length === 0) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = importBodySchema.safeParse(request.body);
    if (parsed.success !== true) {
      return reply.code(400).send({ error: "Invalid pack" });
    }
    let pack: MarketplacePack;
    try {
      pack = parseMarketplacePack({
        format: parsed.data.format,
        version: parsed.data.version,
        items: parsed.data.items,
      });
    } catch {
      return reply.code(400).send({ error: "Invalid pack" });
    }
    for (const viewer of viewers) {
      if (canSeeProject(options, parsed.data.projectId, viewer.sub) !== true) {
        return reply.code(404).send({ error: "not found" });
      }
      let added = 0;
      let updated = 0;
      let skippedBuiltin = 0;
      for (const item of pack.items) {
        if (isBuiltinMarketplaceId(item.id) === true) {
          skippedBuiltin += 1;
          continue;
        }
        const outcome = upsertImportedMarketplaceItem({
          databasePath: options.databasePath,
          projectId: parsed.data.projectId,
          item,
        });
        if (outcome === "added") {
          added += 1;
          continue;
        }
        updated += 1;
      }
      return { added, updated, skippedBuiltin };
    }
    return reply.code(401).send({ error: "unauthorized" });
  });

  app.delete<{ Params: { catalogId: string }; Querystring: { projectId?: string } }>(
    "/api/marketplace/imported/:catalogId",
    async (request, reply) => {
      const viewers = await viewersFrom(request, options);
      if (viewers.length === 0) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const paramsParsed = uninstallParamsSchema.safeParse(request.params);
      const queryParsed = projectQuerySchema.safeParse(request.query);
      if (paramsParsed.success !== true || queryParsed.success !== true) {
        return reply.code(400).send({ error: "catalogId and projectId required" });
      }
      if (isBuiltinMarketplaceId(paramsParsed.data.catalogId) === true) {
        return reply.code(400).send({ error: "built-in items cannot be removed" });
      }
      for (const viewer of viewers) {
        if (canSeeProject(options, queryParsed.data.projectId, viewer.sub) !== true) {
          return reply.code(404).send({ error: "not found" });
        }
        dropMarketplaceInstalls(
          options.databasePath,
          db,
          queryParsed.data.projectId,
          paramsParsed.data.catalogId,
        );
        const gone = deleteImportedMarketplaceItem(
          options.databasePath,
          queryParsed.data.projectId,
          paramsParsed.data.catalogId,
        );
        if (gone === null) {
          return reply.code(404).send({ error: "not found" });
        }
        return reply.code(204).send();
      }
      return reply.code(401).send({ error: "unauthorized" });
    },
  );
}
