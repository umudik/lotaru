import { nanoid } from 'nanoid';
import { join } from 'node:path';
import { initialState, step } from './concurrency/policy.js';
import { defaultShellImage, shellRunsOnHost } from './executor/config.js';
import { buildExecEnv, envKeySummary } from './executor/env.js';
import { resolveTaskPlatform } from './executor/platform.js';
import { runShell } from './executor/shell.js';
import { runDocker } from './executor/docker.js';
import { matchesGlob } from './watcher/index.js';
import type { SlotState, Command } from './concurrency/policy.js';
import type { ExecutionHandle } from './executor/shell.js';
import type { Store } from './db/index.js';
import type { EventBus } from './events/bus.js';
import type { WatcherManager, WatchEvent } from './watcher/index.js';
import type { SchedulerManager } from './scheduler/index.js';
import type { Task, Workspace, TriggerReason, Execution } from './types.js';

export interface Orchestrator {
  loadAll(): void;
  onTaskCreated(task: Task): void;
  onTaskUpdated(task: Task): void;
  onTaskDeleted(taskId: string): void;
  onWorkspaceCreated(workspace: Workspace): void;
  onWorkspaceDeleted(workspaceId: string): void;
  onWorkspacePausedChanged(workspace: Workspace): void;
  onWorkspaceUpdated(workspace: Workspace): void;
  triggerManual(taskId: string): void;
  cancelExecution(executionId: string): void;
  handleWatchEvent(e: WatchEvent): void;
  shutdown(): Promise<void>;
}

interface RunningInfo {
  taskId: string;
  handle: ExecutionHandle;
}

