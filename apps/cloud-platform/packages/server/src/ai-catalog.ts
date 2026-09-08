import { z } from "zod";

export const AI_TOOL_IDS = [
  "ollama",
  "lmstudio",
  "llamacpp",
  "openai",
  "anthropic",
  "groq",
  "openrouter",
  "mistral",
  "deepseek",
  "gemini",
  "cursor",
  "claude",
  "codex",
] as const;

export const aiToolIdSchema = z.enum(AI_TOOL_IDS);

export type AiToolId = (typeof AI_TOOL_IDS)[number];

export type AiToolLane = "local" | "cloud" | "cli";

export type AiToolProtocol = "ollama" | "openai" | "anthropic" | "cli";

export type AiTool = {
  id: AiToolId;
  label: string;
  lane: AiToolLane;
  protocol: AiToolProtocol;
  defaultBase: string;
  defaultModel: string;
};

const TOOLS: readonly AiTool[] = [
  {
    id: "ollama",
    label: "Ollama",
    lane: "local",
    protocol: "ollama",
    defaultBase: "http://127.0.0.1:11434",
    defaultModel: "",
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    lane: "local",
    protocol: "openai",
    defaultBase: "http://127.0.0.1:1234/v1",
    defaultModel: "",
  },
  {
    id: "llamacpp",
    label: "llama.cpp",
    lane: "local",
    protocol: "openai",
    defaultBase: "http://127.0.0.1:8080/v1",
    defaultModel: "",
  },
  {
    id: "openai",
    label: "OpenAI",
    lane: "cloud",
    protocol: "openai",
    defaultBase: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    lane: "cloud",
    protocol: "anthropic",
    defaultBase: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-6",
  },
  {
    id: "groq",
    label: "Groq",
    lane: "cloud",
    protocol: "openai",
    defaultBase: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.1-8b-instant",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    lane: "cloud",
    protocol: "openai",
    defaultBase: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4.1-mini",
  },
  {
    id: "mistral",
    label: "Mistral",
    lane: "cloud",
    protocol: "openai",
    defaultBase: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    lane: "cloud",
    protocol: "openai",
    defaultBase: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    lane: "cloud",
    protocol: "openai",
    defaultBase: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
  },
  {
    id: "cursor",
    label: "Cursor Agent CLI",
    lane: "cli",
    protocol: "cli",
    defaultBase: "",
    defaultModel: "",
  },
  {
    id: "claude",
    label: "Claude Code CLI",
    lane: "cli",
    protocol: "cli",
    defaultBase: "",
    defaultModel: "",
  },
  {
    id: "codex",
    label: "Codex CLI",
    lane: "cli",
    protocol: "cli",
    defaultBase: "",
    defaultModel: "",
  },
];

export function listAiTools(): readonly AiTool[] {
  const copy: AiTool[] = [];
  for (const tool of TOOLS) {
    copy.push(tool);
  }
  return copy;
}

export function aiToolById(id: string): AiTool[] {
  const hits: AiTool[] = [];
  const parsed = aiToolIdSchema.safeParse(id);
  if (parsed.success !== true) {
    return hits;
  }
  for (const tool of TOOLS) {
    if (tool.id === parsed.data) {
      hits.push(tool);
    }
  }
  return hits;
}

export function requireAiTool(id: string): AiTool {
  const hits = aiToolById(id);
  for (const tool of hits) {
    return tool;
  }
  throw new Error(`unknown AI tool ${id}`);
}
