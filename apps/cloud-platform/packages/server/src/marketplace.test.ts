import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { z } from "zod";
import { createIdentity } from "./modules/identity.js";
import { registerMarketplaceModule } from "./modules/marketplace.js";
import { openKnowledgeTemplateDb } from "./modules/knowledge-templates.js";
import {
  MARKETPLACE_CATALOG,
  MARKETPLACE_PACK_FORMAT,
  MARKETPLACE_PACK_VERSION,
  parseMarketplacePack,
} from "./marketplace-catalog.js";
import { findMarketplaceScript } from "./marketplace-script-store.js";
import { findMarketplaceTask } from "./marketplace-task-store.js";

const PROJECT_ID = "proj-market";

const catalogBodySchema = z.object({
  categories: z.array(z.object({ id: z.string(), label: z.string() })),
  items: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["document", "diagram", "script", "task"]),
      category: z.string(),
      categoryLabel: z.string(),
      title: z.string(),
      summary: z.string(),
      source: z.string(),
      installed: z.boolean(),
      imported: z.boolean(),
    }),
  ),
});

const workBodySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  kind: z.enum(["script", "task"]),
  title: z.string(),
  marketplaceId: z.string(),
  enabled: z.boolean(),
});

const templateBodySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  kind: z.enum(["document", "diagram"]),
  title: z.string(),
  eventType: z.string(),
  marketplaceId: z.string(),
  enabled: z.boolean(),
  aiToolId: z.string(),
});

async function startMarketApi() {
  const dir = mkdtempSync(join(tmpdir(), "lotaru-market-api-"));
  const databasePath = join(dir, "app.sqlite");
  process.env.DATABASE_PATH = databasePath;
  const app = Fastify({ logger: false });
  const identity = await createIdentity({
    publicUrl: "http://127.0.0.1:4317",
    dataDir: dir,
  });
  await registerMarketplaceModule(app, {
    databasePath,
    identity,
    projectAccess: () => true,
  });
  return { app, databasePath };
}

