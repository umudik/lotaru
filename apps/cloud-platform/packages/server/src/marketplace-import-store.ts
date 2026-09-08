import Database from "better-sqlite3";
import { z } from "zod";
import { cachedSqlite } from "./sqlite-cache.js";
import {
  MARKETPLACE_PACK_FORMAT,
  MARKETPLACE_PACK_VERSION,
  parseMarketplacePack,
  type MarketplaceCatalogItem,
} from "./marketplace-catalog.js";

const importedRowSchema = z.object({
  catalog_id: z.string().min(1),
  item_json: z.string().min(1),
});

function openImportDb(databasePath: string): Database.Database {
  return cachedSqlite("marketplace-imports", databasePath, (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS marketplace_imported (
        project_id TEXT NOT NULL,
        catalog_id TEXT NOT NULL,
        item_json TEXT NOT NULL,
        PRIMARY KEY (project_id, catalog_id)
      );
    `);
  });
}

function itemFromJson(text: string): MarketplaceCatalogItem | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const pack = parseMarketplacePack({
    format: MARKETPLACE_PACK_FORMAT,
    version: MARKETPLACE_PACK_VERSION,
    items: [raw],
  });
  for (const item of pack.items) {
    return item;
  }
  return null;
}

export function listImportedMarketplaceItems(
  databasePath: string,
  projectId: string,
): MarketplaceCatalogItem[] {
  const db = openImportDb(databasePath);
  const raw = db
    .prepare("SELECT catalog_id, item_json FROM marketplace_imported WHERE project_id = ? ORDER BY catalog_id")
    .all(projectId);
  const items: MarketplaceCatalogItem[] = [];
  if (Array.isArray(raw) !== true) {
    return items;
  }
  for (const entry of raw) {
    const parsed = importedRowSchema.safeParse(entry);
    if (parsed.success !== true) {
      continue;
    }
    const item = itemFromJson(parsed.data.item_json);
    if (item === null) {
      continue;
    }
    if (item.id !== parsed.data.catalog_id) {
      continue;
    }
    items.push(item);
  }
  return items;
}

export function upsertImportedMarketplaceItem(input: {
  databasePath: string;
  projectId: string;
  item: MarketplaceCatalogItem;
}): "added" | "updated" {
  const existing = listImportedMarketplaceItems(input.databasePath, input.projectId);
  let already = false;
  for (const listed of existing) {
    if (listed.id === input.item.id) {
      already = true;
    }
  }
  const wrapped = parseMarketplacePack({
    format: MARKETPLACE_PACK_FORMAT,
    version: MARKETPLACE_PACK_VERSION,
    items: [input.item],
  });
  let encoded = "";
  for (const packed of wrapped.items) {
    encoded = JSON.stringify(packed);
    break;
  }
  if (encoded.length === 0) {
    throw new Error("imported item missing");
  }
  const db = openImportDb(input.databasePath);
  db.prepare(
    "INSERT INTO marketplace_imported (project_id, catalog_id, item_json) VALUES (?, ?, ?) ON CONFLICT(project_id, catalog_id) DO UPDATE SET item_json = excluded.item_json",
  ).run(input.projectId, input.item.id, encoded);
  if (already === true) {
    return "updated";
  }
  return "added";
}

export function deleteImportedMarketplaceItem(
  databasePath: string,
  projectId: string,
  catalogId: string,
): { catalogId: string } | null {
  const trimmed = catalogId.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const existing = listImportedMarketplaceItems(databasePath, projectId);
  let found = false;
  for (const listed of existing) {
    if (listed.id === trimmed) {
      found = true;
    }
  }
  if (found !== true) {
    return null;
  }
  const db = openImportDb(databasePath);
  db.prepare("DELETE FROM marketplace_imported WHERE project_id = ? AND catalog_id = ?").run(
    projectId,
    trimmed,
  );
  return { catalogId: trimmed };
}
