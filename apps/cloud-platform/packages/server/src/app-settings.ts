import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { edgeVoiceForLanguage } from "./note-language.js";
import { canonicalQwenSpeaker, looksLikeEdgeVoice, qwenDefaultForLanguage } from "./tts-voices.js";

export type TtsEngine = "edge" | "qwen";

export type AppSettings = {
  ollamaHost: string;
  ollamaModel: string;
  translationEnabled: boolean;
  targetLanguage: string;
  ttsEngine: TtsEngine;
  qwenTtsUrl: string;
  ttsVoice: string;
};

const SETTINGS_ID = "lotaru";

const settingsInputSchema = z.object({
  ollamaHost: z.string().trim().min(1),
  ollamaModel: z.string().trim(),
  translationEnabled: z.boolean(),
  targetLanguage: z.string().trim().min(1),
  ttsEngine: z.enum(["edge", "qwen"]),
  qwenTtsUrl: z.string().trim(),
  ttsVoice: z.string().trim(),
});

export const DEFAULT_APP_SETTINGS: AppSettings = {
  ollamaHost: "http://127.0.0.1:11434",
  ollamaModel: "",
  translationEnabled: false,
  targetLanguage: "tr",
  ttsEngine: "edge",
  qwenTtsUrl: "",
  ttsVoice: "",
};

type SettingsRow = {
  id: string;
  ollama_host: string;
  ollama_model: string;
  translation_enabled: number;
  target_language: string;
  tts_engine: string;
  qwen_tts_url: string;
  tts_voice: string;
};

function rowToSettings(row: SettingsRow): AppSettings {
  let ttsEngine: TtsEngine = "edge";
  if (row.tts_engine === "qwen") {
    ttsEngine = "qwen";
  }
  return {
    ollamaHost: row.ollama_host,
    ollamaModel: row.ollama_model,
    translationEnabled: row.translation_enabled === 1,
    targetLanguage: row.target_language,
    ttsEngine,
    qwenTtsUrl: row.qwen_tts_url,
    ttsVoice: row.tts_voice,
  };
}

function coerceTtsVoice(settings: AppSettings): AppSettings {
  if (settings.ttsEngine === "qwen") {
    const canonical = canonicalQwenSpeaker(settings.ttsVoice);
    if (canonical.length > 0) {
      return Object.assign({}, settings, { ttsVoice: canonical });
    }
    return Object.assign({}, settings, {
      ttsVoice: qwenDefaultForLanguage(settings.targetLanguage),
    });
  }
  if (looksLikeEdgeVoice(settings.ttsVoice)) {
    return settings;
  }
  return Object.assign({}, settings, {
    ttsVoice: edgeVoiceForLanguage(settings.targetLanguage),
  });
}

export function parseSettingsInput(body: unknown): AppSettings {
  const parsed = settingsInputSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("Invalid settings");
  }
  return coerceTtsVoice(parsed.data);
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
      DEFAULT_APP_SETTINGS.ollamaHost,
      DEFAULT_APP_SETTINGS.ollamaModel,
      0,
      DEFAULT_APP_SETTINGS.targetLanguage,
      DEFAULT_APP_SETTINGS.ttsEngine,
      DEFAULT_APP_SETTINGS.qwenTtsUrl,
      DEFAULT_APP_SETTINGS.ttsVoice,
    );
  }
  return db;
}

export function loadAppSettings(db: Database.Database): AppSettings {
  const row = db.prepare("SELECT * FROM app_settings WHERE id = ?").get(SETTINGS_ID) as
    | SettingsRow
    | undefined;
  if (row === undefined) {
    return coerceTtsVoice(DEFAULT_APP_SETTINGS);
  }
  return coerceTtsVoice(rowToSettings(row));
}

export function saveAppSettings(db: Database.Database, settings: AppSettings): AppSettings {
  const next = coerceTtsVoice(settings);
  db.prepare(
    "UPDATE app_settings SET ollama_host = ?, ollama_model = ?, translation_enabled = ?, target_language = ?, tts_engine = ?, qwen_tts_url = ?, tts_voice = ? WHERE id = ?",
  ).run(
    next.ollamaHost,
    next.ollamaModel,
    next.translationEnabled ? 1 : 0,
    next.targetLanguage,
    next.ttsEngine,
    next.qwenTtsUrl,
    next.ttsVoice,
    SETTINGS_ID,
  );
  return loadAppSettings(db);
}
