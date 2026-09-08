import type Database from "better-sqlite3";
import { z } from "zod";
import { loadAppSettings, saveAppSettings } from "./app-settings.js";
import { assertHttpsAiBase, assertLocalAiBase } from "./ai-base.js";
import {
  listAiTools,
  requireAiTool,
  type AiTool,
  type AiToolId,
} from "./ai-catalog.js";

const connectionRowSchema = z.object({
  id: z.string(),
  secret: z.string(),
  base_url: z.string(),
  model: z.string(),
});

export type AiToolConnection = {
  id: AiToolId;
  label: string;
  lane: AiTool["lane"];
  protocol: AiTool["protocol"];
  connected: boolean;
  baseUrl: string;
  model: string;
  defaultBase: string;
  defaultModel: string;
};

export type AiToolSaveInput = {
  secret: string;
  baseUrl: string;
  model: string;
  disconnect: boolean;
};

export function ensureAiToolSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lotaru_ai_tools (
      id TEXT PRIMARY KEY,
      secret TEXT NOT NULL,
      base_url TEXT NOT NULL,
      model TEXT NOT NULL
    );
  `);
}

function loadRow(db: Database.Database, id: AiToolId): z.infer<typeof connectionRowSchema> | null {
  const parsed = connectionRowSchema.safeParse(
    db.prepare("SELECT id, secret, base_url, model FROM lotaru_ai_tools WHERE id = ?").get(id),
  );
  if (parsed.success !== true) {
    return null;
  }
  return parsed.data;
}

function writeOllamaSettings(db: Database.Database, baseUrl: string, model: string): void {
  const settings = loadAppSettings(db);
  saveAppSettings(db, {
    ollamaHost: baseUrl,
    ollamaModel: model,
    translationEnabled: settings.translationEnabled,
    targetLanguage: settings.targetLanguage,
    ttsEngine: settings.ttsEngine,
    qwenTtsUrl: settings.qwenTtsUrl,
    ttsVoice: settings.ttsVoice,
  });
}

function connectedFrom(tool: AiTool, secret: string, baseUrl: string, model: string): boolean {
  if (tool.lane === "cli") {
    return secret.length > 0;
  }
  if (tool.lane === "cloud") {
    return secret.length > 0 && model.length > 0;
  }
  if (baseUrl.length === 0) {
    return false;
  }
  return model.length > 0;
}

export function loadAiToolSecret(db: Database.Database, id: AiToolId): string {
  const row = loadRow(db, id);
  if (row === null) {
    return "";
  }
  return row.secret;
}

export function loadAiToolConnection(db: Database.Database, id: AiToolId): AiToolConnection {
  const tool = requireAiTool(id);
  const row = loadRow(db, id);
  let secret = "";
  let baseUrl = tool.defaultBase;
  let model = tool.defaultModel;
  if (row !== null) {
    secret = row.secret;
    if (row.base_url.length > 0) {
      baseUrl = row.base_url;
    }
    if (row.model.length > 0) {
      model = row.model;
    }
  }
  if (tool.id === "ollama") {
    const settings = loadAppSettings(db);
    if (row === null || row.base_url.length === 0) {
      if (settings.ollamaHost.trim().length > 0) {
        baseUrl = settings.ollamaHost.trim();
      }
    }
    if (row === null || row.model.length === 0) {
      if (settings.ollamaModel.trim().length > 0) {
        model = settings.ollamaModel.trim();
      }
    }
  }
  return {
    id: tool.id,
    label: tool.label,
    lane: tool.lane,
    protocol: tool.protocol,
    connected: connectedFrom(tool, secret, baseUrl, model),
    baseUrl,
    model,
    defaultBase: tool.defaultBase,
    defaultModel: tool.defaultModel,
  };
}

export function connectionWithCliHealth(
  connection: AiToolConnection,
  reachable: boolean,
): AiToolConnection {
  if (connection.lane !== "cli") {
    return connection;
  }
  let connected = false;
  if (connection.connected === true && reachable === true) {
    connected = true;
  }
  return {
    id: connection.id,
    label: connection.label,
    lane: connection.lane,
    protocol: connection.protocol,
    connected,
    baseUrl: connection.baseUrl,
    model: connection.model,
    defaultBase: connection.defaultBase,
    defaultModel: connection.defaultModel,
  };
}

export function listAiToolConnections(db: Database.Database): AiToolConnection[] {
  const rows: AiToolConnection[] = [];
  for (const tool of listAiTools()) {
    rows.push(loadAiToolConnection(db, tool.id));
  }
  return rows;
}

export function saveAiToolConnection(
  db: Database.Database,
  id: AiToolId,
  input: AiToolSaveInput,
): AiToolConnection {
  const tool = requireAiTool(id);
  let secret = input.secret.trim();
  let model = input.model.trim();
  if (input.disconnect === true) {
    secret = "";
    model = "";
  } else if (secret.length === 0) {
    const existing = loadRow(db, id);
    if (existing !== null) {
      secret = existing.secret;
    }
  }
  let baseUrl = input.baseUrl.trim();
  if (tool.lane === "local") {
    if (baseUrl.length === 0) {
      baseUrl = tool.defaultBase;
    }
    baseUrl = assertLocalAiBase(baseUrl);
  }
  if (tool.lane === "cloud") {
    baseUrl = assertHttpsAiBase(tool.defaultBase);
  }
  if (tool.lane === "cli") {
    baseUrl = "";
  }
  db.prepare(
    "INSERT INTO lotaru_ai_tools (id, secret, base_url, model) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET secret = excluded.secret, base_url = excluded.base_url, model = excluded.model",
  ).run(id, secret, baseUrl, model);
  if (tool.id === "ollama") {
    writeOllamaSettings(db, baseUrl, model);
  }
  return loadAiToolConnection(db, id);
}

export function connectedAiToolIds(db: Database.Database): AiToolId[] {
  const ids: AiToolId[] = [];
  for (const row of listAiToolConnections(db)) {
    if (row.connected) {
      ids.push(row.id);
    }
  }
  return ids;
}
