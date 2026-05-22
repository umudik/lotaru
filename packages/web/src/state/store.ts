import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '../api/client.js';
import { connectStream } from '../api/stream.js';
import type { Workspace, Task, Execution, ExecutionStatus, ServerMessage } from '../types.js';

interface ExecutionRuntime {
  id: string;
  taskId: string;
  status: ExecutionStatus | 'running';
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  logLines: { stream: 'out' | 'err'; line: string; ts: number }[];
}

interface State {
  workspaces: Workspace[];
  tasksByWorkspace: Record<string, Task[]>;
  recentExecutions: Execution[];
  executionsByTask: Record<string, Execution[]>;
  liveExecutions: Record<string, ExecutionRuntime>;
  liveLogsByTask: Record<string, ExecutionRuntime[]>;
}

const initial: State = {
  workspaces: [],
  tasksByWorkspace: {},
  recentExecutions: [],
  executionsByTask: {},
  liveExecutions: {},
  liveLogsByTask: {},
};

type Listener = () => void;

let state: State = initial;
const listeners = new Set<Listener>();

function set(updater: (s: State) => State): void {
  state = updater(state);
  for (const l of listeners) {
    l();
  }
}

function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getState(): State {
  return state;
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(getState()), () => selector(initial));
}

const EMPTY_TASKS: readonly Task[] = Object.freeze([]);
const EMPTY_EXECUTIONS: readonly Execution[] = Object.freeze([]);
const EMPTY_RUNTIMES: readonly ExecutionRuntime[] = Object.freeze([]);

export function selectTasksOf(s: State, workspaceId: string): readonly Task[] {
  const list = s.tasksByWorkspace[workspaceId];
  if (list === undefined) {
    return EMPTY_TASKS;
  }
  return list;
}

export function selectExecutionsOf(s: State, taskId: string): readonly Execution[] {
  const list = s.executionsByTask[taskId];
  if (list === undefined) {
    return EMPTY_EXECUTIONS;
  }
  return list;
}

export function selectLiveLogsOf(s: State, taskId: string): readonly ExecutionRuntime[] {
  const list = s.liveLogsByTask[taskId];
  if (list === undefined) {
    return EMPTY_RUNTIMES;
  }
  return list;
}

const executionRefreshAt = new Map<string, number>();

function scheduleExecutionRefresh(taskId: string, delayMs: number): void {
  const now = Date.now();
  const last = executionRefreshAt.get(taskId);
  if (last !== undefined && now - last < delayMs) {
    return;
  }
  executionRefreshAt.set(taskId, now);
  void actions.refreshExecutionsForTask(taskId);
}

export const actions = {
  async refreshWorkspaces(): Promise<void> {
    const r = await api.listWorkspaces();
    set((s) => ({ ...s, workspaces: r.workspaces }));
  },
  async refreshTasks(workspaceId: string): Promise<void> {
    const r = await api.listTasks(workspaceId);
    set((s) => ({ ...s, tasksByWorkspace: { ...s.tasksByWorkspace, [workspaceId]: r.tasks } }));
  },
  async refreshRecentExecutions(): Promise<void> {
    const r = await api.listExecutions(null, 30);
    set((s) => ({ ...s, recentExecutions: r.executions }));
  },
  async refreshExecutionsForTask(taskId: string): Promise<void> {
    const r = await api.listExecutions(taskId, 20);
    set((s) => ({ ...s, executionsByTask: { ...s.executionsByTask, [taskId]: r.executions } }));
  },
  async refreshExecutionsForWorkspace(workspaceId: string): Promise<void> {
    const tasks = selectTasksOf(state, workspaceId);
    await Promise.all(
      tasks.map(async (t) => {
        const r = await api.listExecutions(t.id, 20);
        set((s) => ({ ...s, executionsByTask: { ...s.executionsByTask, [t.id]: r.executions } }));
      }),
    );
  },
};

