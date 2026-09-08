import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";
import { z } from "zod";

const TAGS_TIMEOUT_MS = 8_000;
const CHAT_MAX_TOKENS = 4096;

const openaiModelsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
    }),
  ),
});

const openaiChatSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string(),
      }),
    }),
  ),
});

const openaiAgent = new Agent({
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

async function fetchOpenAi(url: string, init?: UndiciRequestInit) {
  try {
    const options: UndiciRequestInit = { dispatcher: openaiAgent };
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

export function openaiAuthHeaders(secret: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const trimmed = secret.trim();
  if (trimmed.length === 0) {
    return headers;
  }
  headers.Authorization = `Bearer ${trimmed}`;
  return headers;
}

export function parseOpenAiModels(body: unknown): string[] {
  const parsed = openaiModelsSchema.safeParse(body);
  if (parsed.success !== true) {
    throw new Error("AI endpoint returned an unexpected model list");
  }
  const names: string[] = [];
  for (const row of parsed.data.data) {
    names.push(row.id);
  }
  return names;
}

export function parseOpenAiChat(body: unknown): string {
  const parsed = openaiChatSchema.safeParse(body);
  if (parsed.success !== true) {
    throw new Error("AI endpoint returned an unexpected response");
  }
  for (const choice of parsed.data.choices) {
    const text = choice.message.content.trim();
    if (text.length === 0) {
      throw new Error("AI endpoint returned empty text");
    }
    return text;
  }
  throw new Error("AI endpoint returned no choices");
}

export function openaiChatRequestBody(
  model: string,
  system: string,
  user: string,
): {
  model: string;
  stream: false;
  max_tokens: number;
  messages: { role: "system" | "user"; content: string }[];
} {
  return {
    model,
    stream: false,
    max_tokens: CHAT_MAX_TOKENS,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
}

export async function listOpenAiModels(base: string, secret: string): Promise<string[]> {
  const trimmed = trimBase(base);
  if (trimmed.length === 0) {
    throw new Error("Set an AI endpoint");
  }
  const url = `${trimmed}/models`;
  const res = await fetchOpenAi(url, {
    headers: openaiAuthHeaders(secret),
    signal: AbortSignal.timeout(TAGS_TIMEOUT_MS),
  });
  if (res.ok !== true) {
    throw new Error(`AI endpoint is not reachable (${String(res.status)})`);
  }
  const body: unknown = await res.json();
  return parseOpenAiModels(body);
}

export async function runOpenAiChat(
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
  const url = `${trimmed}/chat/completions`;
  const res = await fetchOpenAi(url, {
    method: "POST",
    headers: openaiAuthHeaders(secret),
    body: JSON.stringify(openaiChatRequestBody(trimmedModel, system, user)),
  });
  if (res.ok !== true) {
    throw new Error(`AI request failed (${String(res.status)})`);
  }
  const body: unknown = await res.json();
  return parseOpenAiChat(body);
}
