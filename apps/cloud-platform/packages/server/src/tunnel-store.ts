import type Database from "better-sqlite3";
import { z } from "zod";
import { openSettingsDb } from "./app-settings.js";

export const TUNNEL_ROW_ID = "lotaru";

export type TunnelProvider = "cloudflare" | "ngrok";

export type TunnelSettings = {
  enabled: boolean;
  provider: TunnelProvider;
  ngrokToken: string;
};

const rowSchema = z.object({
  enabled: z.number().int(),
  provider: z.enum(["cloudflare", "ngrok"]),
  ngrok_token: z.string(),
});

const DISABLED_DEFAULT: TunnelSettings = {
  enabled: false,
  provider: "cloudflare",
  ngrokToken: "",
};

export function ensureTunnelSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lotaru_tunnel (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL,
      provider TEXT NOT NULL,
      ngrok_token TEXT NOT NULL
    );
  `);
  db.prepare(
    "INSERT OR IGNORE INTO lotaru_tunnel (id, enabled, provider, ngrok_token) VALUES (?, ?, ?, ?)",
  ).run(TUNNEL_ROW_ID, 1, "cloudflare", "");
}

export function loadTunnelSettings(db: Database.Database): TunnelSettings {
  ensureTunnelSchema(db);
  const parsed = rowSchema.safeParse(
    db
      .prepare("SELECT enabled, provider, ngrok_token FROM lotaru_tunnel WHERE id = ?")
      .get(TUNNEL_ROW_ID),
  );
  if (parsed.success !== true) {
    return DISABLED_DEFAULT;
  }
  return {
    enabled: parsed.data.enabled === 1,
    provider: parsed.data.provider,
    ngrokToken: parsed.data.ngrok_token,
  };
}

export function saveTunnelSettings(db: Database.Database, settings: TunnelSettings): TunnelSettings {
  ensureTunnelSchema(db);
  db.prepare(
    "INSERT INTO lotaru_tunnel (id, enabled, provider, ngrok_token) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, provider = excluded.provider, ngrok_token = excluded.ngrok_token",
  ).run(TUNNEL_ROW_ID, settings.enabled ? 1 : 0, settings.provider, settings.ngrokToken);
  return loadTunnelSettings(db);
}

export function tunnelDatabase(databasePath: string): Database.Database {
  const db = openSettingsDb(databasePath);
  ensureTunnelSchema(db);
  return db;
}
