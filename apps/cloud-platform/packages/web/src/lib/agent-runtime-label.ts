import type { AgentKind, AgentMode } from "@/lib/api";

export function agentRuntimeLabel(kind: AgentKind): string {
  if (kind === "ollama") {
    return "Ollama";
  }
  if (kind === "cursor") {
    return "Cursor Agent";
  }
  if (kind === "claude") {
    return "Claude Code";
  }
  return "Codex";
}

export function agentRuntimeDetail(
  kind: AgentKind,
  ollamaModel: string,
  mode: AgentMode,
): string {
  const provider = agentRuntimeLabel(kind);
  if (kind === "ollama" && ollamaModel.trim().length > 0) {
    return `${provider} · ${ollamaModel.trim()} · ${mode} mode`;
  }
  return `${provider} · ${mode} mode`;
}
