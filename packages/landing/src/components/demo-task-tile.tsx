import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { statusDotClass, type DemoStatus } from '@/lib/status';

interface Props {
  name: string;
  trigger: string;
  status: DemoStatus;
  dots: readonly DemoStatus[];
  selected?: boolean;
  running?: boolean;
}

export function DemoTaskTile(props: Props): React.JSX.Element {
  let ringCls = '';
  if (props.running === true) {
    ringCls = 'ring-1 ring-primary/40';
  }
  if (props.selected === true) {
    ringCls = 'ring-1 ring-primary/50 bg-secondary/20';
  }

  return (
    <div
      className={cn(
        'rounded-xl border border-border/70 bg-card/80 p-2.5 flex flex-col gap-2 h-full',
        ringCls,
      )}
    >
      <div className="flex items-start gap-2 min-w-0">
        <span
          className={cn(
            'w-2 h-2 rounded-full shrink-0 mt-1',
            statusDotClass(props.status),
            props.running === true && 'animate-pulse',
          )}
        />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">{props.name}</div>
          <div className="text-[10px] text-muted-foreground truncate">{props.trigger}</div>
        </div>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Play className="w-3 h-3" />
        </span>
      </div>
      <div className="flex items-center gap-0.5 flex-wrap">
        {props.dots.map((d, i) => (
          <span
            key={`${props.name}-${String(i)}`}
            className={cn(
              'w-1.5 h-1.5 rounded-sm shrink-0',
              statusDotClass(d),
              d === 'running' && 'animate-pulse',
            )}
          />
        ))}
      </div>
    </div>
  );
}
