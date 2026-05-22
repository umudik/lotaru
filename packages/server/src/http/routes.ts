import { nanoid } from 'nanoid';
import { readFileSync, existsSync, statSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { Store } from '../db/index.js';
import type { Orchestrator } from '../orchestrator.js';
import type { EventBus } from '../events/bus.js';
import type {
  Task,
  Workspace,
  RuntimeKind,
  TriggerKind,
  ConcurrencyKind,
} from '../types.js';

interface CreateWorkspaceBody {
  name: string;
  path: string;
}

interface CreateTaskBody {
  name: string;
  command: string;
  runtime: RuntimeKind;
  docker_image: string | null;
  trigger_type: TriggerKind;
  trigger_glob: string | null;
  trigger_cron: string | null;
  concurrency: ConcurrencyKind;
  enabled: boolean;
}

function isRuntime(v: unknown): v is RuntimeKind {
  return v === 'shell' || v === 'docker';
}
function isTrigger(v: unknown): v is TriggerKind {
  return v === 'save' || v === 'manual' || v === 'startup' || v === 'scheduled';
}
function isConcurrency(v: unknown): v is ConcurrencyKind {
  return v === 'restart' || v === 'queue' || v === 'ignore' || v === 'parallel';
}

function validateCreateTask(body: unknown): CreateTaskBody | string {
  if (typeof body !== 'object' || body === null) {
    return 'body must be object';
  }
  const b = body as Record<string, unknown>;
  if (typeof b['name'] !== 'string' || b['name'].length === 0) {
    return 'name required';
  }
  if (typeof b['command'] !== 'string' || b['command'].length === 0) {
    return 'command required';
  }
  if (!isRuntime(b['runtime'])) {
    return 'invalid runtime';
  }
  if (!isTrigger(b['trigger_type'])) {
    return 'invalid trigger_type';
  }
  if (!isConcurrency(b['concurrency'])) {
    return 'invalid concurrency';
  }
  let dockerImage: string | null = null;
  if (b['docker_image'] !== undefined && b['docker_image'] !== null) {
    if (typeof b['docker_image'] !== 'string') {
      return 'docker_image must be string or null';
    }
    dockerImage = b['docker_image'];
  }
  let triggerGlob: string | null = null;
  if (b['trigger_glob'] !== undefined && b['trigger_glob'] !== null) {
    if (typeof b['trigger_glob'] !== 'string') {
      return 'trigger_glob must be string or null';
    }
    triggerGlob = b['trigger_glob'];
  }
  let triggerCron: string | null = null;
  if (b['trigger_cron'] !== undefined && b['trigger_cron'] !== null) {
    if (typeof b['trigger_cron'] !== 'string') {
      return 'trigger_cron must be string or null';
    }
    triggerCron = b['trigger_cron'];
  }
  let enabled = true;
  if (b['enabled'] !== undefined) {
    if (typeof b['enabled'] !== 'boolean') {
      return 'enabled must be boolean';
    }
    enabled = b['enabled'];
  }
  return {
    name: b['name'],
    command: b['command'],
    runtime: b['runtime'],
    docker_image: dockerImage,
    trigger_type: b['trigger_type'],
    trigger_glob: triggerGlob,
    trigger_cron: triggerCron,
    concurrency: b['concurrency'],
    enabled,
  };
}

export function registerRoutes(
  app: FastifyInstance,
  store: Store,
  bus: EventBus,
  orch: Orchestrator,
): void {
  app.get('/api/v1/workspaces', async () => {
    return { workspaces: store.listWorkspaces() };
  });

  app.post<{ Body: unknown }>('/api/v1/workspaces', async (req, reply) => {
    const raw = req.body;
    if (typeof raw !== 'object' || raw === null) {
      await reply.code(400).send({ error: 'body required' });
      return;
    }
    const body = raw as Partial<CreateWorkspaceBody>;
    if (typeof body.name !== 'string' || body.name.length === 0) {
      await reply.code(400).send({ error: 'name required' });
      return;
    }
    if (typeof body.path !== 'string' || body.path.length === 0) {
      await reply.code(400).send({ error: 'path required' });
      return;
    }
    if (!existsSync(body.path)) {
      await reply.code(400).send({ error: 'path does not exist' });
      return;
    }
    const st = statSync(body.path);
    if (!st.isDirectory()) {
      await reply.code(400).send({ error: 'path is not a directory' });
      return;
    }
    const w: Workspace = {
      id: nanoid(12),
      name: body.name,
      path: body.path,
      paused: false,
      created_at: Date.now(),
    };
    store.insertWorkspace(w);
    orch.onWorkspaceCreated(w);
    bus.emit({ kind: 'workspace.updated', workspaceId: w.id });
    await reply.send({ workspace: w });
  });

  app.post<{ Params: { id: string } }>('/api/v1/workspaces/:id/pause', async (req, reply) => {
    const w = store.getWorkspace(req.params.id);
    if (w === null) {
      await reply.code(404).send({ error: 'not found' });
      return;
    }
    store.setWorkspacePaused(w.id, true);
    const updated: Workspace = { ...w, paused: true };
    orch.onWorkspacePausedChanged(updated);
    bus.emit({ kind: 'workspace.updated', workspaceId: w.id });
    await reply.send({ workspace: updated });
  });

  app.post<{ Params: { id: string } }>('/api/v1/workspaces/:id/resume', async (req, reply) => {
    const w = store.getWorkspace(req.params.id);
    if (w === null) {
      await reply.code(404).send({ error: 'not found' });
      return;
    }
    store.setWorkspacePaused(w.id, false);
    const updated: Workspace = { ...w, paused: false };
    orch.onWorkspacePausedChanged(updated);
    bus.emit({ kind: 'workspace.updated', workspaceId: w.id });
    await reply.send({ workspace: updated });
  });

  app.delete<{ Params: { id: string } }>('/api/v1/workspaces/:id', async (req, reply) => {
    const w = store.getWorkspace(req.params.id);
    if (w === null) {
      await reply.code(404).send({ error: 'not found' });
      return;
    }
    const tasks = store.listTasks(w.id);
    for (const t of tasks) {
      orch.onTaskDeleted(t.id);
    }
    store.deleteWorkspace(w.id);
    orch.onWorkspaceDeleted(w.id);
    bus.emit({ kind: 'workspace.deleted', workspaceId: w.id });
    await reply.send({ ok: true });
  });

  app.get<{ Params: { id: string } }>('/api/v1/workspaces/:id/tasks', async (req, reply) => {
    const w = store.getWorkspace(req.params.id);
    if (w === null) {
      await reply.code(404).send({ error: 'not found' });
      return;
    }
    await reply.send({ tasks: store.listTasks(w.id) });
  });

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/v1/workspaces/:id/tasks',
    async (req, reply) => {
      const w = store.getWorkspace(req.params.id);
      if (w === null) {
        await reply.code(404).send({ error: 'workspace not found' });
        return;
      }
      const v = validateCreateTask(req.body);
      if (typeof v === 'string') {
        await reply.code(400).send({ error: v });
        return;
      }
      const t: Task = {
        id: nanoid(12),
        workspace_id: w.id,
        name: v.name,
        command: v.command,
        runtime: v.runtime,
        docker_image: v.docker_image,
        trigger_type: v.trigger_type,
        trigger_glob: v.trigger_glob,
        trigger_cron: v.trigger_cron,
        concurrency: v.concurrency,
        enabled: v.enabled,
        created_at: Date.now(),
      };
      store.insertTask(t);
      orch.onTaskCreated(t);
      bus.emit({ kind: 'task.updated', taskId: t.id });
      await reply.send({ task: t });
    },
  );

  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/api/v1/tasks/:id',
    async (req, reply) => {
      const existing = store.getTask(req.params.id);
      if (existing === null) {
        await reply.code(404).send({ error: 'not found' });
        return;
      }
      const v = validateCreateTask(req.body);
      if (typeof v === 'string') {
        await reply.code(400).send({ error: v });
        return;
      }
      const t: Task = {
        ...existing,
        name: v.name,
        command: v.command,
        runtime: v.runtime,
        docker_image: v.docker_image,
        trigger_type: v.trigger_type,
        trigger_glob: v.trigger_glob,
        trigger_cron: v.trigger_cron,
        concurrency: v.concurrency,
        enabled: v.enabled,
      };
      store.updateTask(t);
      orch.onTaskUpdated(t);
      bus.emit({ kind: 'task.updated', taskId: t.id });
      await reply.send({ task: t });
    },
  );

  app.delete<{ Params: { id: string } }>('/api/v1/tasks/:id', async (req, reply) => {
    const t = store.getTask(req.params.id);
    if (t === null) {
      await reply.code(404).send({ error: 'not found' });
      return;
    }
    orch.onTaskDeleted(t.id);
    store.deleteTask(t.id);
    bus.emit({ kind: 'task.deleted', taskId: t.id });
    await reply.send({ ok: true });
  });

  app.post<{ Params: { id: string } }>('/api/v1/tasks/:id/run', async (req, reply) => {
    const t = store.getTask(req.params.id);
    if (t === null) {
      await reply.code(404).send({ error: 'not found' });
      return;
    }
    orch.triggerManual(t.id);
    await reply.send({ ok: true });
  });

  app.post<{ Params: { id: string } }>('/api/v1/executions/:id/cancel', async (req, reply) => {
    orch.cancelExecution(req.params.id);
    await reply.send({ ok: true });
  });

  app.get<{ Querystring: { taskId?: string; limit?: string } }>(
    '/api/v1/executions',
    async (req, reply) => {
      let limit = 50;
      if (typeof req.query.limit === 'string') {
        const n = Number.parseInt(req.query.limit, 10);
        if (Number.isFinite(n) && n > 0 && n <= 500) {
          limit = n;
        }
      }
      if (typeof req.query.taskId === 'string' && req.query.taskId.length > 0) {
        await reply.send({ executions: store.listExecutionsByTask(req.query.taskId, limit) });
        return;
      }
      await reply.send({ executions: store.listRecentExecutions(limit) });
    },
  );

  app.get<{ Params: { id: string } }>('/api/v1/executions/:id/log', async (req, reply) => {
    const e = store.getExecution(req.params.id);
    if (e === null) {
      await reply.code(404).send({ error: 'not found' });
      return;
    }
    if (!existsSync(e.log_path)) {
      await reply.send({ log: '' });
      return;
    }
    const log = readFileSync(e.log_path, 'utf8');
    await reply.send({ log });
  });
}
