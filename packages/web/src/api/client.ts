import type { Workspace, Task, Execution } from '../types.js';

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${String(res.status)}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listWorkspaces(): Promise<{ workspaces: Workspace[] }> {
    return jsonFetch('/api/v1/workspaces');
  },
  createWorkspace(name: string, path: string): Promise<{ workspace: Workspace }> {
    return jsonFetch('/api/v1/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, path }),
    });
  },
  pauseWorkspace(id: string): Promise<{ workspace: Workspace }> {
    return jsonFetch(`/api/v1/workspaces/${id}/pause`, { method: 'POST' });
  },
  resumeWorkspace(id: string): Promise<{ workspace: Workspace }> {
    return jsonFetch(`/api/v1/workspaces/${id}/resume`, { method: 'POST' });
  },
  deleteWorkspace(id: string): Promise<{ ok: boolean }> {
    return jsonFetch(`/api/v1/workspaces/${id}`, { method: 'DELETE' });
  },
  listTasks(workspaceId: string): Promise<{ tasks: Task[] }> {
    return jsonFetch(`/api/v1/workspaces/${workspaceId}/tasks`);
  },
  createTask(workspaceId: string, body: Omit<Task, 'id' | 'workspace_id' | 'created_at'>): Promise<{ task: Task }> {
    return jsonFetch(`/api/v1/workspaces/${workspaceId}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  updateTask(id: string, body: Omit<Task, 'id' | 'workspace_id' | 'created_at'>): Promise<{ task: Task }> {
    return jsonFetch(`/api/v1/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  deleteTask(id: string): Promise<{ ok: boolean }> {
    return jsonFetch(`/api/v1/tasks/${id}`, { method: 'DELETE' });
  },
  runTask(id: string): Promise<{ ok: boolean }> {
    return jsonFetch(`/api/v1/tasks/${id}/run`, { method: 'POST' });
  },
  cancelExecution(id: string): Promise<{ ok: boolean }> {
    return jsonFetch(`/api/v1/executions/${id}/cancel`, { method: 'POST' });
  },
  listExecutions(taskId: string | null, limit: number): Promise<{ executions: Execution[] }> {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (taskId !== null) {
      params.set('taskId', taskId);
    }
    return jsonFetch(`/api/v1/executions?${params.toString()}`);
  },
  getExecutionLog(id: string): Promise<{ log: string }> {
    return jsonFetch(`/api/v1/executions/${id}/log`);
  },
};
