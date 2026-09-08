import { listOllamaModels } from "./ollama.js";
import { listOpenAiModels } from "./openai-compat.js";
import { listAnthropicModels } from "./anthropic-api.js";
import { locateCliBinary } from "./agent-probe.js";
import { defaultAgentCommand } from "./agent-runtime.js";
import { aiToolIdSchema, requireAiTool, type AiToolId } from "./ai-catalog.js";
import {
  connectionWithCliHealth,
  ensureAiToolSchema,
  listAiToolConnections,
  loadAiToolConnection,
  loadAiToolSecret,
  saveAiToolConnection,
  type AiToolConnection,
} from "./ai-store.js";
import type Database from "better-sqlite3";
import { z } from "zod";

const cliKindSchema = z.enum(["cursor", "claude", "codex"]);

export type AiToolHealth = {
  id: AiToolId;
  reachable: boolean;
  models: string[];
  detail: string;
  error: string;
};

function healthState(
  id: AiToolId,
  reachable: boolean,
  models: readonly string[],
  detail: string,
  error: string,
): AiToolHealth {
  const copy: string[] = [];
  for (const name of models) {
    copy.push(name);
  }
  return {
    id,
    reachable,
    models: copy,
    detail,
    error,
  };
}

function healthOk(id: AiToolId, models: readonly string[], detail: string): AiToolHealth {
  return healthState(id, true, models, detail, "");
}

function healthFail(
  id: AiToolId,
  error: string,
  detail: string,
  models: readonly string[] = [],
): AiToolHealth {
  return healthState(id, false, models, detail, error);
}

export async function probeCliTool(id: AiToolId): Promise<AiToolHealth> {
  const parsed = cliKindSchema.safeParse(id);
  if (parsed.success !== true) {
    return healthFail(id, "Not a CLI tool", "");
  }
  const command = defaultAgentCommand(parsed.data);
  const paths = await locateCliBinary(command);
  for (const listed of paths) {
    return healthOk(id, [], listed);
  }
  return healthFail(id, `CLI binary "${command}" not found on PATH`, "");
}

async function probeOllama(connection: AiToolConnection): Promise<AiToolHealth> {
  try {
    const models = await listOllamaModels(connection.baseUrl);
    const chosen = connection.model.trim();
    if (chosen.length === 0) {
      return healthFail(connection.id, "Choose a model", connection.baseUrl, models);
    }
    let found = false;
    for (const name of models) {
      if (name === chosen) {
        found = true;
      }
    }
    if (found !== true) {
      return healthFail(
        connection.id,
        `Model "${chosen}" is not installed`,
        connection.baseUrl,
        models,
      );
    }
    return healthOk(connection.id, models, `${connection.baseUrl} · ${chosen}`);
  } catch (err) {
    let message = "Ollama is not reachable";
    if (err instanceof Error && err.message.length > 0) {
      message = err.message;
    }
    return healthFail(connection.id, message, connection.baseUrl);
  }
}

async function probeOpenAi(connection: AiToolConnection, secret: string): Promise<AiToolHealth> {
  try {
    const models = await listOpenAiModels(connection.baseUrl, secret);
    const chosen = connection.model.trim();
    if (chosen.length === 0) {
      return healthFail(connection.id, "Choose a model", connection.baseUrl, models);
    }
    return healthOk(connection.id, models, `${connection.baseUrl} · ${chosen}`);
  } catch (err) {
    let message = "AI endpoint is not reachable";
    if (err instanceof Error && err.message.length > 0) {
      message = err.message;
    }
    return healthFail(connection.id, message, connection.baseUrl);
  }
}

async function probeAnthropic(connection: AiToolConnection, secret: string): Promise<AiToolHealth> {
  try {
    const models = await listAnthropicModels(connection.baseUrl, secret);
    const chosen = connection.model.trim();
    if (chosen.length === 0) {
      return healthFail(connection.id, "Choose a model", connection.baseUrl, models);
    }
    return healthOk(connection.id, models, `${connection.baseUrl} · ${chosen}`);
  } catch (err) {
    let message = "Anthropic is not reachable";
    if (err instanceof Error && err.message.length > 0) {
      message = err.message;
    }
    return healthFail(connection.id, message, connection.baseUrl);
  }
}

export async function probeAiTool(db: Database.Database, id: AiToolId): Promise<AiToolHealth> {
  const tool = requireAiTool(id);
  const connection = loadAiToolConnection(db, id);
  if (tool.protocol === "cli") {
    return probeCliTool(id);
  }
  if (tool.protocol === "ollama") {
    return probeOllama(connection);
  }
  const secret = loadAiToolSecret(db, id);
  if (tool.lane === "cloud" && secret.length === 0) {
    return healthFail(id, "Paste an API key in Settings", connection.baseUrl);
  }
  if (tool.protocol === "anthropic") {
    return probeAnthropic(connection, secret);
  }
  return probeOpenAi(connection, secret);
}

export async function presentAiToolConnections(
  db: Database.Database,
): Promise<AiToolConnection[]> {
  const rows = listAiToolConnections(db);
  const presented: AiToolConnection[] = [];
  for (const row of rows) {
    if (row.lane !== "cli") {
      presented.push(row);
      continue;
    }
    const health = await probeCliTool(row.id);
    presented.push(connectionWithCliHealth(row, health.reachable));
  }
  return presented;
}

export function disconnectCliIfUnreachable(
  db: Database.Database,
  id: AiToolId,
  reachable: boolean,
): AiToolConnection {
  const current = loadAiToolConnection(db, id);
  if (current.lane !== "cli") {
    return current;
  }
  if (reachable === true) {
    return connectionWithCliHealth(current, true);
  }
  if (current.connected === true) {
    saveAiToolConnection(db, id, {
      secret: "",
      baseUrl: "",
      model: "",
      disconnect: true,
    });
  }
  return connectionWithCliHealth(loadAiToolConnection(db, id), false);
}

export const PICK_CONNECTED_AI_ERROR = "Pick a connected AI tool";

export async function requireConnectedAiToolId(
  db: Database.Database,
  raw: string,
): Promise<AiToolId> {
  ensureAiToolSchema(db);
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(PICK_CONNECTED_AI_ERROR);
  }
  const parsed = aiToolIdSchema.safeParse(trimmed);
  if (parsed.success !== true) {
    throw new Error("Unknown AI tool");
  }
  const connection = loadAiToolConnection(db, parsed.data);
  if (connection.lane === "cli") {
    const health = await probeCliTool(parsed.data);
    const presented = connectionWithCliHealth(connection, health.reachable);
    if (presented.connected !== true) {
      if (health.error.length > 0) {
        throw new Error(health.error);
      }
      throw new Error(`${connection.label} is not connected`);
    }
    return parsed.data;
  }
  if (connection.connected !== true) {
    throw new Error(`${connection.label} is not connected`);
  }
  return parsed.data;
}
