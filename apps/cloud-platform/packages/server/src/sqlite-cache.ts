import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const connections = new Map<string, Database.Database>();

export function cachedSqlite(
  owner: string,
  databasePath: string,
  migrate: (db: Database.Database) => void,
): Database.Database {
  const key = `${owner}${databasePath}`;
  const existing = connections.get(key);
  if (existing !== undefined && existing.open) {
    return existing;
  }
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  migrate(db);
  connections.set(key, db);
  return db;
}

export function closeCachedSqlite(): void {
  for (const db of connections.values()) {
    if (db.open) {
      db.close();
    }
  }
  connections.clear();
}