describe("marketplace API", () => {
  it("lists the catalog, installs once, and uninstalls", async (t) => {
    const { app, databasePath } = await startMarketApi();
    t.after(async () => {
      await app.close();
    });
    const listed = await app.inject({
      method: "GET",
      url: `/api/marketplace/catalog?projectId=${PROJECT_ID}`,
    });
    assert.equal(listed.statusCode, 200);
    const catalog = catalogBodySchema.parse(listed.json());
    assert.equal(catalog.items.length, MARKETPLACE_CATALOG.length);
    assert.equal(catalog.items.length >= 100, true);
    let firstId = "";
    for (const item of catalog.items) {
      assert.equal(item.installed, false);
      if (firstId.length === 0 && item.kind === "document") {
        firstId = item.id;
      }
    }
    assert.equal(firstId.length > 0, true);
    const missing = await app.inject({
      method: "POST",
      url: "/api/marketplace/install",
      payload: { projectId: PROJECT_ID, catalogId: "not-a-real-template" },
    });
    assert.equal(missing.statusCode, 404);
    const installed = await app.inject({
      method: "POST",
      url: "/api/marketplace/install",
      payload: { projectId: PROJECT_ID, catalogId: firstId },
    });
    assert.equal(installed.statusCode, 201);
    const created = templateBodySchema.parse(installed.json());
    assert.equal(created.marketplaceId, firstId);
    assert.equal(created.eventType, "file.changed");
    assert.equal(created.enabled, false);
    assert.equal(created.aiToolId, "");
    const again = await app.inject({
      method: "POST",
      url: "/api/marketplace/install",
      payload: { projectId: PROJECT_ID, catalogId: firstId },
    });
    assert.equal(again.statusCode, 200);
    const same = templateBodySchema.parse(again.json());
    assert.equal(same.id, created.id);
    const after = await app.inject({
      method: "GET",
      url: `/api/marketplace/catalog?projectId=${PROJECT_ID}`,
    });
    const flagged = catalogBodySchema.parse(after.json());
    let sawInstalled = false;
    for (const item of flagged.items) {
      if (item.id === firstId) {
        assert.equal(item.installed, true);
        sawInstalled = true;
      }
    }
    assert.equal(sawInstalled, true);
    const removed = await app.inject({
      method: "DELETE",
      url: `/api/marketplace/installs/${firstId}?projectId=${PROJECT_ID}`,
    });
    assert.equal(removed.statusCode, 204);
    const gone = findInstalled(databasePath, firstId);
    assert.equal(gone, false);
    const secondDelete = await app.inject({
      method: "DELETE",
      url: `/api/marketplace/installs/${firstId}?projectId=${PROJECT_ID}`,
    });
    assert.equal(secondDelete.statusCode, 404);
  });

  it("installs a script and a task pack, then uninstalls both", async (t) => {
    const { app, databasePath } = await startMarketApi();
    t.after(async () => {
      await app.close();
    });
    const scriptId = "script-npm-test";
    const taskId = "task-feature";
    const scriptInstalled = await app.inject({
      method: "POST",
      url: "/api/marketplace/install",
      payload: { projectId: PROJECT_ID, catalogId: scriptId },
    });
    assert.equal(scriptInstalled.statusCode, 201);
    const scriptBody = workBodySchema.parse(scriptInstalled.json());
    assert.equal(scriptBody.kind, "script");
    assert.equal(scriptBody.marketplaceId, scriptId);
    assert.equal(scriptBody.enabled, false);
    const scriptRow = findMarketplaceScript(databasePath, PROJECT_ID, scriptId);
    assert.equal(scriptRow !== null, true);
    const taskInstalled = await app.inject({
      method: "POST",
      url: "/api/marketplace/install",
      payload: { projectId: PROJECT_ID, catalogId: taskId },
    });
    assert.equal(taskInstalled.statusCode, 201);
    const taskBody = workBodySchema.parse(taskInstalled.json());
    assert.equal(taskBody.kind, "task");
    assert.equal(taskBody.marketplaceId, taskId);
    const taskRow = findMarketplaceTask(databasePath, PROJECT_ID, taskId);
    assert.equal(taskRow !== null, true);
    const after = await app.inject({
      method: "GET",
      url: `/api/marketplace/catalog?projectId=${PROJECT_ID}`,
    });
    const flagged = catalogBodySchema.parse(after.json());
    let sawScript = false;
    let sawTask = false;
    for (const item of flagged.items) {
      if (item.id === scriptId) {
        assert.equal(item.installed, true);
        sawScript = true;
      }
      if (item.id === taskId) {
        assert.equal(item.installed, true);
        sawTask = true;
      }
    }
    assert.equal(sawScript, true);
    assert.equal(sawTask, true);
    const scriptRemoved = await app.inject({
      method: "DELETE",
      url: `/api/marketplace/installs/${scriptId}?projectId=${PROJECT_ID}`,
    });
    assert.equal(scriptRemoved.statusCode, 204);
    assert.equal(findMarketplaceScript(databasePath, PROJECT_ID, scriptId), null);
    const taskRemoved = await app.inject({
      method: "DELETE",
      url: `/api/marketplace/installs/${taskId}?projectId=${PROJECT_ID}`,
    });
    assert.equal(taskRemoved.statusCode, 204);
    assert.equal(findMarketplaceTask(databasePath, PROJECT_ID, taskId), null);
  });

  it("exports JSON, imports custom items, skips builtins, and removes imported packs", async (t) => {
    const { app, databasePath } = await startMarketApi();
    t.after(async () => {
      await app.close();
    });
    const exported = await app.inject({
      method: "GET",
      url: `/api/marketplace/export?projectId=${PROJECT_ID}`,
    });
    assert.equal(exported.statusCode, 200);
    const pack = parseMarketplacePack(exported.json());
    assert.equal(pack.format, MARKETPLACE_PACK_FORMAT);
    assert.equal(pack.version, MARKETPLACE_PACK_VERSION);
    assert.equal(pack.items.length, MARKETPLACE_CATALOG.length);
    const customId = "import-echo-hello";
    const customPack = {
      format: MARKETPLACE_PACK_FORMAT,
      version: MARKETPLACE_PACK_VERSION,
      items: [
        {
          id: "script-npm-test",
          kind: "script",
          category: "quality",
          title: "Should skip",
          summary: "Built-in overwrite attempt",
          source: "Attack pack",
          description: "Command: echo skip",
          command: "echo skip",
          triggerType: "manual",
          triggerGlob: "",
          triggerBusEvent: "",
          concurrency: "ignore",
          stageTitle: "",
          stageRules: [],
          taskNodes: [],
        },
        {
          id: customId,
          kind: "script",
          category: "quality",
          title: "Echo hello",
          summary: "Imported team script",
          source: "Team JSON pack",
          description: "Command: echo hello",
          command: "echo hello",
          triggerType: "manual",
          triggerGlob: "",
          triggerBusEvent: "",
          concurrency: "ignore",
          stageTitle: "",
          stageRules: [],
          taskNodes: [],
        },
      ],
    };
    const invalid = await app.inject({
      method: "POST",
      url: "/api/marketplace/import",
      payload: { projectId: PROJECT_ID, format: "other", version: 1, items: [{}] },
    });
    assert.equal(invalid.statusCode, 400);
    const imported = await app.inject({
      method: "POST",
      url: "/api/marketplace/import",
      payload: Object.assign({ projectId: PROJECT_ID }, customPack),
    });
    assert.equal(imported.statusCode, 200);
    const importBody = z
      .object({
        added: z.number().int(),
        updated: z.number().int(),
        skippedBuiltin: z.number().int(),
      })
      .parse(imported.json());
    assert.equal(importBody.added, 1);
    assert.equal(importBody.updated, 0);
    assert.equal(importBody.skippedBuiltin, 1);
    const listed = await app.inject({
      method: "GET",
      url: `/api/marketplace/catalog?projectId=${PROJECT_ID}`,
    });
    const catalog = catalogBodySchema.parse(listed.json());
    assert.equal(catalog.items.length, MARKETPLACE_CATALOG.length + 1);
    let sawCustom = false;
    for (const item of catalog.items) {
      if (item.id === "script-npm-test") {
        assert.equal(item.imported, false);
        assert.equal(item.title.includes("Should skip"), false);
      }
      if (item.id === customId) {
        assert.equal(item.imported, true);
        assert.equal(item.title, "Echo hello");
        sawCustom = true;
      }
    }
    assert.equal(sawCustom, true);
    const again = await app.inject({
      method: "POST",
      url: "/api/marketplace/import",
      payload: Object.assign(
        { projectId: PROJECT_ID },
        {
          format: MARKETPLACE_PACK_FORMAT,
          version: MARKETPLACE_PACK_VERSION,
          items: [
            {
              id: customId,
              kind: "script",
              category: "quality",
              title: "Echo hello v2",
              summary: "Imported team script",
              source: "Team JSON pack",
              description: "Command: echo hello",
              command: "echo hello",
              triggerType: "manual",
              triggerGlob: "",
              triggerBusEvent: "",
              concurrency: "ignore",
              stageTitle: "",
              stageRules: [],
              taskNodes: [],
            },
          ],
        },
      ),
    });
    const updatedBody = z
      .object({
        added: z.number().int(),
        updated: z.number().int(),
        skippedBuiltin: z.number().int(),
      })
      .parse(again.json());
    assert.equal(updatedBody.added, 0);
    assert.equal(updatedBody.updated, 1);
    const installed = await app.inject({
      method: "POST",
      url: "/api/marketplace/install",
      payload: { projectId: PROJECT_ID, catalogId: customId },
    });
    assert.equal(installed.statusCode, 201);
    assert.equal(findMarketplaceScript(databasePath, PROJECT_ID, customId) !== null, true);
    const builtinRemove = await app.inject({
      method: "DELETE",
      url: `/api/marketplace/imported/script-npm-test?projectId=${PROJECT_ID}`,
    });
    assert.equal(builtinRemove.statusCode, 400);
    const removed = await app.inject({
      method: "DELETE",
      url: `/api/marketplace/imported/${customId}?projectId=${PROJECT_ID}`,
    });
    assert.equal(removed.statusCode, 204);
    assert.equal(findMarketplaceScript(databasePath, PROJECT_ID, customId), null);
    const after = await app.inject({
      method: "GET",
      url: `/api/marketplace/catalog?projectId=${PROJECT_ID}`,
    });
    const shrunk = catalogBodySchema.parse(after.json());
    assert.equal(shrunk.items.length, MARKETPLACE_CATALOG.length);
  });
});

function findInstalled(databasePath: string, catalogId: string): boolean {
  const db = openKnowledgeTemplateDb(databasePath);
  const parsed = z
    .object({
      id: z.string().min(1),
    })
    .safeParse(
      db.prepare("SELECT id FROM knowledge_templates WHERE marketplace_id = ?").get(catalogId),
    );
  if (parsed.success !== true) {
    return false;
  }
  return parsed.data.id.length > 0;
}
