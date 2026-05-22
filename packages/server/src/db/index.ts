import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Workspace,
  Task,
  Execution,
  RuntimeKind,
  TriggerKind,
  ConcurrencyKind,
  ExecutionStatus,
} from '../types.js';

const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), 'schema.sql');

interface WorkspaceRow {
  id: string;
  name: string;
  path: string;
  paused: number;
  created_at: number;
}

interface TaskRow {
  id: string;
  workspace_id: string;
  name: string;
  command: string;
  runtime: string;
  docker_image: string | null;
  trigger_type: string;
  trigger_glob: string | null;
  trigger_cron: string | null;
  concurrency: string;
  enabled: number;
  created_at: number;
}

interface ExecutionRow {
  id: string;
  task_id: string;
  status: string;
  started_at: number | null;
  ended_at: number | null;
  exit_code: number | null;
  trigger_reason: string;
  log_path: string;
}

function rowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    paused: row.paused === 1,
    created_at: row.created_at,
  };
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    command: row.command,
    runtime: row.runtime as RuntimeKind,
    docker_image: row.docker_image,
    trigger_type: row.trigger_type as TriggerKind,
    trigger_glob: row.trigger_glob,
    trigger_cron: row.trigger_cron,
    concurrency: row.concurrency as ConcurrencyKind,
    enabled: row.enabled === 1,
    created_at: row.created_at,
  };
}

function rowToExecution(row: ExecutionRow): Execution {
  return {
    id: row.id,
    task_id: row.task_id,
    status: row.status as ExecutionStatus,
    started_at: row.started_at,
    ended_at: row.ended_at,
    exit_code: row.exit_code,
    trigger_reason: row.trigger_reason,
    log_path: row.log_path,
  };
}

export interface Store {
  listWorkspaces(): Workspace[];
  getWorkspace(id: string): Workspace | null;
  insertWorkspace(w: Workspace): void;
  setWorkspacePaused(id: string, paused: boolean): void;
  deleteWorkspace(id: string): void;

  listTasks(workspaceId: string): Task[];
  listAllEnabledTasks(): Task[];
  getTask(id: string): Task | null;
  insertTask(t: Task): void;
  updateTask(t: Task): void;
  deleteTask(id: string): void;

  insertExecution(e: Execution): void;
  updateExecution(e: Execution): void;
  getExecution(id: string): Execution | null;
  listExecutionsByTask(taskId: string, limit: number): Execution[];
  listRecentExecutions(limit: number): Execution[];

  close(): void;
}

