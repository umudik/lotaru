import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";
import { z } from "zod";

const TAGS_TIMEOUT_MS = 8_000;
const CHAT_MAX_TOKENS = 4096;
const ANTHROPIC_VERSION = "2023-06-01";

const anthropicModelsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
    }),
  ),
});

const anthropicMessageSchema = z.object({
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string().optional(),
    }),
  ),
});

const anthropicAgent = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
});

function trimBase(base: string): string {
  return base.trim().replace(/\/$/, "");
}

function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  if (err.name === "TimeoutError") {
    return true;
  }
  if (err.name === "AbortError") {
    return true;
  }
  return false;
}

async function fetchAnthropic(url: string, init?: UndiciRequestInit) {
  try {
    const options: UndiciRequestInit = { dispatcher: anthropicAgent };
    if (init !== undefined) {
      if (init.method !== undefined) {
        options.method = init.method;
      }
      if (init.headers !== undefined) {
        options.headers = init.headers;
      }
      if (init.body !== undefined) {
        options.body = init.body;
      }
      if (init.signal !== undefined) {
        options.signal = init.signal;
      }
    }
    return await undiciFetch(url, options);
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new Error("AI endpoint timed out");
    }
    throw err;
  }
}

export function anthropicHeaders(secret: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
  };
  const trimmed = secret.trim();
  if (trimmed.length === 0) {
    return headers;
  }
  headers["x-api-key"] = trimmed;
  return headers;
}

export function parseAnthropicModels(body: unknown): string[] {
  const parsed = anthropicModelsSchema.safeParse(body);
  if (parsed.success !== true) {
    throw new Error("Anthropic returned an unexpected model list");
  }
  const names: string[] = [];
  for (const row of parsed.data.data) {
    names.push(row.id);
  }
  return names;
}

export function parseAnthropicMessage(body: unknown): string {
  const parsed = anthropicMessageSchema.safeParse(body);
  if (parsed.success !== true) {
    throw new Error("Anthropic returned an unexpected response");
  }
  const chunks: string[] = [];
  for (const block of parsed.data.content) {
    if (block.type !== "text") {
      continue;
    }
    if (block.text === undefined) {
      continue;
    }
    const piece = block.text.trim();
    if (piece.length === 0) {
      continue;
    }
    chunks.push(piece);
  }
  if (chunks.length === 0) {
    throw new Error("Anthropic returned empty text");
  }
  return chunks.join("\n");
}

export async function listAnthropicModels(base: string, secret: string): Promise<string[]> {
  const trimmed = trimBase(base);
  if (trimmed.length === 0) {
    throw new Error("Set an AI endpoint");
  }
  if (secret.trim().length === 0) {
    throw new Error("Paste an Anthropic API key in Settings");
  }
  const url = `${trimmed}/models`;
  const res = await fetchAnthropic(url, {
    headers: anthropicHeaders(secret),
    signal: AbortSignal.timeout(TAGS_TIMEOUT_MS),
  });
  if (res.ok !== true) {
    throw new Error(`Anthropic is not reachable (${String(res.status)})`);
  }
  const body: unknown = await res.json();
  return parseAnthropicModels(body);
}

export async function runAnthropicChat(
  base: string,
  secret: string,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  const trimmedModel = model.trim();
  if (trimmedModel.length === 0) {
    throw new Error("Choose an AI model");
  }
  const trimmed = trimBase(base);
  if (trimmed.length === 0) {
    throw new Error("Set an AI endpoint");
  }
  if (secret.trim().length === 0) {
    throw new Error("Connect Anthropic in Settings");
  }
  const url = `${trimmed}/messages`;
  const res = await fetchAnthropic(url, {
    method: "POST",
    headers: anthropicHeaders(secret),
    body: JSON.stringify({
      model: trimmedModel,
      max_tokens: CHAT_MAX_TOKENS,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (res.ok !== true) {
    throw new Error(`Anthropic request failed (${String(res.status)})`);
  }
  const body: unknown = await res.json();
  return parseAnthropicMessage(body);
}
