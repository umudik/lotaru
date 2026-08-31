import type { FastifyInstance, FastifyRequest } from "fastify";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  getProjectById,
  userCanAccessProject,
} from "../../../../../task-bridge/apps/backend/dist/services/project-registry.js";
import { hostProcessEnv, interactiveHostShell } from "../host-shell.js";
import { requireExistingDirectory } from "../folder-path.js";
import type { Identity } from "./identity.js";

type Viewer = { email: string; sub: string };

type ModuleOptions = {
  identity: Identity;
  projectAccess?: (projectId: string, userId: string) => boolean;
};

function canSeeProject(options: ModuleOptions, projectId: string, userId: string): boolean {
  if (options.projectAccess !== undefined) {
    return options.projectAccess(projectId, userId);
  }
  return userCanAccessProject(projectId, userId);
}

async function viewersFrom(request: FastifyRequest, options: ModuleOptions): Promise<Viewer[]> {
  const user = await options.identity.userFrom(request);
  if (user === null) {
    return [];
  }
  return [{ email: user.email, sub: user.id }];
}

function resolveProjectCwd(projectId: string): string {
  const project = getProjectById(projectId);
  if (project === null) {
    throw new Error("Project not found");
  }
  const repoPath = project.repoPath.trim();
  if (repoPath.length === 0) {
    throw new Error("Set a project folder before opening the terminal");
  }
  return requireExistingDirectory(repoPath);
}

function sendJson(socket: { send: (payload: string) => void }, payload: Record<string, string | number>): void {
  socket.send(JSON.stringify(payload));
}

function attachShellStreams(
  socket: { send: (payload: string) => void; close: () => void },
  child: ChildProcessWithoutNullStreams,
): void {
  child.stdout.on("data", (chunk: Buffer) => {
    sendJson(socket, { type: "output", data: chunk.toString("utf8") });
  });
  child.stderr.on("data", (chunk: Buffer) => {
    sendJson(socket, { type: "output", data: chunk.toString("utf8") });
  });
  child.on("close", (code) => {
    sendJson(socket, { type: "exit", code: code === null ? 1 : code });
    socket.close();
  });
  child.on("error", (err) => {
    sendJson(socket, { type: "error", data: err.message });
    socket.close();
  });
}

function writeShellInput(child: ChildProcessWithoutNullStreams, data: string): void {
  if (child.stdin.destroyed) {
    return;
  }
  try {
    child.stdin.write(data);
  } catch {
    return;
  }
}

function trackShellProcess(
  shells: Set<ChildProcessWithoutNullStreams>,
  child: ChildProcessWithoutNullStreams,
): void {
  shells.add(child);
  const release = (): void => {
    shells.delete(child);
  };
  child.on("close", release);
  child.on("error", release);
}

export async function registerTerminalModule(
  app: FastifyInstance,
  options: ModuleOptions,
): Promise<void> {
  const activeShells = new Set<ChildProcessWithoutNullStreams>();

  app.addHook("preClose", async () => {
    for (const shell of activeShells) {
      shell.kill();
    }
    activeShells.clear();
  });
  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/terminal/ws",
    { websocket: true },
    (socket, request) => {
      void (async () => {
        const viewers = await viewersFrom(request, options);
        if (viewers.length === 0) {
          socket.close(4401, "unauthorized");
          return;
        }
        const projectId = request.params.projectId.trim();
        if (projectId.length === 0) {
          socket.close(4400, "projectId required");
          return;
        }
        if (canSeeProject(options, projectId, viewers[0].sub) !== true) {
          socket.close(4404, "not found");
          return;
        }
        let cwd = "";
        try {
          cwd = resolveProjectCwd(projectId);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Project folder unavailable";
          sendJson(socket, { type: "error", data: message });
          socket.close(1011, "cwd failed");
          return;
        }
        const shell = interactiveHostShell(process.platform);
        const child = spawn(shell.cmd, shell.args, {
          cwd,
          env: hostProcessEnv({}),
          windowsHide: true,
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        });
        trackShellProcess(activeShells, child);
        attachShellStreams(socket, child);
        sendJson(socket, { type: "hello", cwd });
        socket.on("message", (raw: Buffer | string) => {
          let text = "";
          if (typeof raw === "string") {
            text = raw;
          } else {
            text = raw.toString("utf8");
          }
          let parsed: { type?: string; data?: string } = {};
          try {
            parsed = JSON.parse(text) as { type?: string; data?: string };
          } catch {
            parsed = { type: "input", data: text };
          }
          if (parsed.type === "input" && typeof parsed.data === "string") {
            writeShellInput(child, parsed.data);
            return;
          }
          if (parsed.type === "resize") {
            return;
          }
        });
        socket.on("close", () => {
          child.kill();
        });
      })();
    },
  );
}