export function openStore(dbPath: string): Store {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);

  const stmts = {
    listWorkspaces: db.prepare<[], WorkspaceRow>('SELECT * FROM workspaces ORDER BY created_at ASC'),
    getWorkspace: db.prepare<[string], WorkspaceRow>('SELECT * FROM workspaces WHERE id = ?'),
    insertWorkspace: db.prepare(
      'INSERT INTO workspaces (id, name, path, paused, created_at) VALUES (?, ?, ?, ?, ?)',
    ),
    setWorkspacePaused: db.prepare('UPDATE workspaces SET paused = ? WHERE id = ?'),
    deleteWorkspace: db.prepare('DELETE FROM workspaces WHERE id = ?'),

    listTasksByWorkspace: db.prepare<[string], TaskRow>(
      'SELECT * FROM tasks WHERE workspace_id = ? ORDER BY created_at ASC',
    ),
    listAllEnabledTasks: db.prepare<[], TaskRow>('SELECT * FROM tasks WHERE enabled = 1'),
    getTask: db.prepare<[string], TaskRow>('SELECT * FROM tasks WHERE id = ?'),
    insertTask: db.prepare(
      `INSERT INTO tasks
        (id, workspace_id, name, command, runtime, docker_image, trigger_type, trigger_glob, trigger_cron, concurrency, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    updateTask: db.prepare(
      `UPDATE tasks SET
        name = ?, command = ?, runtime = ?, docker_image = ?,
        trigger_type = ?, trigger_glob = ?, trigger_cron = ?,
        concurrency = ?, enabled = ?
       WHERE id = ?`,
    ),
    deleteTask: db.prepare('DELETE FROM tasks WHERE id = ?'),

    insertExecution: db.prepare(
      `INSERT INTO executions
        (id, task_id, status, started_at, ended_at, exit_code, trigger_reason, log_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    updateExecution: db.prepare(
      `UPDATE executions SET
        status = ?, started_at = ?, ended_at = ?, exit_code = ?
       WHERE id = ?`,
    ),
    getExecution: db.prepare<[string], ExecutionRow>('SELECT * FROM executions WHERE id = ?'),
    listExecutionsByTask: db.prepare<[string, number], ExecutionRow>(
      'SELECT * FROM executions WHERE task_id = ? ORDER BY COALESCE(started_at, 0) DESC LIMIT ?',
    ),
    listRecentExecutions: db.prepare<[number], ExecutionRow>(
      'SELECT * FROM executions ORDER BY COALESCE(started_at, 0) DESC LIMIT ?',
    ),
  };

  function boolToInt(value: boolean): number {
    if (value) {
      return 1;
    }
    return 0;
  }

  return {
    listWorkspaces(): Workspace[] {
      const rows = stmts.listWorkspaces.all();
      return rows.map(rowToWorkspace);
    },
    getWorkspace(id: string): Workspace | null {
      const row = stmts.getWorkspace.get(id);
      if (row === undefined) {
        return null;
      }
      return rowToWorkspace(row);
    },
    insertWorkspace(w: Workspace): void {
      stmts.insertWorkspace.run(w.id, w.name, w.path, boolToInt(w.paused), w.created_at);
    },
    setWorkspacePaused(id: string, paused: boolean): void {
      stmts.setWorkspacePaused.run(boolToInt(paused), id);
    },
    deleteWorkspace(id: string): void {
      stmts.deleteWorkspace.run(id);
    },

    listTasks(workspaceId: string): Task[] {
      const rows = stmts.listTasksByWorkspace.all(workspaceId);
      return rows.map(rowToTask);
    },
    listAllEnabledTasks(): Task[] {
      const rows = stmts.listAllEnabledTasks.all();
      return rows.map(rowToTask);
    },
    getTask(id: string): Task | null {
      const row = stmts.getTask.get(id);
      if (row === undefined) {
        return null;
      }
      return rowToTask(row);
    },
    insertTask(t: Task): void {
      stmts.insertTask.run(
        t.id,
        t.workspace_id,
        t.name,
        t.command,
        t.runtime,
        t.docker_image,
        t.trigger_type,
        t.trigger_glob,
        t.trigger_cron,
        t.concurrency,
        boolToInt(t.enabled),
        t.created_at,
      );
    },
    updateTask(t: Task): void {
      stmts.updateTask.run(
        t.name,
        t.command,
        t.runtime,
        t.docker_image,
        t.trigger_type,
        t.trigger_glob,
        t.trigger_cron,
        t.concurrency,
        boolToInt(t.enabled),
        t.id,
      );
    },
    deleteTask(id: string): void {
      stmts.deleteTask.run(id);
    },

    insertExecution(e: Execution): void {
      stmts.insertExecution.run(
        e.id,
        e.task_id,
        e.status,
        e.started_at,
        e.ended_at,
        e.exit_code,
        e.trigger_reason,
        e.log_path,
      );
    },
    updateExecution(e: Execution): void {
      stmts.updateExecution.run(e.status, e.started_at, e.ended_at, e.exit_code, e.id);
    },
    getExecution(id: string): Execution | null {
      const row = stmts.getExecution.get(id);
      if (row === undefined) {
        return null;
      }
      return rowToExecution(row);
    },
    listExecutionsByTask(taskId: string, limit: number): Execution[] {
      const rows = stmts.listExecutionsByTask.all(taskId, limit);
      return rows.map(rowToExecution);
    },
    listRecentExecutions(limit: number): Execution[] {
      const rows = stmts.listRecentExecutions.all(limit);
      return rows.map(rowToExecution);
    },

    close(): void {
      db.close();
    },
  };
}
