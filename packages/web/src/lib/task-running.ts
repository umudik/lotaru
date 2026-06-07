import type { Execution, ExecutionStatus } from '@/types';

function isTerminalStatus(status: ExecutionStatus): boolean {
  return status === 'success' || status === 'failed' || status === 'cancelled';
}

export function isActiveExecution(row: Execution): boolean {
  if (row.ended_at !== null) {
    return false;
  }
  if (isTerminalStatus(row.status)) {
    return false;
  }
  return row.status === 'running' || row.status === 'pending';
}

export function taskHasLiveRunning(
  taskId: string,
  liveExec: Record<string, { taskId: string; status: ExecutionStatus }>,
  history: readonly Execution[],
): boolean {
  const finishedIds = new Set<string>();
  for (const row of history) {
    if (row.ended_at !== null || isTerminalStatus(row.status)) {
      finishedIds.add(row.id);
    }
  }

  for (const key of Object.keys(liveExec)) {
    const e = liveExec[key];
    if (e === undefined) {
      continue;
    }
    if (e.taskId !== taskId) {
      continue;
    }
    if (e.status !== 'running') {
      continue;
    }
    if (finishedIds.has(key)) {
      continue;
    }
    return true;
  }

  for (const row of history) {
    if (finishedIds.has(row.id)) {
      continue;
    }
    if (isActiveExecution(row)) {
      return true;
    }
  }

  return false;
}

export function findRunningExecutionId(
  taskId: string,
  liveExec: Record<string, { taskId: string; status: ExecutionStatus }>,
  history: readonly Execution[],
  liveLogs: readonly { id: string; status: ExecutionStatus }[],
): string | null {
  for (const rt of liveLogs) {
    if (rt.status === 'running') {
      return rt.id;
    }
  }
  for (const key of Object.keys(liveExec)) {
    const e = liveExec[key];
    if (e === undefined) {
      continue;
    }
    if (e.taskId !== taskId) {
      continue;
    }
    if (e.status !== 'running') {
      continue;
    }
    return key;
  }
  for (const row of history) {
    if (isActiveExecution(row)) {
      return row.id;
    }
  }
  return null;
}

export function taskIsBusy(
  taskId: string,
  liveExec: Record<string, { taskId: string; status: ExecutionStatus }>,
  history: readonly Execution[],
  liveLogs: readonly { status: ExecutionStatus }[],
): boolean {
  if (taskHasLiveRunning(taskId, liveExec, history)) {
    return true;
  }
  for (const rt of liveLogs) {
    if (rt.status === 'running') {
      return true;
    }
  }
  return false;
}
