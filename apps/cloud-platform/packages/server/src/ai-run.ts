import { runOllamaChat } from "./ollama.js";
import { runOpenAiChat } from "./openai-compat.js";
import { runAnthropicChat } from "./anthropic-api.js";
import { requireAiTool, type AiToolId } from "./ai-catalog.js";
import { loadAiToolConnection, loadAiToolSecret } from "./ai-store.js";
import type Database from "better-sqlite3";

export async function runAiToolChat(
  db: Database.Database,
  id: AiToolId,
  system: string,
  user: string,
): Promise<string> {
  const tool = requireAiTool(id);
  if (tool.protocol === "cli") {
    throw new Error("CLI tools run through the default agent runtime");
  }
  const connection = loadAiToolConnection(db, id);
  const model = connection.model.trim();
  if (model.length === 0) {
    throw new Error(`Choose a model for ${tool.label}`);
  }
  if (tool.protocol === "ollama") {
    return await runOllamaChat(connection.baseUrl, model, system, user);
  }
  const secret = loadAiToolSecret(db, id);
  if (tool.lane === "cloud" && secret.length === 0) {
    throw new Error(`Connect ${tool.label} in Settings`);
  }
  if (tool.protocol === "anthropic") {
    return await runAnthropicChat(connection.baseUrl, secret, model, system, user);
  }
  return await runOpenAiChat(connection.baseUrl, secret, model, system, user);
}
