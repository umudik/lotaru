import { existsSync } from "node:fs";

export type HostShellSpec = {
  cmd: string;
  args: string[];
};

export function hostShellSpawn(platform: string, command: string): HostShellSpec {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    throw new Error("Script command is required");
  }
  if (platform === "win32") {
    return { cmd: "cmd.exe", args: ["/d", "/s", "/c", trimmed] };
  }
  return { cmd: "/bin/sh", args: ["-c", trimmed] };
}

export function interactiveHostShell(
  platform: string,
  envShell: string | undefined = process.env.SHELL,
): HostShellSpec {
  if (platform === "win32") {
    return { cmd: "powershell.exe", args: ["-NoLogo"] };
  }
  if (envShell !== undefined) {
    const trimmed = envShell.trim();
    if (trimmed.length > 0 && existsSync(trimmed)) {
      return { cmd: trimmed, args: [] };
    }
  }
  if (existsSync("/bin/bash")) {
    return { cmd: "/bin/bash", args: [] };
  }
  return { cmd: "/bin/sh", args: [] };
}

export function hostProcessEnv(custom: Record<string, string>): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) {
      continue;
    }
    merged[key] = value;
  }
  for (const [key, value] of Object.entries(custom)) {
    merged[key] = value;
  }
  return merged;
}
