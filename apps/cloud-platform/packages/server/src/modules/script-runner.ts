import Database from "better-sqlite3";
import { spawn, type ChildProcess } from "node:child_process";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import type { WebSocket } from "ws";
import { z } from "zod";
import { getProjectById, refreshProjectRegistry, userCanAccessProject } from "../../../../../task-bridge/apps/backend/dist/services/project-registry.js";
import type { Identity, IdentityUser } from "./identity.js";
import { requireExistingDirectory } from "../folder-path.js";
import { hostProcessEnv, hostShellSpawn } from "../host-shell.js";
import { parseHostRuntime } from "../script-runtime.js";
import {
  CLOCK_TICK_MS,
  EVENT_APP_STARTED,
  EVENT_CLOCK_TICK,
  EVENT_FILE_CHANGED,
  canonicalBusEventType,
  eventRunReason,
  isBusEventType,
  relativeWatchPath,
  replayPayloadsFromStored,
  scriptListensToEvent,
  type EventListenerScript,
  type LotaruEvent,
} from "../events.js";
import { ensureEventLogSchema, eventsById, listProjectEvents, recordEvent } from "../event-log.js";
import { createFileWatchers } from "../file-watch.js";
import { mergeGithubWatches, pollGithubOnce, startGithubPoller, type GithubWatch } from "../github-poll.js";
import { listGithubReposAt } from "../github-remote.js";
import { createIntentTask } from "../intent-task.js";
import { fireKnowledgeTemplatesForEvent } from "./knowledge-templates.js";
import { fireAgentsForEvent } from "./agents.js";
import { setLotaruEventPublisher } from "../event-bus.js";
import {
  claimReactionFire,
  deleteReaction,
  ensureReactionSchema,
  insertReaction,
  listEnabledGithubRepos,
  listReactions,
  loadGithubToken,
  parseReactionInput,
  releaseReactionFire,
} from "../reaction-store.js";
import {
  eventListenerRefs,
  reactionEventTypesForClient,
  reactionFireFingerprint,
  reactionMatchesEvent,
  REACTION_CREATE_TASK,
  type NamedEventScript,
} from "../reactions.js";

type RuntimeKind = "shell" | "docker";
type TriggerKind = "save" | "manual" | "startup" | "scheduled";
type ConcurrencyKind = "restart" | "queue" | "ignore" | "parallel";
type ExecutionStatus = "pending" | "running" | "success" | "failed" | "cancelled";

type ProjectSettings = {
  project_id: string;
  owner_id: string;
  paused: boolean;
  active_environment_id: string | null;
  created_at: number;
};

type Environment = {
  id: string;
  project_id: string;
  name: string;
  vars: Record<string, string>;
  created_at: number;
};

type Script = {
  id: string;
  project_id: string;
  name: string;
  command: string;
  runtime: RuntimeKind;
  // Empty string means "unset" — these are optional depending on runtime/trigger_type,
  // not absent data, so there is no NULL state to represent.
  docker_image: string;
  docker_platform: string;
  trigger_type: TriggerKind;
  trigger_glob: string;
  trigger_cron: string;
  concurrency: ConcurrencyKind;
  enabled: boolean;
  created_at: number;
};

type Execution = {
  id: string;
  script_id: string;
  status: ExecutionStatus;
  started_at: number | null;
  ended_at: number | null;
  exit_code: number | null;
  trigger_reason: string;
  log_path: string;
};

type ServerMessage =
  | { kind: "execution.started"; executionId: string; scriptId: string; ts: number }
  | { kind: "execution.log"; executionId: string; line: string; stream: "out" | "err"; ts: number }
  | {
      kind: "execution.ended";
      executionId: string;
      status: ExecutionStatus;
      exitCode: number | null;
      ts: number;
    }
  | { kind: "script.updated"; scriptId: string }
  | { kind: "script.deleted"; scriptId: string }
  | { kind: "project.updated"; projectId: string }
  | {
      kind: "hello";
      ts: number;
      running: { executionId: string; scriptId: string; startedAt: number }[];
    };

