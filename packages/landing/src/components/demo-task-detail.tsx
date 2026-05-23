import { ChevronRight, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { statusBadgeClass, statusDotClass } from '@/lib/status';

const RUNS = [
  { status: 'success' as const, trigger: 'on save', time: '14:32:01', duration: '2.41s', exit: '0', selected: true },
  { status: 'success' as const, trigger: 'on save', time: '14:28:44', duration: '2.38s', exit: '0', selected: false },
  { status: 'failed' as const, trigger: 'on save', time: '14:21:10', duration: '0.82s', exit: '1', selected: false },
];

export function DemoTaskDetail(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 p-3 h-full min-h-0">
      <div className="flex items-center justify-between gap-2 shrink-0">
        <span className="text-xs font-semibold">Task</span>
      </div>
      <div className="text-xs font-medium shrink-0">build-api</div>
      <button
        type="button"
        className="w-full text-left rounded-xl border border-border/70 bg-card/80 px-3 py-2.5 shrink-0"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
            <Terminal className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium">Command</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">7 lines · Shell</div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>
      </button>
      <div className="flex flex-col gap-1.5 min-h-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium shrink-0">
          Run history (7)
        </div>
        <div className="flex flex-col gap-1 overflow-hidden">
          {RUNS.map((r) => (
            <div
              key={r.time}
              className={cn(
                'rounded-md border p-2 flex flex-col gap-1 shrink-0',
                r.selected
                  ? 'border-primary/40 ring-1 ring-primary/30 bg-primary/5'
                  : 'border-border/60 bg-card/40',
              )}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', statusDotClass(r.status))} />
                <span className={cn('text-[9px] rounded border px-1 py-0 font-medium', statusBadgeClass(r.status))}>
                  {r.status === 'success' ? 'Success' : 'Failed'}
                </span>
                <span className="text-[9px] font-mono text-muted-foreground truncate flex-1">{r.trigger}</span>
              </div>
              <div className="flex justify-between text-[9px] text-muted-foreground pl-3">
                <span>{r.time}</span>
                <span>{r.duration}</span>
                <span>exit {r.exit}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
