import { z } from "zod";
import { languageLabel } from "./note-language.js";

const ollamaChatSchema = z.object({
  message: z.object({
    content: z.string().min(1),
  }),
});

const ollamaTagsSchema = z.object({
  models: z.array(
    z.object({
      name: z.string().min(1),
    }),
  ),
});

const TAGS_TIMEOUT_MS = 8_000;
const CHAT_TIMEOUT_MS = 25_000;

export function translationSystemPrompt(label: string): string {
  return [
    `You translate the user's text into ${label}.`,
    "Keep the author's meaning. Do not add explanation or commentary.",
    "Do not summarize. Do not repair spelling except as needed for a natural translation.",
    `Return only the ${label} text. Keep paragraph breaks. Do not add notes or quotes.`,
  ].join(" ");
}

export function polishSystemPrompt(): string {
  return [
    "You repair spelling, typing mistakes, and missing native characters.",
    "For Turkish, restore ç ğ ı İ ö ş ü and dotted/dotless i as needed (guzel → güzel, kardesim → kardeşim).",
    "Do not translate. Do not summarize. Do not add or remove ideas.",
    "Keep the same language and paragraph breaks.",
    "Return only the corrected text. Do not add notes or quotes.",
  ].join(" ");
}

export function summarySystemPrompt(): string {
  return [
    "You write a short, clear summary of the user's text in the same language as the source.",
    "Keep the facts. Do not add new ideas. Do not quote the entire source.",
    "Return only the summary. Keep paragraph breaks if they help. Do not add notes or quotes.",
  ].join(" ");
}

function trimHost(host: string): string {
  return host.trim().replace(/\/$/, "");
}

function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  return err.name === "TimeoutError" || err.name === "AbortError";
}

async function fetchOllama(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  try {
    const options = Object.assign({}, init, { signal: AbortSignal.timeout(timeoutMs) });
    return await fetch(url, options);
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new Error("Ollama timed out. The model may still be loading — retry.");
    }
    throw err;
  }
}

export function parseOllamaChat(body: unknown): string {
  const parsed = ollamaChatSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("Ollama returned an unexpected response");
  }
  return parsed.data.message.content.trim();
}

export function parseOllamaTags(body: unknown): string[] {
  const parsed = ollamaTagsSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("Ollama returned an unexpected model list");
  }
  const names: string[] = [];
  for (const model of parsed.data.models) {
    names.push(model.name);
  }
  return names;
}

export async function listOllamaModels(host: string): Promise<string[]> {
  const url = `${trimHost(host)}/api/tags`;
  const res = await fetchOllama(url, TAGS_TIMEOUT_MS);
  if (!res.ok) {
    throw new Error(`Ollama is not reachable (${String(res.status)})`);
  }
  const body: unknown = await res.json();
  return parseOllamaTags(body);
}

export async function runOllamaChat(
  host: string,
  model: string,
  system: string,
  user: string,
): Promise<string> {
  if (model.trim().length === 0) {
    throw new Error("Choose an Ollama model in Settings");
  }
  const url = `${trimHost(host)}/api/chat`;
  const res = await fetchOllama(url, CHAT_TIMEOUT_MS, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      keep_alive: "30m",
      options: { temperature: 0 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Ollama request failed (${String(res.status)})`);
  }
  const body: unknown = await res.json();
  return parseOllamaChat(body);
}

export async function translateText(
  host: string,
  model: string,
  targetLanguage: string,
  text: string,
): Promise<string> {
  const label = languageLabel(targetLanguage);
  return runOllamaChat(host, model, translationSystemPrompt(label), text);
}

export async function polishText(host: string, model: string, text: string): Promise<string> {
  return runOllamaChat(host, model, polishSystemPrompt(), text);
}

export async function summarizeText(host: string, model: string, text: string): Promise<string> {
  return runOllamaChat(host, model, summarySystemPrompt(), text);
}
