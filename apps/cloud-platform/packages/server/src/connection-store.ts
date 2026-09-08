import type Database from "better-sqlite3";
import { z } from "zod";
import { openSettingsDb } from "./app-settings.js";
import {
  connectorById,
  listConnectors,
  type ConnectorKind,
} from "./connector-catalog.js";
import { ensureGithubSchema, loadGithubToken } from "./github-store.js";

const secretRowSchema = z.object({ secret: z.string() });

export function ensureConnectionSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lotaru_connections (
      id TEXT PRIMARY KEY,
      secret TEXT NOT NULL
    );
  `);
}

export function loadConnectionSecret(db: Database.Database, id: ConnectorKind): string {
  if (id === "github") {
    return loadGithubToken(db);
  }
  const parsed = secretRowSchema.safeParse(
    db.prepare("SELECT secret FROM lotaru_connections WHERE id = ?").get(id),
  );
  if (parsed.success !== true) {
    return "";
  }
  return parsed.data.secret;
}

export function saveConnectionSecret(db: Database.Database, id: ConnectorKind, secret: string): void {
  if (id === "github") {
    throw new Error("github connection uses the GitHub token store");
  }
  const hits = connectorById(id);
  if (hits.length === 0) {
    throw new Error(`unknown connector ${id}`);
  }
  db.prepare(
    "INSERT INTO lotaru_connections (id, secret) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET secret = excluded.secret",
  ).run(id, secret.trim());
}

export function connectedConnectorIds(db: Database.Database): ConnectorKind[] {
  const ids: ConnectorKind[] = [];
  for (const connector of listConnectors()) {
    if (loadConnectionSecret(db, connector.id).length > 0) {
      ids.push(connector.id);
    }
  }
  return ids;
}

export function connectionsDatabase(databasePath: string): Database.Database {
  const db = openSettingsDb(databasePath);
  ensureGithubSchema(db);
  ensureConnectionSchema(db);
  return db;
}

export function connectedKindsAt(databasePath: string): ConnectorKind[] {
  return connectedConnectorIds(connectionsDatabase(databasePath));
}
