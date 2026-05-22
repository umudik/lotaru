import { type MouseEvent } from 'react';
import { Play, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { cronPresetLabel, resolveCronExpression } from '@/lib/cron-presets';
import { statusDotClass } from '@/lib/format';
import { RunDotsPreview } from '@/components/run-dots-preview';
import { useStableRunning } from '@/hooks/use-stable-running';
import { api } from '@/api/client';
import { useStore, selectExecutionsOf, selectLiveLogsOf } from '@/state/store';
import type { Task, ExecutionStatus } from '@/types';

function taskIsRunning(
  taskId: string,
  liveExec: Record<string, { taskId: string; status: ExecutionStatus }>,
): boolean {
  for (const key of Object.keys(liveExec)) {
    const e = liveExec[key];
    if (e === undefined) {
      continue;
    }
    if (e.taskId === taskId && e.status === 'running') {
      return true;
    }
  }
  return false;
}

function lastStatus(
  taskId: string,
  liveExec: Record<string, { taskId: string; status: ExecutionStatus }>,
  history: readonly { status: ExecutionStatus }[],
): ExecutionStatus | 'idle' {
  if (taskIsRunning(taskId, liveExec)) {
    return 'running';
  }
  const last = history[0];
  if (last === undefined) {
    return 'idle';
  }
  return last.status;
}

function triggerSummary(t: Task): string {
  if (t.trigger_type === 'save') {
    return 'save';
  }
  if (t.trigger_type === 'startup') {
    return 'startup';
  }
  if (t.trigger_type === 'scheduled') {
    return cronPresetLabel(resolveCronExpression(t.trigger_cron));
  }
  return 'manual';
}

function stopBubble(e: MouseEvent): void {
  e.stopPropagation();
}

interface Props {
  task: Task;
  selected: boolean;
  onSelect(): void;
}

export function TaskTile(props: Props): React.JSX.Element {
  const t = props.task;
  const history = useStore((s) => selectExecutionsOf(s, t.id));
  const liveExec = useStore((s) => s.liveExecutions);
  const live = useStore((s) => selectLiveLogsOf(s, t.id));
  const isRunning = taskIsRunning(t.id, liveExec);
  const stableRunning = useStableRunning(isRunning, 500);
  const status = lastStatus(t.id, liveExec, history);

  async function run(e: MouseEvent): Promise<void> {
    stopBubble(e);
    await api.runTask(t.id);
  }

  async function cancel(e: MouseEvent): Promise<void> {
    stopBubble(e);
    for (const rt of live) {
      if (rt.status === 'running') {
        await api.cancelExecution(rt.id);
        return;
      }
    }
  }

  let ringCls = '';
  if (stableRunning) {
    ringCls = 'ring-1 ring-primary/40';
  }
  let selectedCls = '';
  if (props.selected) {
    selectedCls = 'ring-1 ring-ring bg-secondary/30';
  }

  let runBtn: React.JSX.Element;
  if (stableRunning) {
    runBtn = (
      <Button type="button" onClick={(e) => { void cancel(e); }} variant="destructive" size="sm" className="h-6 w-6 p-0 shrink-0">
        <X className="w-3 h-3" />
      </Button>
    );
  } else {
    runBtn = (
      <Button type="button" onClick={(e) => { void run(e); }} size="sm" className="h-6 w-6 p-0 shrink-0">
        <Play className="w-3 h-3" />
      </Button>
    );
  }

  return (
    <Card
      className={cn(
        'cursor-pointer hover:bg-secondary/25 transition-colors h-full',
        ringCls,
        selectedCls,
      )}
      onClick={props.onSelect}
    >
      <div className="p-2.5 flex flex-col gap-2 h-full">
        <div className="flex items-start gap-2 min-w-0">
          <span
            className={cn(
              'w-2 h-2 rounded-full shrink-0 mt-1',
              statusDotClass(status),
              stableRunning && 'animate-pulse',
            )}
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{t.name}</div>
            <div className="text-[10px] text-muted-foreground font-mono truncate">{t.command}</div>
            <div className="text-[10px] text-muted-foreground truncate">{triggerSummary(t)}</div>
          </div>
          <div onClick={stopBubble}>{runBtn}</div>
        </div>
        <RunDotsPreview taskId={t.id} max={14} />
      </div>
    </Card>
  );
}
