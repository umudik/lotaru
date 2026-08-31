import { spawn } from "node:child_process";
import { type AppSettings } from "./app-settings.js";
import {
  defaultAgentCommand,
  resolvedAgentCommand,
  type AgentKind,
  type AgentProfile,
} from "./agent-runtime.js";
import { listOllamaModels } from "./ollama.js";

export type AgentProbeResult = {
  reachable: boolean;
  kind: AgentKind;
  command: string;
  detail: string;
  error: string;
};

const CLI_PROBE_TIMEOUT_MS = 8_000;

export async function locateCliBinary(
  command: string,
  platform: string = process.platform,
): Promise<string[]> {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return [];
  }
  if (platform === "win32") {
    return runLocate("where.exe", [trimmed]);
  }
  return runLocate("/bin/sh", ["-c", `command -v -- ${shellSingleQuote(trimmed)}`]);
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function runLocate(cmd: string, args: string[]): Promise<string[]> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      resolve([]);
    }, CLI_PROBE_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve([]);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        resolve([]);
        return;
      }
      const paths: string[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        const path = line.trim();
        if (path.length === 0) {
          continue;
        }
        paths.push(path);
      }
      resolve(paths);
    });
  });
}

export async function probeAgentRuntime(input: {
  profile: AgentProfile;
  settings: AppSettings;
  locateBinary?: (command: string) => Promise<string[]>;
}): Promise<AgentProbeResult> {
  if (input.profile.kind === "ollama") {
    return probeOllamaAgent(input.profile, input.settings);
  }
  let command = defaultAgentCommand(input.profile.kind);
  try {
    command = resolvedAgentCommand(input.profile.kind, input.profile.command);
  } catch (err) {
    let message = "Invalid CLI binary override";
    if (err instanceof Error && err.message.length > 0) {
      message = err.message;
    }
    return {
      reachable: false,
      kind: input.profile.kind,
      command,
      detail: "",
      error: message,
    };
  }
  const locate = input.locateBinary !== undefined ? input.locateBinary : locateCliBinary;
  const paths = await locate(command);
  if (paths.length === 0) {
    return {
      reachable: false,
      kind: input.profile.kind,
      command,
      detail: "",
      error: `CLI binary "${command}" not found on PATH`,
    };
  }
  return {
    reachable: true,
    kind: input.profile.kind,
    command,
    detail: paths[0],
    error: "",
  };
}

async function probeOllamaAgent(
  profile: AgentProfile,
  settings: AppSettings,
): Promise<AgentProbeResult> {
  const host = settings.ollamaHost.trim();
  if (host.length === 0) {
    return {
      reachable: false,
      kind: profile.kind,
      command: "ollama",
      detail: "",
      error: "Set Ollama host in Settings",
    };
  }
  try {
    const models = await listOllamaModels(host);
    const model = settings.ollamaModel.trim();
    if (model.length === 0) {
      return {
        reachable: false,
        kind: profile.kind,
        command: "ollama",
        detail: host,
        error: "Choose an Ollama model in Settings",
      };
    }
    let modelFound = false;
    for (const name of models) {
      if (name === model) {
        modelFound = true;
      }
    }
    if (modelFound !== true) {
      return {
        reachable: false,
        kind: profile.kind,
        command: "ollama",
        detail: host,
        error: `Model "${model}" is not installed in Ollama`,
      };
    }
    return {
      reachable: true,
      kind: profile.kind,
      command: "ollama",
      detail: `${host} · ${model}`,
      error: "",
    };
  } catch (err) {
    let message = "Ollama is not reachable";
    if (err instanceof Error && err.message.length > 0) {
      message = err.message;
    }
    return {
      reachable: false,
      kind: profile.kind,
      command: "ollama",
      detail: host,
      error: message,
    };
  }
}
