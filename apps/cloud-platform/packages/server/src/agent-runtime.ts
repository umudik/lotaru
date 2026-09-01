import { spawn } from "node:child_process";
import { z } from "zod";

export type AgentKind = "ollama" | "cursor" | "claude" | "codex";
export type AgentMode = "ask" | "plan" | "execute";

export type AgentProfile = {
  kind: AgentKind;
  mode: AgentMode;
  command: string;
};

export type AgentCliSpec = {
  command: string;
  args: string[];
};

export type AgentRunInput = {
  kind: AgentKind;
  mode: AgentMode;
  command: string;
  prompt: string;
  cwd: string;
};

const agentKindSchema = z.enum(["ollama", "cursor", "claude", "codex"]);
const agentModeSchema = z.enum(["ask", "plan", "execute"]);

export const AGENT_TIMEOUT_MS = 120_000;

export function parseAgentKind(value: string): AgentKind {
  const parsed = agentKindSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Unknown agent");
  }
  return parsed.data;
}

export function parseAgentMode(value: string): AgentMode {
  const parsed = agentModeSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Unknown agent mode");
  }
  return parsed.data;
}

export function defaultAgentCommand(kind: AgentKind): string {
  if (kind === "cursor") {
    return "agent";
  }
  if (kind === "claude") {
    return "claude";
  }
  if (kind === "codex") {
    return "codex";
  }
  return "ollama";
}

export function resolvedAgentCommand(kind: AgentKind, command: string): string {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return defaultAgentCommand(kind);
  }
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    throw new Error("Agent command override must be a bare binary name");
  }
  if (trimmed.includes(":") || trimmed.includes(" ")) {
    throw new Error("Agent command override must be a bare binary name");
  }
  const nameOk = /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trimmed);
  if (nameOk !== true) {
    throw new Error("Agent command override must be a bare binary name");
  }
  return trimmed;
}

export function agentCliSpec(input: {
  kind: AgentKind;
  mode: AgentMode;
  command: string;
  prompt: string;
}): AgentCliSpec {
  if (input.kind === "ollama") {
    throw new Error("Ollama runs locally, not as an agent CLI");
  }
  const command = resolvedAgentCommand(input.kind, input.command);
  if (input.kind === "cursor") {
    return cursorCliSpec(command, input.mode, input.prompt);
  }
  if (input.kind === "claude") {
    return claudeCliSpec(command, input.mode, input.prompt);
  }
  return codexCliSpec(command, input.mode, input.prompt);
}

function cursorCliSpec(command: string, mode: AgentMode, prompt: string): AgentCliSpec {
  const args = ["-p", "--output-format", "text"];
  if (mode === "ask") {
    args.push("--mode=ask");
  }
  if (mode === "plan") {
    args.push("--mode=plan");
  }
  if (mode === "execute") {
    args.push("--force");
  }
  args.push(prompt);
  return { command, args };
}

function claudeCliSpec(command: string, mode: AgentMode, prompt: string): AgentCliSpec {
  const args = ["-p", "--output-format", "text"];
  if (mode === "ask") {
    args.push("--permission-mode", "plan");
  }
  if (mode === "plan") {
    args.push("--permission-mode", "plan");
  }
  if (mode === "execute") {
    args.push("--permission-mode", "acceptEdits");
  }
  args.push(prompt);
  return { command, args };
}

function codexCliSpec(command: string, mode: AgentMode, prompt: string): AgentCliSpec {
  const args = ["exec"];
  if (mode === "ask" || mode === "plan") {
    args.push("--sandbox", "read-only");
  }
  if (mode === "execute") {
    args.push("--sandbox", "workspace-write");
  }
  args.push(prompt);
  return { command, args };
}

export function spawnAgentCli(spec: AgentCliSpec, cwd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd,
      env: process.env,
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Agent timed out"));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      const codeSchema = z.object({ code: z.string(), path: z.string().optional() });
      const parsed = codeSchema.safeParse(err);
      if (parsed.success === true && parsed.data.code === "ENOENT") {
        let binary = spec.command;
        if (parsed.data.path !== undefined && parsed.data.path.trim().length > 0) {
          binary = parsed.data.path.trim();
        }
        reject(
          new Error(
            `CLI binary "${binary}" not found on PATH. In Docker, host CLIs (agent/claude/codex) are unavailable — switch AI to Local Ollama, or run Lotaru on the host.`,
          ),
        );
        return;
      }
      if (err instanceof Error && err.message.length > 0) {
        reject(err);
        return;
      }
      reject(new Error("Responder failed to start"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      let detail = stderr.trim();
      if (detail.length === 0) {
        detail = `exit ${String(code)}`;
      }
      reject(new Error(detail));
    });
  });
}