export type ScriptRunnerOptions = {
  identity: Identity;
  dataDir: string;
  databasePath: string;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS script_project_settings (
  project_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  active_environment_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS script_environments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  vars_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  UNIQUE(project_id, name)
);
CREATE INDEX IF NOT EXISTS idx_script_environments_project ON script_environments(project_id);
CREATE TABLE IF NOT EXISTS script_scripts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  runtime TEXT NOT NULL,
  docker_image TEXT NOT NULL DEFAULT '',
  docker_platform TEXT NOT NULL DEFAULT '',
  trigger_type TEXT NOT NULL,
  trigger_glob TEXT NOT NULL DEFAULT '',
  trigger_cron TEXT NOT NULL DEFAULT '',
  concurrency TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_script_scripts_project ON script_scripts(project_id, owner_id);
CREATE TABLE IF NOT EXISTS script_executions (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL REFERENCES script_scripts(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  exit_code INTEGER,
  trigger_reason TEXT NOT NULL,
  log_path TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_script_executions_script ON script_executions(script_id, started_at DESC);
`;

function isRuntime(v: unknown): v is RuntimeKind {
  return parseHostRuntime(v) === "shell";
}
function isTrigger(v: unknown): v is TriggerKind {
  return v === "save" || v === "manual" || v === "startup" || v === "scheduled";
}
function isConcurrency(v: unknown): v is ConcurrencyKind {
  return v === "restart" || v === "queue" || v === "ignore" || v === "parallel";
}

type CreateScriptBody = {
  name: string;
  command: string;
  runtime: RuntimeKind;
  docker_image: string;
  docker_platform: string;
  trigger_type: TriggerKind;
  trigger_glob: string;
  trigger_cron: string;
  concurrency: ConcurrencyKind;
  enabled: boolean;
};

function optionalString(raw: unknown): string | "invalid" {
  if (raw === undefined || raw === null) {
    return "";
  }
  if (typeof raw !== "string") {
    return "invalid";
  }
  return raw;
}

function validateCreateScript(body: unknown): CreateScriptBody | string {
  if (typeof body !== "object" || body === null) {
    return "body must be object";
  }
  const b = body as Record<string, unknown>;
  if (typeof b["name"] !== "string" || b["name"].length === 0) {
    return "name required";
  }
  if (typeof b["command"] !== "string" || b["command"].length === 0) {
    return "command required";
  }
  if (!isRuntime(b["runtime"])) {
    return "invalid runtime";
  }
  if (!isTrigger(b["trigger_type"])) {
    return "invalid trigger_type";
  }
  if (!isConcurrency(b["concurrency"])) {
    return "invalid concurrency";
  }
  const dockerImage = optionalString(b["docker_image"]);
  if (dockerImage === "invalid") {
    return "docker_image must be a string";
  }
  const dockerPlatform = optionalString(b["docker_platform"]);
  if (dockerPlatform === "invalid") {
    return "docker_platform must be a string";
  }
  const triggerGlob = optionalString(b["trigger_glob"]);
  if (triggerGlob === "invalid") {
    return "trigger_glob must be a string";
  }
  const triggerCron = optionalString(b["trigger_cron"]);
  if (triggerCron === "invalid") {
    return "trigger_cron must be a string";
  }
  let enabled = true;
  if (b["enabled"] !== undefined) {
    if (typeof b["enabled"] !== "boolean") {
      return "enabled must be boolean";
    }
    enabled = b["enabled"];
  }
  return {
    name: b["name"],
    command: b["command"],
    runtime: "shell",
    docker_image: dockerImage,
    docker_platform: dockerPlatform,
    trigger_type: b["trigger_type"],
    trigger_glob: triggerGlob,
    trigger_cron: triggerCron,
    concurrency: b["concurrency"],
    enabled,
  };
}

function parseEnvVarsBody(raw: unknown): Record<string, string> | string {
  if (raw === undefined) {
    return {};
  }
  if (typeof raw !== "object" || raw === null) {
    return "vars must be object";
  }
  const out: Record<string, string> = {};
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key.length === 0) {
      return "env key cannot be empty";
    }
    const val = obj[key];
    if (typeof val !== "string") {
      return `env value for ${key} must be string`;
    }
    out[key] = val;
  }
  return out;
}

export async function registerScriptRunnerModule(
  app: FastifyInstance,
  options: ScriptRunnerOptions,
): Promise<void> {
  const logsDir = join(options.dataDir, "logs");
  mkdirSync(logsDir, { recursive: true });

  const db = new Database(options.databasePath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  ensureEventLogSchema(db);
  ensureReactionSchema(db);
  db.prepare("UPDATE script_scripts SET runtime = 'shell' WHERE runtime != 'shell'").run();

  const startedAtBoot = Date.now();

  type ProjectSettingsRow = {
    project_id: string;
    owner_id: string;
    paused: number;
    active_environment_id: string | null;
    created_at: number;
  };
  type EnvironmentRow = {
    id: string;
    project_id: string;
    name: string;
    vars_json: string;
    created_at: number;
  };
  type ScriptRow = {
    id: string;
    project_id: string;
    owner_id: string;
    name: string;
    command: string;
    runtime: string;
    docker_image: string;
    docker_platform: string;
    trigger_type: string;
    trigger_glob: string;
    trigger_cron: string;
    concurrency: string;
    enabled: number;
    created_at: number;
  };

  function toProjectSettings(row: ProjectSettingsRow): ProjectSettings {
    return {
      project_id: row.project_id,
      owner_id: row.owner_id,
      paused: row.paused === 1,
      active_environment_id: row.active_environment_id,
      created_at: row.created_at,
    };
  }

  function toEnvironment(row: EnvironmentRow): Environment {
    let vars: Record<string, string> = {};
    try {
      const parsed: unknown = JSON.parse(row.vars_json);
      if (typeof parsed === "object" && parsed !== null) {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof value === "string") {
            vars[key] = value;
          }
        }
      }
    } catch {
      vars = {};
    }
    return {
      id: row.id,
      project_id: row.project_id,
      name: row.name,
      vars,
      created_at: row.created_at,
    };
  }

  function toScript(row: ScriptRow): Script {
    return {
      id: row.id,
      project_id: row.project_id,
      name: row.name,
      command: row.command,
      runtime: isRuntime(row.runtime) ? row.runtime : "shell",
      docker_image: row.docker_image,
      docker_platform: row.docker_platform,
      trigger_type: isTrigger(row.trigger_type) ? row.trigger_type : "manual",
      trigger_glob: row.trigger_glob,
      trigger_cron: row.trigger_cron,
      concurrency: isConcurrency(row.concurrency) ? row.concurrency : "ignore",
      enabled: row.enabled === 1,
      created_at: row.created_at,
    };
  }

  function getOrCreateProjectSettings(projectId: string, ownerId: string): ProjectSettings {
    const row = db
      .prepare("SELECT * FROM script_project_settings WHERE project_id = ?")
      .get(projectId) as ProjectSettingsRow | undefined;
    if (row !== undefined) {
      return toProjectSettings(row);
    }
    db.prepare(
      "INSERT INTO script_project_settings (project_id, owner_id, paused, active_environment_id, created_at) VALUES (?, ?, 0, NULL, ?)",
    ).run(projectId, ownerId, Date.now());
    return {
      project_id: projectId,
      owner_id: ownerId,
      paused: false,
      active_environment_id: null,
      created_at: Date.now(),
    };
  }

  function getProjectSettings(projectId: string): ProjectSettings | null {
    const row = db
      .prepare("SELECT * FROM script_project_settings WHERE project_id = ?")
      .get(projectId) as ProjectSettingsRow | undefined;
    return row === undefined ? null : toProjectSettings(row);
  }

  // Every route entered through this checks real project ownership via task-bridge's
  // project registry, not just a locally-stored owner_id column.
  async function requireProjectAccess(
    projectId: string,
    user: IdentityUser,
  ): Promise<ProjectSettings | null> {
    if (!userCanAccessProject(projectId, user.id)) {
      return null;
    }
    return getOrCreateProjectSettings(projectId, user.id);
  }

  async function githubReactionContext(projectId: string): Promise<{
    connected: boolean;
    repos: string[];
  }> {
    const token = loadGithubToken(db);
    const connected = token.length > 0;
    const bridge = getProjectById(projectId);
    let repos: string[] = [];
    if (bridge !== null) {
      repos = await listGithubReposAt(bridge.repoPath);
    }
    return { connected, repos };
  }

  function getScript(id: string): Script | null {
    const row = db.prepare("SELECT * FROM script_scripts WHERE id = ?").get(id) as ScriptRow | undefined;
    return row === undefined ? null : toScript(row);
  }

  async function getOwnedScript(
    id: string,
    user: IdentityUser,
  ): Promise<{ script: Script; project: ProjectSettings } | null> {
    const script = getScript(id);
    if (script === null) {
      return null;
    }
    if (!userCanAccessProject(script.project_id, user.id)) {
      return null;
    }
    const project = getProjectSettings(script.project_id);
    if (project === null) {
      return null;
    }
    return { script, project };
  }

  function getExecution(id: string): Execution | null {
    const row = db.prepare("SELECT * FROM script_executions WHERE id = ?").get(id) as
      | Execution
      | undefined;
    return row === undefined ? null : { ...row, status: row.status };
  }

  function listEnvironments(projectId: string): Environment[] {
    const rows = db
      .prepare("SELECT * FROM script_environments WHERE project_id = ? ORDER BY created_at ASC")
      .all(projectId) as EnvironmentRow[];
    return rows.map(toEnvironment);
  }

  function listScripts(projectId: string): Script[] {
    const rows = db
      .prepare("SELECT * FROM script_scripts WHERE project_id = ? ORDER BY created_at ASC")
      .all(projectId) as ScriptRow[];
    return rows.map(toScript);
  }

  const sockets = new Map<string, Set<WebSocket>>();
  const running = new Map<
    string,
    { scriptId: string; ownerId: string; projectId: string; startedAt: number; cancel: () => void }
  >();
  const queued = new Set<string>();
  let clockTimer: ReturnType<typeof setInterval> | undefined;

  function broadcast(ownerId: string, msg: ServerMessage): void {
    const set = sockets.get(ownerId);
    if (set === undefined) {
      return;
    }
    const payload = JSON.stringify(msg);
    for (const socket of set) {
      if (socket.readyState === socket.OPEN) {
        socket.send(payload);
      }
    }
  }

  function runningSnapshotFor(
    ownerId: string,
    projectId?: string,
  ): { executionId: string; scriptId: string; startedAt: number }[] {
    const out: { executionId: string; scriptId: string; startedAt: number }[] = [];
    for (const [executionId, info] of running.entries()) {
      if (info.ownerId !== ownerId) {
        continue;
      }
      if (projectId !== undefined && info.projectId !== projectId) {
        continue;
      }
      out.push({ executionId, scriptId: info.scriptId, startedAt: info.startedAt });
    }
    return out;
  }

  function projectCwd(projectId: string): string {
    const bridge = getProjectById(projectId);
    if (bridge === null) {
      throw new Error("Project not found");
    }
    return requireExistingDirectory(bridge.repoPath);
  }

  function isScriptRunning(scriptId: string): boolean {
    for (const info of running.values()) {
      if (info.scriptId === scriptId) {
        return true;
      }
    }
    return false;
  }

  function cancelRunningForScript(scriptId: string): void {
    for (const info of running.values()) {
      if (info.scriptId === scriptId) {
        info.cancel();
      }
    }
  }

  function finalizeExecution(
    executionId: string,
    ownerId: string,
    status: ExecutionStatus,
    exitCode: number | null,
  ): void {
    const exec = getExecution(executionId);
    running.delete(executionId);
    if (exec === null || (exec.status !== "running" && exec.status !== "pending")) {
      return;
    }
    const endedAt = Date.now();
    db.prepare("UPDATE script_executions SET status = ?, ended_at = ?, exit_code = ? WHERE id = ?").run(
      status,
      endedAt,
      exitCode,
      executionId,
    );
    broadcast(ownerId, {
      kind: "execution.ended",
      executionId,
      status,
      exitCode,
      ts: endedAt,
    });
    const script = getScript(exec.script_id);
    if (script !== null && queued.delete(script.id)) {
      triggerScript(script, "queue:drain");
    }
  }

  function startExecution(script: Script, project: ProjectSettings, reason: string): void {
    const executionId = nanoid(12);
    const now = Date.now();
    const logPath = join(logsDir, `${executionId}.log`);
    db.prepare(
      "INSERT INTO script_executions (id, script_id, status, started_at, ended_at, exit_code, trigger_reason, log_path) VALUES (?, ?, 'running', ?, NULL, NULL, ?, ?)",
    ).run(executionId, script.id, now, reason, logPath);
    broadcast(project.owner_id, {
      kind: "execution.started",
      executionId,
      scriptId: script.id,
      ts: now,
    });

    const logFile = createWriteStream(logPath, { flags: "a", encoding: "utf8" });
    let cancelled = false;
    let exited = false;
    let child: ChildProcess | null = null;

    function write(line: string, stream: "out" | "err"): void {
      const clean = line.replace(/\r$/, "");
      logFile.write(`${stream}\t${clean}\n`);
      broadcast(project.owner_id, {
        kind: "execution.log",
        executionId,
        line: clean,
        stream,
        ts: Date.now(),
      });
    }

    function emitLines(buf: string, stream: "out" | "err"): string {
      let rest = buf;
      let idx = rest.indexOf("\n");
      while (idx !== -1) {
        write(rest.slice(0, idx), stream);
        rest = rest.slice(idx + 1);
        idx = rest.indexOf("\n");
      }
      return rest;
    }

    function finish(status: ExecutionStatus, exitCode: number | null): void {
      if (exited) {
        return;
      }
      exited = true;
      logFile.end();
      finalizeExecution(executionId, project.owner_id, status, exitCode);
    }

    running.set(executionId, {
      scriptId: script.id,
      ownerId: project.owner_id,
      projectId: script.project_id,
      startedAt: now,
      cancel(): void {
        if (cancelled || exited) {
          return;
        }
        cancelled = true;
        if (child === null) {
          finish("cancelled", null);
          return;
        }
        const pid = child.pid;
        if (pid === undefined) {
          finish("cancelled", null);
          return;
        }
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
          return;
        }
        child.kill("SIGTERM");
      },
    });

    function run(): void {
      try {
        const cwd = projectCwd(script.project_id);
        write(`[script] cwd=${cwd}`, "out");
        const spec = hostShellSpawn(process.platform, script.command);
        const childProc = spawn(spec.cmd, spec.args, {
          cwd,
          env: hostProcessEnv({}),
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        child = childProc;
        let outBuf = "";
        let errBuf = "";
        if (childProc.stdout !== null) {
          childProc.stdout.on("data", (chunk: Buffer) => {
            outBuf = emitLines(`${outBuf}${chunk.toString("utf8")}`, "out");
          });
        }
        if (childProc.stderr !== null) {
          childProc.stderr.on("data", (chunk: Buffer) => {
            errBuf = emitLines(`${errBuf}${chunk.toString("utf8")}`, "err");
          });
        }
        childProc.on("error", (err: Error) => {
          write(`[script] ${err.message}`, "err");
          finish(cancelled ? "cancelled" : "failed", null);
        });
        childProc.on("exit", (code: number | null) => {
          if (outBuf.length > 0) {
            write(outBuf, "out");
          }
          if (errBuf.length > 0) {
            write(errBuf, "err");
          }
          if (cancelled) {
            finish("cancelled", code);
            return;
          }
          if (code === 0) {
            finish("success", code);
            return;
          }
          finish("failed", code);
        });
      } catch (err) {
        if (!exited) {
          write(`[script] ${err instanceof Error ? err.message : String(err)}`, "err");
          finish(cancelled ? "cancelled" : "failed", null);
        }
      }
    }

    run();
  }

  function triggerScript(script: Script, reason: string): void {
    if (!script.enabled) {
      return;
    }
    const project = getProjectSettings(script.project_id);
    if (project === null || project.paused) {
      return;
    }
    if (isScriptRunning(script.id)) {
      if (script.concurrency === "parallel") {
        startExecution(script, project, reason);
        return;
      }
      if (script.concurrency === "restart") {
        cancelRunningForScript(script.id);
        queued.add(script.id);
        return;
      }
      if (script.concurrency === "queue") {
        queued.add(script.id);
        return;
      }
      return;
    }
    startExecution(script, project, reason);
  }

  function listenerScript(script: Script): EventListenerScript {
    return {
      id: script.id,
      projectId: script.project_id,
      triggerType: script.trigger_type,
      triggerGlob: script.trigger_glob,
      enabled: script.enabled,
    };
  }

  function emitLotaruEvent(
    partial: {
      type: string;
      projectId: string;
      scriptId: string;
      path: string;
      detail: string;
    },
    emitKind: "live" | "replay",
    flags: { skipAgents: boolean } = { skipAgents: false },
  ): LotaruEvent {
    const event: LotaruEvent = {
      id: nanoid(12),
      type: partial.type,
      projectId: partial.projectId,
      scriptId: partial.scriptId,
      path: partial.path,
      detail: partial.detail,
      createdAt: Date.now(),
    };
    recordEvent(db, event);
    const reason = eventRunReason(event);
    const reactions = listReactions(db, event.projectId);
    let skipClaim = false;
    if (emitKind === "replay") {
      skipClaim = true;
    }
    for (const reaction of reactions) {
      if (!reactionMatchesEvent(reaction, event)) {
        continue;
      }
      const fingerprint = reactionFireFingerprint(reaction, event);
      if (skipClaim !== true) {
        if (!claimReactionFire(db, fingerprint, reaction.id)) {
          continue;
        }
      }
      try {
        if (reaction.action === REACTION_CREATE_TASK) {
          createIntentTask(event, reaction);
        }
      } catch (err) {
        if (skipClaim !== true) {
          releaseReactionFire(db, fingerprint);
        }
        app.log.error({ err, type: event.type }, "reaction failed");
      }
    }
    void fireKnowledgeTemplatesForEvent({
      databasePath: options.databasePath,
      projectId: event.projectId,
      eventId: event.id,
      eventType: event.type,
      path: event.path,
      detail: event.detail,
    }).catch((err) => {
      app.log.error({ err, type: event.type }, "knowledge template fire failed");
    });
    if (flags.skipAgents !== true) {
      void fireAgentsForEvent({
        databasePath: options.databasePath,
        projectId: event.projectId,
        eventId: event.id,
        eventType: event.type,
        path: event.path,
        detail: event.detail,
        emitEvent: (nested) => emitLotaruEvent(nested, "live", { skipAgents: true }),
      }).catch((err) => {
        app.log.error({ err, type: event.type }, "agent fire failed");
      });
    }
    if (event.scriptId.length > 0) {
      const targeted = getScript(event.scriptId);
      if (targeted === null) {
        return event;
      }
      if (scriptListensToEvent(listenerScript(targeted), event)) {
        triggerScript(targeted, reason);
      }
      return event;
    }
    const scripts = listScripts(event.projectId);
    for (const script of scripts) {
      if (scriptListensToEvent(listenerScript(script), event)) {
        triggerScript(script, reason);
      }
    }
    return event;
  }

  setLotaruEventPublisher(emitLotaruEvent);

  function projectIdForGithubRepo(repo: string): string {
    const row = db
      .prepare("SELECT project_id FROM lotaru_reactions WHERE repo = ? AND enabled = 1 LIMIT 1")
      .get(repo) as { project_id: string } | undefined;
    if (row === undefined) {
      return "";
    }
    return row.project_id;
  }

  async function loadGithubWatches(): Promise<GithubWatch[]> {
    const fromReactions: GithubWatch[] = [];
    for (const repo of listEnabledGithubRepos(db)) {
      fromReactions.push({ repo, projectId: projectIdForGithubRepo(repo) });
    }
    const fromRemotes: GithubWatch[] = [];
    for (const project of refreshProjectRegistry()) {
      const remotes = await listGithubReposAt(project.repoPath);
      for (const repo of remotes) {
        fromRemotes.push({ repo, projectId: project.id });
      }
    }
    return mergeGithubWatches(fromReactions, fromRemotes);
  }

  function emitGithubPoll(payload: { type: string; projectId: string; path: string; detail: string }): void {
    emitLotaruEvent({
      type: payload.type,
      projectId: payload.projectId,
      scriptId: "",
      path: payload.path,
      detail: payload.detail,
    }, "live");
  }

  const fileWatchers = createFileWatchers((watched) => {
    const project = getProjectById(watched.projectId);
    if (project === null) {
      return;
    }
    const rel = relativeWatchPath(project.repoPath, watched.path);
    emitLotaruEvent({
      type: EVENT_FILE_CHANGED,
      projectId: watched.projectId,
      scriptId: "",
      path: rel,
      detail: watched.kind,
    }, "live");
  });

  function refreshFileWatches(): void {
    const projects = refreshProjectRegistry();
    const targets: { projectId: string; rootPath: string }[] = [];
    for (const project of projects) {
      if (project.repoPath.length === 0) {
        continue;
      }
      if (!existsSync(project.repoPath)) {
        continue;
      }
      targets.push({ projectId: project.id, rootPath: project.repoPath });
    }
    fileWatchers.sync(targets);
  }

  function tickClock(): void {
    const projects = refreshProjectRegistry();
    for (const project of projects) {
      emitLotaruEvent({
        type: EVENT_CLOCK_TICK,
        projectId: project.id,
        scriptId: "",
        path: "",
        detail: "",
      }, "live");
    }
  }

  db.prepare(
    "UPDATE script_executions SET status = 'cancelled', ended_at = ? WHERE status IN ('running', 'pending')",
  ).run(Date.now());
  {
    tickClock();
    clockTimer = setInterval(tickClock, CLOCK_TICK_MS);
    const projects = refreshProjectRegistry();
    for (const project of projects) {
      emitLotaruEvent({
        type: EVENT_APP_STARTED,
        projectId: project.id,
        scriptId: "",
        path: "",
        detail: "boot",
      }, "live");
    }
    refreshFileWatches();
  }

  async function requireUser(
    request: FastifyRequest,
  ): Promise<IdentityUser | null> {
    return options.identity.userFrom(request);
  }

  app.get("/v1/agent/status", async (request, reply) => {
    const user = await requireUser(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return {
      online: true,
      info: { hostname: "fookie-cloud", version: "1.0.0", connectedAt: startedAtBoot },
    };
  });

  app.get("/api/v1/stream", { websocket: true }, (socket, request) => {
    void (async () => {
      const user = await requireUser(request);
      if (user === null) {
        socket.close(4401, "unauthorized");
        return;
      }
      let set = sockets.get(user.id);
      if (set === undefined) {
        set = new Set();
        sockets.set(user.id, set);
      }
      set.add(socket);
      socket.send(
        JSON.stringify({ kind: "hello", ts: Date.now(), running: runningSnapshotFor(user.id) }),
      );
      socket.on("close", () => {
        const current = sockets.get(user.id);
        if (current !== undefined) {
          current.delete(socket);
          if (current.size === 0) {
            sockets.delete(user.id);
          }
        }
      });
    })();
  });

  // Single project-scoped snapshot route: settings + environments + scripts + recent
  // executions for every script in the project, in one round trip. Replaces the old
  // workspace-fetch -> per-script-execution-fetch waterfall.
  app.get<{ Params: { projectId: string }; Querystring: { limit?: string } }>(
    "/api/v1/projects/:projectId/script-snapshot",
    async (request, reply) => {
      const user = await requireUser(request);
      if (user === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const project = await requireProjectAccess(request.params.projectId, user);
      if (project === null) {
        return reply.code(404).send({ error: "not found" });
      }
      // Per-script recent history, not a single project-wide LIMIT — otherwise a
      // chatty script would crowd quieter scripts out of the initial snapshot.
      let perScriptLimit = 20;
      if (typeof request.query.limit === "string") {
        const n = Number.parseInt(request.query.limit, 10);
        if (Number.isFinite(n) && n > 0 && n <= 200) {
          perScriptLimit = n;
        }
      }
      const scripts = listScripts(project.project_id);
      const executions =
        scripts.length === 0
          ? []
          : (db
              .prepare(
                `SELECT id, script_id, status, started_at, ended_at, exit_code, trigger_reason, log_path
                 FROM (
                   SELECT e.*, ROW_NUMBER() OVER (
                     PARTITION BY e.script_id ORDER BY e.started_at DESC
                   ) AS rn
                   FROM script_executions e
                   JOIN script_scripts t ON t.id = e.script_id
                   WHERE t.project_id = ?
                 )
                 WHERE rn <= ?
                 ORDER BY started_at DESC`,
              )
              .all(project.project_id, perScriptLimit) as Execution[]);
      return {
        settings: project,
        environments: listEnvironments(project.project_id),
        scripts,
        executions,
        running: runningSnapshotFor(user.id, project.project_id),
      };
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: { limit?: string; cursor?: string; type?: string } }>(
    "/api/v1/projects/:projectId/events",
    async (request, reply) => {
      const user = await requireUser(request);
      if (user === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const project = await requireProjectAccess(request.params.projectId, user);
      if (project === null) {
        return reply.code(404).send({ error: "not found" });
      }
      let limit = 40;
      if (typeof request.query.limit === "string") {
        const n = Number.parseInt(request.query.limit, 10);
        if (Number.isFinite(n) && n > 0 && n <= 200) {
          limit = n;
        }
      }
      let type = "";
      if (typeof request.query.type === "string") {
        type = canonicalBusEventType(request.query.type.trim());
      }
      if (type.length > 0 && isBusEventType(type) !== true) {
        return reply.code(400).send({ error: "Unknown event type" });
      }
      let cursor = "";
      if (typeof request.query.cursor === "string") {
        cursor = request.query.cursor.trim();
      }
      let stored;
      try {
        stored = listProjectEvents(db, {
          projectId: project.project_id,
          limit,
          type,
          cursor,
        });
      } catch (failure) {
        if (failure instanceof Error && failure.message === "Invalid event cursor") {
          return reply.code(400).send({ error: "Invalid event cursor" });
        }
        throw failure;
      }
      const reactions = listReactions(db, project.project_id);
      const scripts: NamedEventScript[] = [];
      for (const script of listScripts(project.project_id)) {
        const listen = listenerScript(script);
        scripts.push({
          id: listen.id,
          projectId: listen.projectId,
          triggerType: listen.triggerType,
          triggerGlob: listen.triggerGlob,
          enabled: listen.enabled,
          name: script.name,
        });
      }
      const events = [];
      for (const event of stored.events) {
        events.push({
          id: event.id,
          type: event.type,
          projectId: event.projectId,
          scriptId: event.scriptId,
          path: event.path,
          detail: event.detail,
          createdAt: event.createdAt,
          replayable: replayPayloadsFromStored(event).length > 0,
          listeners: eventListenerRefs(event, reactions, scripts),
        });
      }
      return { events, next: stored.next };
    },
  );

  app.post<{ Params: { projectId: string; eventId: string } }>(
    "/api/v1/projects/:projectId/events/:eventId/replay",
    async (request, reply) => {
      const user = await requireUser(request);
      if (user === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const project = await requireProjectAccess(request.params.projectId, user);
      if (project === null) {
        return reply.code(404).send({ error: "not found" });
      }
      const stored = eventsById(db, project.project_id, request.params.eventId);
      if (stored.length === 0) {
        return reply.code(404).send({ error: "not found" });
      }
      let replayed = 0;
      for (const storedEvent of stored) {
        const payloads = replayPayloadsFromStored(storedEvent);
        for (const payload of payloads) {
          emitLotaruEvent(payload, "replay");
          replayed += 1;
        }
      }
      if (replayed === 0) {
        return reply.code(400).send({ error: "event cannot be replayed" });
      }
      return { ok: true };
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/export",
    async (request, reply) => {
      const user = await requireUser(request);
      if (user === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const project = await requireProjectAccess(request.params.projectId, user);
      if (project === null) {
        return reply.code(404).send({ error: "not found" });
      }
      const environments = listEnvironments(project.project_id);
      let activeEnvironmentName: string | null = null;
      for (const env of environments) {
        if (env.id === project.active_environment_id) {
          activeEnvironmentName = env.name;
        }
      }
      const bridge = getProjectById(project.project_id);
      let exportPath = "";
      if (bridge !== null) {
        exportPath = bridge.repoPath;
      }
      return {
        format: "script-project",
        version: 1,
        exported_at: Date.now(),
        project: {
          name: project.project_id,
          path: exportPath,
          paused: project.paused,
          active_environment_name: activeEnvironmentName,
        },
        environments: environments.map((env) => ({ name: env.name, vars: env.vars })),
        scripts: listScripts(project.project_id).map((script) => ({
          name: script.name,
          command: script.command,
          runtime: script.runtime,
          docker_image: script.docker_image,
          docker_platform: script.docker_platform,
          trigger_type: script.trigger_type,
          trigger_glob: script.trigger_glob,
          trigger_cron: script.trigger_cron,
          concurrency: script.concurrency,
          enabled: script.enabled,
        })),
      };
    },
  );

  app.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/pause",
    async (request, reply) => {
      const user = await requireUser(request);
      if (user === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const project = await requireProjectAccess(request.params.projectId, user);
      if (project === null) {
        return reply.code(404).send({ error: "not found" });
      }
      db.prepare("UPDATE script_project_settings SET paused = 1 WHERE project_id = ?").run(
        project.project_id,
      );
      broadcast(user.id, { kind: "project.updated", projectId: project.project_id });
      return { settings: { ...project, paused: true } };
    },
  );

  app.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/resume",
    async (request, reply) => {
      const user = await requireUser(request);
      if (user === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const project = await requireProjectAccess(request.params.projectId, user);
      if (project === null) {
        return reply.code(404).send({ error: "not found" });
      }
      db.prepare("UPDATE script_project_settings SET paused = 0 WHERE project_id = ?").run(
        project.project_id,
      );
      broadcast(user.id, { kind: "project.updated", projectId: project.project_id });
      return { settings: { ...project, paused: false } };
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/environments",
    async (request, reply) => {
      const user = await requireUser(request);
      if (user === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const project = await requireProjectAccess(request.params.projectId, user);
      if (project === null) {
        return reply.code(404).send({ error: "not found" });
      }
      return { environments: listEnvironments(project.project_id) };
    },
  );

  app.post<{ Params: { projectId: string }; Body: { name?: unknown; vars?: unknown } }>(
    "/api/v1/projects/:projectId/environments",
    async (request, reply) => {
      const user = await requireUser(request);
      if (user === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const project = await requireProjectAccess(request.params.projectId, user);
      if (project === null) {
        return reply.code(404).send({ error: "not found" });
      }
      const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
      if (name.length === 0) {
        return reply.code(400).send({ error: "name required" });
      }
      const vars = parseEnvVarsBody(request.body?.vars);
      if (typeof vars === "string") {
        return reply.code(400).send({ error: vars });
      }
      const id = nanoid(12);
      try {
        db.prepare(
          "INSERT INTO script_environments (id, project_id, name, vars_json, created_at) VALUES (?, ?, ?, ?, ?)",
        ).run(id, project.project_id, name, JSON.stringify(vars), Date.now());
      } catch {
        return reply.code(409).send({ error: "environment name already exists" });
      }
      return {
        environment: { id, project_id: project.project_id, name, vars, created_at: Date.now() },
      };
    },
  );

  app.patch<{ Params: { id: string }; Body: { name?: unknown; vars?: unknown } }>(
    "/api/v1/environments/:id",
    async (request, reply) => {
      const user = await requireUser(request);
      if (user === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const row = db.prepare("SELECT * FROM script_environments WHERE id = ?").get(request.params.id) as
        | EnvironmentRow
        | undefined;
      if (row === undefined || !userCanAccessProject(row.project_id, user.id)) {
        return reply.code(404).send({ error: "not found" });
      }
      const existing = toEnvironment(row);
      let nextName = existing.name;
      if (request.body?.name !== undefined) {
        if (typeof request.body.name !== "string" || request.body.name.length === 0) {
          return reply.code(400).send({ error: "name required" });
        }
        nextName = request.body.name;
      }
      let nextVars = existing.vars;
      if (request.body?.vars !== undefined) {
        const vars = parseEnvVarsBody(request.body.vars);
        if (typeof vars === "string") {
          return reply.code(400).send({ error: vars });
        }
        nextVars = vars;
      }
      try {
        db.prepare("UPDATE script_environments SET name = ?, vars_json = ? WHERE id = ?").run(
          nextName,
          JSON.stringify(nextVars),
          existing.id,
        );
      } catch {
        return reply.code(409).send({ error: "environment name already exists" });
      }
      return { environment: { ...existing, name: nextName, vars: nextVars } };
    },
  );

  app.delete<{ Params: { id: string } }>("/api/v1/environments/:id", async (request, reply) => {
    const user = await requireUser(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const row = db.prepare("SELECT * FROM script_environments WHERE id = ?").get(request.params.id) as
      | EnvironmentRow
      | undefined;
    if (row === undefined || !userCanAccessProject(row.project_id, user.id)) {
      return reply.code(404).send({ error: "not found" });
    }
    const project = getProjectSettings(row.project_id);
    if (project !== null && project.active_environment_id === row.id) {
      db.prepare("UPDATE script_project_settings SET active_environment_id = NULL WHERE project_id = ?").run(
        project.project_id,
      );
      broadcast(user.id, { kind: "project.updated", projectId: row.project_id });
    }
    db.prepare("DELETE FROM script_environments WHERE id = ?").run(row.id);
    return { ok: true };
  });

  app.patch<{ Params: { projectId: string }; Body: { environment_id?: unknown } }>(
    "/api/v1/projects/:projectId/active-environment",
    async (request, reply) => {
      const user = await requireUser(request);
      if (user === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const project = await requireProjectAccess(request.params.projectId, user);
      if (project === null) {
        return reply.code(404).send({ error: "not found" });
      }
      let environmentId: string | null = null;
      const rawId = request.body?.environment_id;
      if (rawId !== undefined && rawId !== null) {
        if (typeof rawId !== "string") {
          return reply.code(400).send({ error: "environment_id must be string or null" });
        }
        const row = db.prepare("SELECT * FROM script_environments WHERE id = ?").get(rawId) as
          | EnvironmentRow
          | undefined;
        if (row === undefined || row.project_id !== project.project_id) {
          return reply.code(404).send({ error: "environment not found" });
        }
        environmentId = row.id;
      }
      db.prepare("UPDATE script_project_settings SET active_environment_id = ? WHERE project_id = ?").run(
        environmentId,
        project.project_id,
      );
      broadcast(user.id, { kind: "project.updated", projectId: project.project_id });
      return { settings: { ...project, active_environment_id: environmentId } };
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/scripts",
    async (request, reply) => {
      const user = await requireUser(request);
      if (user === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const project = await requireProjectAccess(request.params.projectId, user);
      if (project === null) {
        return reply.code(404).send({ error: "not found" });
      }
      return { scripts: listScripts(project.project_id), nextCursor: null };
    },
  );

  app.post<{ Params: { projectId: string }; Body: unknown }>(
    "/api/v1/projects/:projectId/scripts",
    async (request, reply) => {
      const user = await requireUser(request);
      if (user === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const project = await requireProjectAccess(request.params.projectId, user);
      if (project === null) {
        return reply.code(404).send({ error: "not found" });
      }
      const parsed = validateCreateScript(request.body);
      if (typeof parsed === "string") {
        return reply.code(400).send({ error: parsed });
      }
      const id = nanoid(12);
      db.prepare(
        "INSERT INTO script_scripts (id, project_id, owner_id, name, command, runtime, docker_image, docker_platform, trigger_type, trigger_glob, trigger_cron, concurrency, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        id,
        project.project_id,
        user.id,
        parsed.name,
        parsed.command,
        parsed.runtime,
        parsed.docker_image,
        parsed.docker_platform,
        parsed.trigger_type,
        parsed.trigger_glob,
        parsed.trigger_cron,
        parsed.concurrency,
        parsed.enabled ? 1 : 0,
        Date.now(),
      );
      const script = getScript(id);
      if (script !== null) {
        refreshFileWatches();
      }
      broadcast(user.id, { kind: "script.updated", scriptId: id });
      return { script };
    },
  );

  app.get<{ Params: { id: string } }>("/api/v1/scripts/:id", async (request, reply) => {
    const user = await requireUser(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const owned = await getOwnedScript(request.params.id, user);
    if (owned === null) {
      return reply.code(404).send({ error: "not found" });
    }
    return { script: owned.script };
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/api/v1/scripts/:id",
    async (request, reply) => {
      const user = await requireUser(request);
      if (user === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const owned = await getOwnedScript(request.params.id, user);
      if (owned === null) {
        return reply.code(404).send({ error: "not found" });
      }
      const parsed = validateCreateScript(request.body);
      if (typeof parsed === "string") {
        return reply.code(400).send({ error: parsed });
      }
      db.prepare(
        "UPDATE script_scripts SET name = ?, command = ?, runtime = ?, docker_image = ?, docker_platform = ?, trigger_type = ?, trigger_glob = ?, trigger_cron = ?, concurrency = ?, enabled = ? WHERE id = ?",
      ).run(
        parsed.name,
        parsed.command,
        parsed.runtime,
        parsed.docker_image,
        parsed.docker_platform,
        parsed.trigger_type,
        parsed.trigger_glob,
        parsed.trigger_cron,
        parsed.concurrency,
        parsed.enabled ? 1 : 0,
        owned.script.id,
      );
      const script = getScript(owned.script.id);
      refreshFileWatches();
      broadcast(user.id, { kind: "script.updated", scriptId: owned.script.id });
      return { script };
    },
  );

  app.delete<{ Params: { id: string } }>("/api/v1/scripts/:id", async (request, reply) => {
    const user = await requireUser(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const owned = await getOwnedScript(request.params.id, user);
    if (owned === null) {
      return reply.code(404).send({ error: "not found" });
    }
    cancelRunningForScript(owned.script.id);
    queued.delete(owned.script.id);
    db.prepare("DELETE FROM script_scripts WHERE id = ?").run(owned.script.id);
    refreshFileWatches();
    broadcast(user.id, { kind: "script.deleted", scriptId: owned.script.id });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/v1/scripts/:id/run", async (request, reply) => {
    const user = await requireUser(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const owned = await getOwnedScript(request.params.id, user);
    if (owned === null) {
      return reply.code(404).send({ error: "not found" });
    }
    if (isScriptRunning(owned.script.id)) {
      return reply.code(409).send({ error: "script already running" });
    }
    triggerScript(owned.script, "run");
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/v1/executions/:id/cancel", async (request, reply) => {
    const user = await requireUser(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const info = running.get(request.params.id);
    if (info !== undefined) {
      if (info.ownerId !== user.id) {
        return reply.code(404).send({ error: "execution not found" });
      }
      info.cancel();
      return { ok: true };
    }
    const exec = getExecution(request.params.id);
    if (exec === null) {
      return reply.code(404).send({ error: "execution not found" });
    }
    const owned = await getOwnedScript(exec.script_id, user);
    if (owned === null) {
      return reply.code(404).send({ error: "execution not found" });
    }
    if (exec.status === "running" || exec.status === "pending") {
      finalizeExecution(exec.id, user.id, "cancelled", null);
    }
    return { ok: true };
  });

  app.get("/api/v1/executions/running", async (request, reply) => {
    const user = await requireUser(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return { running: runningSnapshotFor(user.id) };
  });

  app.get<{ Querystring: { scriptId?: string; limit?: string } }>(
    "/api/v1/executions",
    async (request, reply) => {
      const user = await requireUser(request);
      if (user === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      let limit = 50;
      if (typeof request.query.limit === "string") {
        const n = Number.parseInt(request.query.limit, 10);
        if (Number.isFinite(n) && n > 0 && n <= 500) {
          limit = n;
        }
      }
      if (typeof request.query.scriptId !== "string" || request.query.scriptId.length === 0) {
        return reply.code(400).send({ error: "scriptId required" });
      }
      const owned = await getOwnedScript(request.query.scriptId, user);
      if (owned === null) {
        return reply.code(404).send({ error: "not found" });
      }
      const rows = db
        .prepare("SELECT * FROM script_executions WHERE script_id = ? ORDER BY started_at DESC LIMIT ?")
        .all(owned.script.id, limit) as Execution[];
      return { executions: rows };
    },
  );

  app.get<{ Params: { id: string } }>("/api/v1/executions/:id/log", async (request, reply) => {
    const user = await requireUser(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const exec = getExecution(request.params.id);
    if (exec === null) {
      return reply.code(404).send({ error: "not found" });
    }
    const owned = await getOwnedScript(exec.script_id, user);
    if (owned === null) {
      return reply.code(404).send({ error: "not found" });
    }
    if (!existsSync(exec.log_path)) {
      return { log: "" };
    }
    return { log: readFileSync(exec.log_path, "utf8") };
  });

  app.get<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/reactions",
    async (request, reply) => {
      const user = await requireUser(request);
      if (user === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const project = await requireProjectAccess(request.params.projectId, user);
      if (project === null) {
        return reply.code(404).send({ error: "not found" });
      }
      const ctx = await githubReactionContext(project.project_id);
      const githubReady = ctx.connected === true && ctx.repos.length > 0;
      return {
        reactions: listReactions(db, project.project_id),
        eventTypes: reactionEventTypesForClient(githubReady),
        githubConnected: ctx.connected,
        githubRepos: ctx.repos,
      };
    },
  );

  app.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/reactions",
    async (request, reply) => {
      const user = await requireUser(request);
      if (user === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const project = await requireProjectAccess(request.params.projectId, user);
      if (project === null) {
        return reply.code(404).send({ error: "not found" });
      }
      try {
        const parsed = parseReactionInput(request.body);
        let repo = parsed.repo;
        if (parsed.eventType.startsWith("github.")) {
          const ctx = await githubReactionContext(project.project_id);
          if (ctx.connected !== true) {
            return reply.code(400).send({ error: "Connect GitHub in Settings first" });
          }
          if (repo.length === 0 && ctx.repos.length === 1) {
            const only = ctx.repos[0];
            if (only !== undefined) {
              repo = only;
            }
          }
          let allowed = false;
          for (const remote of ctx.repos) {
            if (remote === repo) {
              allowed = true;
            }
          }
          if (allowed !== true) {
            return reply.code(400).send({ error: "This project has no matching GitHub remote" });
          }
        }
        const input = Object.assign({}, parsed, { repo });
        const reaction = insertReaction(db, project.project_id, input);
        refreshFileWatches();
        if (input.eventType.startsWith("github.")) {
          void loadGithubWatches()
            .then((watches) => pollGithubOnce(db, watches, emitGithubPoll))
            .catch(() => {
              return;
            });
        }
        return reply.code(201).send({ reaction });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Invalid reaction";
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.delete<{ Params: { projectId: string; id: string } }>(
    "/api/v1/projects/:projectId/reactions/:id",
    async (request, reply) => {
      const user = await requireUser(request);
      if (user === null) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const project = await requireProjectAccess(request.params.projectId, user);
      if (project === null) {
        return reply.code(404).send({ error: "not found" });
      }
      if (!deleteReaction(db, project.project_id, request.params.id)) {
        return reply.code(404).send({ error: "not found" });
      }
      refreshFileWatches();
      return { ok: true };
    },
  );

  startGithubPoller(db, loadGithubWatches, emitGithubPoll);

  app.addHook("onClose", async () => {
    if (clockTimer !== undefined) {
      clearInterval(clockTimer);
    }
    for (const info of running.values()) {
      info.cancel();
    }
    db.close();
  });
}
