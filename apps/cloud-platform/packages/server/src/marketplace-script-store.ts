import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { z } from "zod";
import { cachedSqlite } from "./sqlite-cache.js";
import type { MarketplaceCatalogItem } from "./marketplace-catalog.js";

const scriptRowSchema = z.object({
  id: z.string().min(1),
  marketplace_id: z.string().min(1),
});

const idRowSchema = z.object({
  marketplace_id: z.string().min(1),
});

function scriptTableHasColumn(db: Database.Database, column: string): boolean {
  const raw = db.prepare("PRAGMA table_info(script_scripts)").all();
  if (Array.isArray(raw) !== true) {
    return false;
  }
  const nameSchema = z.object({ name: z.string() });
  for (const entry of raw) {
    const parsed = nameSchema.safeParse(entry);
    if (parsed.success !== true) {
      continue;
    }
    if (parsed.data.name === column) {
      return true;
    }
  }
  return false;
}

export function openMarketplaceScriptDb(databasePath: string) {
  return cachedSqlite("marketplace-scripts", databasePath, (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS script_scripts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        command TEXT NOT NULL,
        runtime TEXT NOT NULL,
        docker_image TEXT NOT NULL DEFAULT '',
        docker_platform TEXT NOT NULL DEFAULT '',
        trigger_type TEXT NOT NULL,
        trigger_glob TEXT NOT NULL DEFAULT '',
        trigger_bus_event TEXT NOT NULL DEFAULT '',
        trigger_cron TEXT NOT NULL DEFAULT '',
        concurrency TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        marketplace_id TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );
    `);
    if (scriptTableHasColumn(db, "marketplace_id") !== true) {
      db.exec("ALTER TABLE script_scripts ADD COLUMN marketplace_id TEXT NOT NULL DEFAULT ''");
    }
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_script_scripts_market ON script_scripts(project_id, marketplace_id) WHERE marketplace_id != ''",
    );
  });
}

export function listMarketplaceScriptIds(databasePath: string, projectId: string): string[] {
  const db = openMarketplaceScriptDb(databasePath);
  const raw = db
    .prepare(
      "SELECT marketplace_id FROM script_scripts WHERE project_id = ? AND marketplace_id != ''",
    )
    .all(projectId);
  const ids: string[] = [];
  if (Array.isArray(raw) !== true) {
    return ids;
  }
  for (const entry of raw) {
    const parsed = idRowSchema.safeParse(entry);
    if (parsed.success !== true) {
      continue;
    }
    ids.push(parsed.data.marketplace_id);
  }
  return ids;
}

export function findMarketplaceScript(
  databasePath: string,
  projectId: string,
  marketplaceId: string,
): { id: string; marketplaceId: string } | null {
  const trimmed = marketplaceId.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const db = openMarketplaceScriptDb(databasePath);
  const parsed = scriptRowSchema.safeParse(
    db
      .prepare("SELECT id, marketplace_id FROM script_scripts WHERE project_id = ? AND marketplace_id = ?")
      .get(projectId, trimmed),
  );
  if (parsed.success !== true) {
    return null;
  }
  return { id: parsed.data.id, marketplaceId: parsed.data.marketplace_id };
}

export function insertMarketplaceScript(input: {
  databasePath: string;
  projectId: string;
  ownerId: string;
  item: MarketplaceCatalogItem;
}): { id: string; marketplaceId: string } {
  const existing = findMarketplaceScript(input.databasePath, input.projectId, input.item.id);
  if (existing !== null) {
    return existing;
  }
  if (input.item.command.trim().length === 0) {
    throw new Error("script command required");
  }
  const db = openMarketplaceScriptDb(input.databasePath);
  const id = randomUUID();
  db.prepare(
    "INSERT INTO script_scripts (id, project_id, owner_id, name, command, runtime, docker_image, docker_platform, trigger_type, trigger_glob, trigger_bus_event, trigger_cron, concurrency, enabled, marketplace_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    input.projectId,
    input.ownerId,
    input.item.title.slice(0, 200),
    input.item.command,
    "shell",
    "",
    "",
    "manual",
    "",
    "",
    "",
    "ignore",
    0,
    input.item.id,
    Date.now(),
  );
  const created = findMarketplaceScript(input.databasePath, input.projectId, input.item.id);
  if (created === null) {
    throw new Error("script missing");
  }
  return created;
}

export function deleteMarketplaceScript(
  databasePath: string,
  projectId: string,
  marketplaceId: string,
): { id: string; marketplaceId: string } | null {
  const existing = findMarketplaceScript(databasePath, projectId, marketplaceId);
  if (existing === null) {
    return null;
  }
  const db = openMarketplaceScriptDb(databasePath);
  db.prepare("DELETE FROM script_scripts WHERE id = ?").run(existing.id);
  const gone = findMarketplaceScript(databasePath, projectId, marketplaceId);
  if (gone !== null) {
    throw new Error("uninstall failed");
  }
  return existing;
}
