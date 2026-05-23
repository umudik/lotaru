import type { Execution, ExecutionStatus } from '@/types';

function isTerminalStatus(status: ExecutionStatus): boolean {
  return status === 'success' || status === 'failed' || status === 'cancelled';
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

  return false;
}
