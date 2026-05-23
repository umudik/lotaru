import { type MouseEvent } from 'react';
import { Play, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { cronPresetLabel, resolveCronExpression } from '@/lib/cron-presets';
import { statusDotClass, statusLabel, statusRingClass } from '@/lib/format';
import { RunDotsPreview } from '@/components/run-dots-preview';
import { TaskScheduleBar } from '@/components/task-schedule-bar';
import { useStableRunning } from '@/hooks/use-stable-running';
import { useTick } from '@/hooks/use-tick';
import { api } from '@/api/client';
import { taskHasLiveRunning } from '@/lib/task-running';
import { useStore, selectExecutionsOf, selectLiveLogsOf } from '@/state/store';
import type { Execution, Task, ExecutionStatus } from '@/types';

function lastStatus(
  taskId: string,
  liveExec: Record<string, { taskId: string; status: ExecutionStatus }>,
  history: readonly Execution[],
): ExecutionStatus | 'idle' {
  if (taskHasLiveRunning(taskId, liveExec, history)) {
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
    return 'on save';
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
  workspacePaused: boolean;
  onSelect(): void;
}

export function TaskTile(props: Props): React.JSX.Element {
  const t = props.task;
  const history = useStore((s) => selectExecutionsOf(s, t.id));
  const liveExec = useStore((s) => s.liveExecutions);
  const live = useStore((s) => selectLiveLogsOf(s, t.id));
  const isRunning = taskHasLiveRunning(t.id, liveExec, history);
  const stableRunning = useStableRunning(isRunning, 500);
  const status = lastStatus(t.id, liveExec, history);
  const isScheduled = t.trigger_type === 'scheduled' && t.enabled;
  const nowMs = useTick(250, isScheduled);

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

  let statusCaption: string | null = null;
  if (stableRunning) {
    statusCaption = 'Running';
  } else if (status !== 'idle') {
    statusCaption = statusLabel(status);
  }

  const ringCls = statusRingClass(status, stableRunning);

  return (
    <Card
      className={cn(
        'cursor-pointer hover:bg-secondary/20 transition-colors h-full overflow-hidden flex flex-col relative',
        ringCls,
        props.selected && 'bg-secondary/20',
        !t.enabled && 'opacity-55',
        props.workspacePaused && 'opacity-70',
      )}
      onClick={props.onSelect}
    >
      {props.selected && (
        <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-muted-foreground/45 pointer-events-none" />
      )}
      <div className="p-2.5 flex flex-col gap-2 flex-1 min-h-0">
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
            <div className="text-[10px] text-muted-foreground truncate mt-0.5">{triggerSummary(t)}</div>
            {statusCaption !== null && (
              <div
                className={cn(
                  'text-[9px] font-medium mt-0.5 truncate',
                  stableRunning && 'text-running',
                  status === 'success' && !stableRunning && 'text-success',
                  status === 'failed' && !stableRunning && 'text-destructive',
                  status === 'cancelled' && !stableRunning && 'text-warn',
                )}
              >
                {statusCaption}
              </div>
            )}
          </div>
          <div onClick={stopBubble}>{runBtn}</div>
        </div>
        <RunDotsPreview taskId={t.id} max={14} />
        {isScheduled && (
          <TaskScheduleBar
            triggerCron={t.trigger_cron}
            nowMs={nowMs}
            paused={props.workspacePaused || !t.enabled}
          />
        )}
      </div>
    </Card>
  );
}