function handleMessage(msg: ServerMessage): void {
  if (msg.kind === 'execution.started') {
    scheduleExecutionRefresh(msg.taskId, 1500);
    set((s) => {
      const rt: ExecutionRuntime = {
        id: msg.executionId,
        taskId: msg.taskId,
        status: 'running',
        startedAt: msg.ts,
        endedAt: null,
        exitCode: null,
        logLines: [],
      };
      const taskLogs = s.liveLogsByTask[msg.taskId];
      let nextList: ExecutionRuntime[] = [rt];
      if (taskLogs !== undefined) {
        nextList = [rt, ...taskLogs].slice(0, 5);
      }
      return {
        ...s,
        liveExecutions: { ...s.liveExecutions, [msg.executionId]: rt },
        liveLogsByTask: { ...s.liveLogsByTask, [msg.taskId]: nextList },
      };
    });
    return;
  }
  if (msg.kind === 'execution.log') {
    set((s) => {
      const existing = s.liveExecutions[msg.executionId];
      if (existing === undefined) {
        return s;
      }
      const lines = [...existing.logLines, { stream: msg.stream, line: msg.line, ts: msg.ts }];
      const trimmed = lines.slice(-2000);
      const updated: ExecutionRuntime = { ...existing, logLines: trimmed };
      const taskLogs = s.liveLogsByTask[existing.taskId];
      let nextList = taskLogs;
      if (taskLogs !== undefined) {
        nextList = taskLogs.map((e) => {
          if (e.id === existing.id) {
            return updated;
          }
          return e;
        });
      }
      const liveLogsByTask = { ...s.liveLogsByTask };
      if (nextList !== undefined) {
        liveLogsByTask[existing.taskId] = nextList;
      }
      return {
        ...s,
        liveExecutions: { ...s.liveExecutions, [msg.executionId]: updated },
        liveLogsByTask,
      };
    });
    return;
  }
  if (msg.kind === 'execution.ended') {
    set((s) => {
      const existing = s.liveExecutions[msg.executionId];
      if (existing === undefined) {
        return s;
      }
      const updated: ExecutionRuntime = {
        ...existing,
        status: msg.status,
        endedAt: msg.ts,
        exitCode: msg.exitCode,
      };
      const taskLogs = s.liveLogsByTask[existing.taskId];
      let nextList = taskLogs;
      if (taskLogs !== undefined) {
        nextList = taskLogs.map((e) => {
          if (e.id === existing.id) {
            return updated;
          }
          return e;
        });
      }
      const liveLogsByTask = { ...s.liveLogsByTask };
      if (nextList !== undefined) {
        liveLogsByTask[existing.taskId] = nextList;
      }
      void actions.refreshRecentExecutions();
      scheduleExecutionRefresh(existing.taskId, 800);
      const endedExec: Execution = {
        id: msg.executionId,
        task_id: existing.taskId,
        status: msg.status,
        started_at: existing.startedAt,
        ended_at: msg.ts,
        exit_code: msg.exitCode,
        trigger_reason: 'live',
        log_path: '',
      };
      const prev = s.executionsByTask[existing.taskId];
      let nextHist: Execution[] = [endedExec];
      if (prev !== undefined) {
        const filtered: Execution[] = [];
        for (const row of prev) {
          if (row.id !== msg.executionId) {
            filtered.push(row);
          }
        }
        nextHist = [endedExec, ...filtered];
      }
      if (nextHist.length > 20) {
        nextHist = nextHist.slice(0, 20);
      }
      const liveExecNext: Record<string, ExecutionRuntime> = {};
      for (const key of Object.keys(s.liveExecutions)) {
        if (key !== msg.executionId) {
          const row = s.liveExecutions[key];
          if (row !== undefined) {
            liveExecNext[key] = row;
          }
        }
      }
      return {
        ...s,
        liveExecutions: liveExecNext,
        liveLogsByTask,
        executionsByTask: {
          ...s.executionsByTask,
          [existing.taskId]: nextHist,
        },
      };
    });
    return;
  }
  if (msg.kind === 'workspace.updated' || msg.kind === 'workspace.deleted') {
    void actions.refreshWorkspaces();
    return;
  }
  if (msg.kind === 'task.updated' || msg.kind === 'task.deleted') {
    const all = state.workspaces;
    for (const w of all) {
      void actions.refreshTasks(w.id);
    }
    return;
  }
}

export function useBootstrap(): { ready: boolean } {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const stream = connectStream();
    const unsub = stream.subscribe(handleMessage);
    void (async () => {
      await actions.refreshWorkspaces();
      const ws = state.workspaces;
      for (const w of ws) {
        await actions.refreshTasks(w.id);
      }
      await actions.refreshRecentExecutions();
      setReady(true);
    })();
    return () => {
      unsub();
      stream.close();
    };
  }, []);
  return { ready };
}

export type { ExecutionRuntime };
