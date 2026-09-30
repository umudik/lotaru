import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

export type AppSettings = {
  ollamaHost: string;
  ollamaModel: string;
  translationEnabled: boolean;
  targetLanguage: string;
};

const SETTINGS_ID = "lotaru";

function defaultOllamaHost(): string {
  const fromEnv = process.env.LOTARU_OLLAMA_HOST;
  if (fromEnv !== undefined) {
    const trimmed = fromEnv.trim().replace(/\/$/, "");
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return "http://127.0.0.1:11434";
}

function isLoopbackOllamaHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (normalized.includes("127.0.0.1")) {
    return true;
  }
  if (normalized.includes("localhost")) {
    return true;
  }
  return false;
}

const settingsInputSchema = z.object({
  ollamaHost: z.string().trim().min(1),
  ollamaModel: z.string().trim(),
  translationEnabled: z.boolean(),
  targetLanguage: z.string().trim().min(1),
});

export const DEFAULT_APP_SETTINGS: AppSettings = {
  ollamaHost: defaultOllamaHost(),
  ollamaModel: "",
  translationEnabled: false,
  targetLanguage: "tr",
};

type SettingsRow = {
  id: string;
  ollama_host: string;
  ollama_model: string;
  translation_enabled: number;
  target_language: string;
};

function rowToSettings(row: SettingsRow): AppSettings {
  return {
    ollamaHost: row.ollama_host,
    ollamaModel: row.ollama_model,
    translationEnabled: row.translation_enabled === 1,
    targetLanguage: row.target_language,
  };
}

export function parseSettingsInput(body: unknown): AppSettings {
  const parsed = settingsInputSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("Invalid settings");
  }
  return parsed.data;
}

export function openSettingsDb(databasePath: string): Database.Database {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id TEXT PRIMARY KEY,
      ollama_host TEXT NOT NULL,
      ollama_model TEXT NOT NULL,
      translation_enabled INTEGER NOT NULL,
      target_language TEXT NOT NULL,
      tts_engine TEXT NOT NULL,
      qwen_tts_url TEXT NOT NULL,
      tts_voice TEXT NOT NULL
    );
  `);
  const existing = db.prepare("SELECT id FROM app_settings WHERE id = ?").get(SETTINGS_ID) as
    | { id: string }
    | undefined;
  if (existing === undefined) {
    db.prepare(
      "INSERT INTO app_settings (id, ollama_host, ollama_model, translation_enabled, target_language, tts_engine, qwen_tts_url, tts_voice) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      SETTINGS_ID,
      defaultOllamaHost(),
      DEFAULT_APP_SETTINGS.ollamaModel,
      0,
      DEFAULT_APP_SETTINGS.targetLanguage,
      "edge",
      "",
      "",
    );
  } else {
    const envHost = defaultOllamaHost();
    if (envHost !== "http://127.0.0.1:11434") {
      const row = db.prepare("SELECT ollama_host FROM app_settings WHERE id = ?").get(SETTINGS_ID) as
        | { ollama_host: string }
        | undefined;
      if (row !== undefined && isLoopbackOllamaHost(row.ollama_host)) {
        db.prepare("UPDATE app_settings SET ollama_host = ? WHERE id = ?").run(envHost, SETTINGS_ID);
      }
    }
  }
  return db;
}

export function loadAppSettings(db: Database.Database): AppSettings {
  const row = db.prepare(
    "SELECT id, ollama_host, ollama_model, translation_enabled, target_language FROM app_settings WHERE id = ?",
  ).get(SETTINGS_ID) as SettingsRow | undefined;
  if (row === undefined) {
    return DEFAULT_APP_SETTINGS;
  }
  return rowToSettings(row);
}

export function saveAppSettings(db: Database.Database, settings: AppSettings): AppSettings {
  db.prepare(
    "UPDATE app_settings SET ollama_host = ?, ollama_model = ?, translation_enabled = ?, target_language = ? WHERE id = ?",
  ).run(
    settings.ollamaHost,
    settings.ollamaModel,
    settings.translationEnabled ? 1 : 0,
    settings.targetLanguage,
    SETTINGS_ID,
  );
  return loadAppSettings(db);
}
