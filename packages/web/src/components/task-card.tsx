import { useEffect, useState } from 'react';
import { Play, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { patchTask } from '@/lib/task-patch';
import { CRON_PRESETS, resolveCronExpression } from '@/lib/cron-presets';
import { nullToEmpty, statusDotClass } from '@/lib/format';
import { RunDots } from '@/components/run-dots';
import type { InspectTarget } from '@/components/run-dots';
import { useStableRunning } from '@/hooks/use-stable-running';
import { api } from '@/api/client';
import { actions, useStore, selectExecutionsOf, selectLiveLogsOf } from '@/state/store';
import type {
  Task,
  RuntimeKind,
  TriggerKind,
  ConcurrencyKind,
  ExecutionStatus,
} from '@/types';

const runtimeOptions: readonly { value: RuntimeKind; label: string }[] = [
  { value: 'shell', label: 'Shell' },
  { value: 'docker', label: 'Docker' },
];
const triggerOptions: readonly { value: TriggerKind; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'save', label: 'On save' },
  { value: 'startup', label: 'On startup' },
  { value: 'scheduled', label: 'Scheduled' },
];
const concurrencyOptions: readonly { value: ConcurrencyKind; label: string }[] = [
  { value: 'restart', label: 'Restart' },
  { value: 'queue', label: 'Queue' },
  { value: 'ignore', label: 'Ignore' },
  { value: 'parallel', label: 'Parallel' },
];

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

function emptyToNull(v: string): string | null {
  if (v === '') {
    return null;
  }
  return v;
}

interface Props {
  task: Task;
  onInspect(target: InspectTarget): void;
}

