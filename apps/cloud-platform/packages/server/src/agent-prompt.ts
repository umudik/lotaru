import {
  getProjectById,
} from "../../../../task-bridge/apps/backend/dist/services/project-registry.js";
import { loadAppSettings, openSettingsDb } from "./app-settings.js";
import {
  AGENT_TIMEOUT_MS,
  agentCliSpec,
  parseAgentKind,
  spawnAgentCli,
  type AgentKind,
  type AgentMode,
} from "./agent-runtime.js";
import { loadAgentProfile, openAgentDb } from "./agent-store.js";
import { requireExistingDirectory } from "./folder-path.js";
import { runOllamaChat } from "./ollama.js";
import { aiToolIdSchema, requireAiTool } from "./ai-catalog.js";
import { PICK_CONNECTED_AI_ERROR } from "./ai-health.js";
import { ensureAiToolSchema } from "./ai-store.js";
import { runAiToolChat } from "./ai-run.js";

export type AgentRunFn = (input: {
  kind: AgentKind;
  mode: AgentMode;
  prompt: string;
  cwd: string;
}) => Promise<string>;

const DEFAULT_AGENT_SYSTEM =
  "You are a Lotaru assistant. Answer clearly and stay on topic. Write in the same language as the user's instructions and the event text. Do not switch to English unless those are in English.";

export function replyLanguageInstruction(targetLanguageLabel: string): string {
  const label = targetLanguageLabel.trim();
  const follow =
    "Write the reply in the same language as the user's instructions and the event text.";
  const scaffold =
    "English lines in this prompt are platform scaffolding. Do not switch the body to English unless the instructions are in English.";
  if (label.length === 0) {
    return `${follow} ${scaffold}`;
  }
  return `${follow} ${scaffold} If the instructions do not pick a language, write in ${label}.`;
}

export type RunProjectAgentOptions = {
  databasePath: string;
  projectId: string;
  prompt: string;
  mode?: AgentMode;
  systemPrompt?: string;
  projectCwd?: (projectId: string) => string;
  runAgent?: AgentRunFn;
  aiToolId?: string;
};

export type RunLocalOllamaOptions = {
  databasePath: string;
  systemPrompt: string;
  prompt: string;
};

function agentSystemPrompt(input: RunProjectAgentOptions): string {
  if (input.systemPrompt !== undefined && input.systemPrompt.trim().length > 0) {
    return input.systemPrompt.trim();
  }
  return DEFAULT_AGENT_SYSTEM;
}

function cliPrompt(systemPrompt: string, userPrompt: string): string {
  return `${systemPrompt}\n\n${userPrompt}`;
}

function projectWorkingDirectory(
  projectId: string,
  projectCwd: ((projectId: string) => string) | undefined,
): string {
  if (projectCwd !== undefined) {
    return projectCwd(projectId);
  }
  const project = getProjectById(projectId);
  if (project === null) {
    throw new Error("Project not found");
  }
  const repoPath = project.repoPath.trim();
  if (repoPath.length === 0) {
    throw new Error("Set a project folder before running a responder");
  }
  return requireExistingDirectory(repoPath);
}

export async function runProjectAgentPrompt(input: RunProjectAgentOptions): Promise<string> {
  const systemPrompt = agentSystemPrompt(input);
  if (input.runAgent !== undefined) {
    const profile = loadAgentProfile(openAgentDb(input.databasePath));
    let mode = profile.mode;
    if (input.mode !== undefined) {
      mode = input.mode;
    }
    const cwd = projectWorkingDirectory(input.projectId, input.projectCwd);
    return input.runAgent({
      kind: profile.kind,
      mode,
      prompt: input.prompt,
      cwd,
    });
  }
  let toolId = "";
  if (input.aiToolId !== undefined) {
    toolId = input.aiToolId.trim();
  }
  if (toolId.length === 0) {
    throw new Error(PICK_CONNECTED_AI_ERROR);
  }
  const parsed = aiToolIdSchema.safeParse(toolId);
  if (parsed.success !== true) {
    throw new Error("Unknown AI tool");
  }
  const tool = requireAiTool(parsed.data);
  if (tool.protocol !== "cli") {
    const settingsDb = openSettingsDb(input.databasePath);
    ensureAiToolSchema(settingsDb);
    return await runAiToolChat(settingsDb, parsed.data, systemPrompt, input.prompt);
  }
  let mode: AgentMode = "ask";
  if (input.mode !== undefined) {
    mode = input.mode;
  }
  const cwd = projectWorkingDirectory(input.projectId, input.projectCwd);
  const spec = agentCliSpec({
    kind: parseAgentKind(parsed.data),
    mode,
    command: "",
    prompt: cliPrompt(systemPrompt, input.prompt),
  });
  return spawnAgentCli(spec, cwd, AGENT_TIMEOUT_MS);
}

export function activeAgentKind(databasePath: string): AgentKind {
  return loadAgentProfile(openAgentDb(databasePath)).kind;
}

export async function runLocalOllamaPrompt(input: RunLocalOllamaOptions): Promise<string> {
  const settingsDb = openSettingsDb(input.databasePath);
  const settings = loadAppSettings(settingsDb);
  return runOllamaChat(
    settings.ollamaHost,
    settings.ollamaModel,
    input.systemPrompt,
    input.prompt,
  );
}

