import { ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { statusDotClass } from '@/lib/format';
import { collectRunDots } from '@/lib/runs';
import { useStore, selectExecutionsOf, selectLiveLogsOf } from '@/state/store';
import type { ExecutionStatus } from '@/types';

export interface InspectTarget {
  taskId: string;
  executionId: string;
  isLive: boolean;
}

interface Props {
  taskId: string;
  onInspect(target: InspectTarget): void;
}

function dotTitle(status: ExecutionStatus | 'running'): string {
  if (status === 'running') {
    return 'Running';
  }
  if (status === 'success') {
    return 'Success';
  }
  if (status === 'failed') {
    return 'Failed';
  }
  if (status === 'cancelled') {
    return 'Cancelled';
  }
  return 'Pending';
}

export function RunDots(props: Props): React.JSX.Element {
  const history = useStore((s) => selectExecutionsOf(s, props.taskId));
  const liveLogs = useStore((s) => selectLiveLogsOf(s, props.taskId));
  const liveExec = useStore((s) => s.liveExecutions);
  const dots = collectRunDots(props.taskId, history, liveLogs, liveExec);

  function openLast(): void {
    if (dots.length === 0) {
      return;
    }
    const first = dots[0];
    if (first === undefined) {
      return;
    }
    let isLive = false;
    if (first.status === 'running') {
      isLive = true;
    }
    props.onInspect({ taskId: props.taskId, executionId: first.id, isLive });
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      <button
        type="button"
        onClick={openLast}
        disabled={dots.length === 0}
        className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-30 p-1 rounded hover:bg-secondary/60"
        title="Last run log"
      >
        <ScrollText className="w-3.5 h-3.5" />
      </button>
      <div className="flex items-center gap-0.5 flex-wrap min-w-0">
        {dots.length === 0 && (
          <span className="text-[10px] text-muted-foreground">no runs</span>
        )}
        {dots.map((d) => {
          let pulse = '';
          if (d.status === 'running') {
            pulse = 'animate-pulse ring-1 ring-primary/50';
          }
          return (
            <button
              key={d.id}
              type="button"
              title={dotTitle(d.status)}
              onClick={() => {
                let isLive = false;
                if (d.status === 'running') {
                  isLive = true;
                }
                props.onInspect({
                  taskId: props.taskId,
                  executionId: d.id,
                  isLive,
                });
              }}
              className={cn(
                'w-2 h-2 rounded-sm shrink-0 hover:scale-125 transition-transform',
                statusDotClass(d.status),
                pulse,
              )}
            />
          );
        })}
      </div>
    </div>
  );
}