export function TaskCard(props: Props): React.JSX.Element {
  const t = props.task;
  const history = useStore((s) => selectExecutionsOf(s, t.id));
  const liveExec = useStore((s) => s.liveExecutions);
  const live = useStore((s) => selectLiveLogsOf(s, t.id));
  const isRunning = taskIsRunning(t.id, liveExec);
  const stableRunning = useStableRunning(isRunning, 500);
  const status = lastStatus(t.id, liveExec, history);

  const [name, setName] = useState(t.name);
  const [command, setCommand] = useState(t.command);
  const [glob, setGlob] = useState(nullToEmpty(t.trigger_glob));
  const [dockerImage, setDockerImage] = useState(nullToEmpty(t.docker_image));

  useEffect(() => {
    setName(t.name);
    setCommand(t.command);
    setGlob(nullToEmpty(t.trigger_glob));
    setDockerImage(nullToEmpty(t.docker_image));
  }, [t.id, t.name, t.command, t.trigger_glob, t.trigger_cron, t.docker_image]);

  useEffect(() => {
    void actions.refreshExecutionsForTask(t.id);
  }, [t.id]);

  async function saveField(partial: Partial<Task>): Promise<void> {
    try {
      await patchTask(t, partial);
    } catch (e: unknown) {
      toast.error(String(e));
    }
  }

  async function run(): Promise<void> {
    try {
      await api.runTask(t.id);
    } catch (e: unknown) {
      toast.error(String(e));
    }
  }

  async function cancel(): Promise<void> {
    for (const rt of live) {
      if (rt.status === 'running') {
        try {
          await api.cancelExecution(rt.id);
        } catch (e: unknown) {
          toast.error(String(e));
        }
        return;
      }
    }
  }

  async function remove(): Promise<void> {
    if (!window.confirm(`Delete task "${t.name}"?`)) {
      return;
    }
    try {
      await api.deleteTask(t.id);
      await actions.refreshTasks(t.workspace_id);
      toast.success('Deleted');
    } catch (e: unknown) {
      toast.error(String(e));
    }
  }

  let ringCls = '';
  if (stableRunning) {
    ringCls = 'ring-1 ring-primary/30';
  }

  const scheduleValue = resolveCronExpression(t.trigger_cron);

  let dockerImageInput: React.JSX.Element | null = null;
  if (t.runtime === 'docker') {
    dockerImageInput = (
      <div className="flex flex-col gap-1">
        <Label className="text-[10px] text-muted-foreground">Image</Label>
        <Input
          value={dockerImage}
          onChange={(e) => { setDockerImage(e.target.value); }}
          onBlur={() => { void saveField({ docker_image: emptyToNull(dockerImage) }); }}
          placeholder="alpine"
          className="font-mono h-7 text-xs"
        />
      </div>
    );
  }

  let globInput: React.JSX.Element | null = null;
  if (t.trigger_type === 'save') {
    globInput = (
      <div className="flex flex-col gap-1">
        <Label className="text-[10px] text-muted-foreground">Glob</Label>
        <Input
          value={glob}
          onChange={(e) => { setGlob(e.target.value); }}
          onBlur={() => { void saveField({ trigger_glob: emptyToNull(glob) }); }}
          className="font-mono h-7 text-xs"
        />
      </div>
    );
  }

  let cronInput: React.JSX.Element | null = null;
  if (t.trigger_type === 'scheduled') {
    cronInput = (
      <div className="flex flex-col gap-1">
        <Label className="text-[10px] text-muted-foreground">Schedule</Label>
        <Select value={scheduleValue} onValueChange={(v) => { void saveField({ trigger_cron: v }); }}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CRON_PRESETS.map((p) => (
              <SelectItem key={p.expression} value={p.expression}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  let runBtn: React.JSX.Element;
  if (stableRunning) {
    runBtn = (
      <Button type="button" onClick={() => { void cancel(); }} variant="destructive" size="sm" className="h-7 w-[72px]">
        <X className="w-3 h-3" />
      </Button>
    );
  } else {
    runBtn = (
      <Button type="button" onClick={() => { void run(); }} size="sm" className="h-7 w-[72px]">
        <Play className="w-3 h-3" />
      </Button>
    );
  }

  return (
    <Card className={cn('transition-shadow', ringCls)}>
      <div className="p-3 flex flex-col gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              'w-1.5 h-1.5 rounded-full shrink-0',
              statusDotClass(status),
              stableRunning && 'animate-pulse',
            )}
          />
          <Input
            value={name}
            onChange={(e) => { setName(e.target.value); }}
            onBlur={() => {
              if (name !== t.name) {
                void saveField({ name });
              }
            }}
            className="h-7 text-sm font-medium border-transparent bg-transparent px-1 flex-1 min-w-0 focus-visible:ring-0"
          />
          <RunDots taskId={t.id} onInspect={props.onInspect} />
          <div className="flex items-center gap-1.5 shrink-0">
            <Switch
              checked={t.enabled}
              onCheckedChange={(v) => { void saveField({ enabled: v }); }}
              className="scale-75"
            />
            {runBtn}
            <Button type="button" onClick={() => { void remove(); }} variant="ghost" size="icon" className="h-7 w-7">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        <Textarea
          value={command}
          onChange={(e) => { setCommand(e.target.value); }}
          onBlur={() => {
            if (command !== t.command) {
              void saveField({ command });
            }
          }}
          rows={1}
          className="font-mono text-xs resize-none min-h-0 h-8 py-1.5"
        />

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <div className="flex flex-col gap-1">
            <Label className="text-[10px] text-muted-foreground">Trigger</Label>
            <Select
              value={t.trigger_type}
              onValueChange={(v) => {
                const kind = v as TriggerKind;
                if (kind === 'scheduled') {
                  void saveField({
                    trigger_type: kind,
                    trigger_cron: resolveCronExpression(t.trigger_cron),
                  });
                  return;
                }
                void saveField({ trigger_type: kind });
              }}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {triggerOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[10px] text-muted-foreground">Concurrency</Label>
            <Select
              value={t.concurrency}
              onValueChange={(v) => { void saveField({ concurrency: v as ConcurrencyKind }); }}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {concurrencyOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-[10px] text-muted-foreground">Runtime</Label>
            <Select
              value={t.runtime}
              onValueChange={(v) => { void saveField({ runtime: v as RuntimeKind }); }}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {runtimeOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {globInput}
          {cronInput}
          {dockerImageInput}
        </div>
      </div>
    </Card>
  );
}