export function createOrchestrator(
  store: Store,
  bus: EventBus,
  watchers: WatcherManager,
  scheduler: SchedulerManager,
  logsDir: string,
): Orchestrator {
  const slots = new Map<string, SlotState>();
  const running = new Map<string, RunningInfo>();

  function getSlot(task: Task): SlotState {
    const s = slots.get(task.id);
    if (s !== undefined) {
      return s;
    }
    const init = initialState(task.concurrency);
    slots.set(task.id, init);
    return init;
  }

  function applyCommands(task: Task, commands: readonly Command[], reason: TriggerReason): void {
    for (const cmd of commands) {
      if (cmd.kind === 'start') {
        startExecution(task, cmd.reason);
      } else if (cmd.kind === 'cancel') {
        const info = running.get(cmd.executionId);
        if (info !== undefined) {
          info.handle.cancel();
        }
      } else {
        bus.emit({
          kind: 'execution.log',
          executionId: `drop-${nanoid(6)}`,
          line: `[lotaru] trigger dropped (${task.concurrency}): ${reason.detail}`,
          stream: 'out',
          ts: Date.now(),
        });
      }
    }
  }

  function startExecution(task: Task, reason: TriggerReason): void {
    const workspace = store.getWorkspace(task.workspace_id);
    if (workspace === null) {
      return;
    }
    const execId = nanoid(12);
    const now = Date.now();
    const logPath = join(logsDir, `${execId}.log`);

    const exec: Execution = {
      id: execId,
      task_id: task.id,
      status: 'running',
      started_at: now,
      ended_at: null,
      exit_code: null,
      trigger_reason: `${reason.source}:${reason.detail}`,
      log_path: logPath,
    };
    store.insertExecution(exec);

    bus.emit({ kind: 'execution.started', executionId: execId, taskId: task.id, ts: now });

    const onLine = (line: string, stream: 'out' | 'err'): void => {
      bus.emit({
        kind: 'execution.log',
        executionId: execId,
        line,
        stream,
        ts: Date.now(),
      });
    };

    const onExit = (exitCode: number | null, cancelled: boolean): void => {
      const endedAt = Date.now();
      let status: Execution['status'] = 'success';
      if (cancelled) {
        status = 'cancelled';
      } else if (exitCode === null || exitCode !== 0) {
        status = 'failed';
      }
      const updated: Execution = {
        ...exec,
        status,
        ended_at: endedAt,
        exit_code: exitCode,
      };
      store.updateExecution(updated);
      running.delete(execId);
      bus.emit({
        kind: 'execution.ended',
        executionId: execId,
        status,
        exitCode,
        ts: endedAt,
      });
      const currentTask = store.getTask(task.id);
      if (currentTask === null) {
        return;
      }
      const slot = getSlot(currentTask);
      const result = step(currentTask.concurrency, slot, { kind: 'ended', executionId: execId });
      slots.set(currentTask.id, result.state);
      applyCommands(currentTask, result.commands, reason);
    };

    const platform = resolveTaskPlatform(task.docker_platform);

    const customEnv = store.resolveActiveEnvVars(task.workspace_id);
    const envSummary = envKeySummary(customEnv);
    if (envSummary.length > 0) {
      onLine(`[lotaru] env keys=${envSummary}`, 'out');
    }

    let isolated = false;
    if (task.runtime === 'docker') {
      isolated = true;
    } else if (!shellRunsOnHost()) {
      isolated = true;
    }
    const execEnv = buildExecEnv(customEnv, isolated);

    let handle: ExecutionHandle;
    if (task.runtime === 'docker') {
      const image = task.docker_image;
      if (image === null || image === '') {
        onLine('[lotaru] docker_image missing', 'err');
        onExit(null, false);
        return;
      }
      let platformNote = '';
      if (platform !== null) {
        platformNote = ` platform=${platform}`;
      }
      onLine(`[lotaru] docker image=${image}${platformNote}`, 'out');
      handle = runDocker({
        command: task.command,
        cwd: workspace.path,
        logPath,
        env: execEnv,
        image,
        platform,
        onLine,
        onExit,
      });
    } else if (shellRunsOnHost()) {
      onLine(`[lotaru] shell on host cwd=${workspace.path}`, 'out');
      handle = runShell({
        command: task.command,
        cwd: workspace.path,
        logPath,
        env: execEnv,
        onLine,
        onExit,
      });
    } else {
      const image = defaultShellImage();
      let platformNote = '';
      if (platform !== null) {
        platformNote = ` platform=${platform}`;
      }
      onLine(`[lotaru] isolated shell image=${image} mount=/workspace${platformNote}`, 'out');
      handle = runDocker({
        command: task.command,
        cwd: workspace.path,
        logPath,
        env: execEnv,
        image,
        platform,
        onLine,
        onExit,
      });
    }

    running.set(execId, { taskId: task.id, handle });

    const slot = getSlot(task);
    const result = step(task.concurrency, slot, { kind: 'started', executionId: execId });
    slots.set(task.id, result.state);
  }

  function trigger(task: Task, reason: TriggerReason): void {
    if (!task.enabled) {
      return;
    }
    const workspace = store.getWorkspace(task.workspace_id);
    if (workspace === null || workspace.paused) {
      return;
    }
    const slot = getSlot(task);
    const result = step(task.concurrency, slot, { kind: 'trigger', reason });
    slots.set(task.id, result.state);
    applyCommands(task, result.commands, reason);
  }

  function bindScheduled(task: Task): void {
    if (task.trigger_type !== 'scheduled') {
      return;
    }
    const expr = task.trigger_cron;
    if (expr === null || expr === '') {
      return;
    }
    scheduler.schedule(task.id, expr, () => {
      const fresh = store.getTask(task.id);
      if (fresh === null) {
        return;
      }
      trigger(fresh, { source: 'scheduled', detail: expr });
    });
  }

  function onWatchEvent(e: WatchEvent): void {
    const tasks = store.listTasks(e.workspaceId);
    const workspace = store.getWorkspace(e.workspaceId);
    if (workspace === null) {
      return;
    }
    for (const task of tasks) {
      if (task.trigger_type !== 'save' || !task.enabled) {
        continue;
      }
      if (!matchesGlob(e.path, workspace.path, task.trigger_glob)) {
        continue;
      }
      trigger(task, { source: 'save', detail: e.path });
    }
  }

  return {
    loadAll(): void {
      const workspaces = store.listWorkspaces();
      for (const w of workspaces) {
        if (!w.paused) {
          watchers.watch(w.id, w.path);
        }
      }
      const tasks = store.listAllEnabledTasks();
      for (const t of tasks) {
        bindScheduled(t);
        if (t.trigger_type === 'startup') {
          trigger(t, { source: 'startup', detail: 'boot' });
        }
      }
    },

    onTaskCreated(task: Task): void {
      slots.set(task.id, initialState(task.concurrency));
      bindScheduled(task);
      if (task.trigger_type === 'startup' && task.enabled) {
        trigger(task, { source: 'startup', detail: 'created' });
      }
    },

    onTaskUpdated(task: Task): void {
      scheduler.unschedule(task.id);
      slots.set(task.id, initialState(task.concurrency));
      if (task.enabled) {
        bindScheduled(task);
      }
    },

    onTaskDeleted(taskId: string): void {
      scheduler.unschedule(taskId);
      slots.delete(taskId);
      for (const [execId, info] of running.entries()) {
        if (info.taskId === taskId) {
          info.handle.cancel();
          running.delete(execId);
        }
      }
    },

    onWorkspaceCreated(workspace: Workspace): void {
      if (!workspace.paused) {
        watchers.watch(workspace.id, workspace.path);
      }
    },

    onWorkspaceDeleted(workspaceId: string): void {
      watchers.unwatch(workspaceId);
    },

    onWorkspacePausedChanged(workspace: Workspace): void {
      if (workspace.paused) {
        watchers.unwatch(workspace.id);
        return;
      }
      watchers.watch(workspace.id, workspace.path);
    },

    onWorkspaceUpdated(workspace: Workspace): void {
      watchers.unwatch(workspace.id);
      if (!workspace.paused) {
        watchers.watch(workspace.id, workspace.path);
      }
    },

    triggerManual(taskId: string): void {
      const task = store.getTask(taskId);
      if (task === null) {
        return;
      }
      trigger(task, { source: 'manual', detail: 'user' });
    },

    cancelExecution(executionId: string): void {
      const info = running.get(executionId);
      if (info === undefined) {
        return;
      }
      info.handle.cancel();
    },

    handleWatchEvent(e: WatchEvent): void {
      onWatchEvent(e);
    },

    async shutdown(): Promise<void> {
      scheduler.stopAll();
      for (const info of running.values()) {
        info.handle.cancel();
      }
      await watchers.closeAll();
    },
  };
}

