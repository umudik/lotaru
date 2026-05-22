import { useEffect, useState } from 'react';
import { Pause, PlayCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TaskCard } from '@/components/task-card';
import { LogPanel } from '@/components/log-panel';
import type { InspectTarget } from '@/components/run-dots';
import { actions, useStore, selectTasksOf } from '@/state/store';
import { api } from '@/api/client';
import { navigate } from '@/app';

interface Props {
  workspaceId: string;
}

export function WorkspaceView(props: Props): React.JSX.Element {
  const workspace = useStore((s) => {
    for (const w of s.workspaces) {
      if (w.id === props.workspaceId) {
        return w;
      }
    }
    return null;
  });
  const tasks = useStore((s) => selectTasksOf(s, props.workspaceId));
  const liveExec = useStore((s) => s.liveExecutions);
  const [creating, setCreating] = useState(false);
  const [inspect, setInspect] = useState<InspectTarget | null>(null);

  useEffect(() => {
    void actions.refreshTasks(props.workspaceId);
  }, [props.workspaceId]);

  useEffect(() => {
    void actions.refreshExecutionsForWorkspace(props.workspaceId);
  }, [props.workspaceId, tasks.length]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void actions.refreshExecutionsForWorkspace(props.workspaceId);
    }, 5000);
    return () => {
      window.clearInterval(interval);
    };
  }, [props.workspaceId, tasks.length]);

  if (workspace === null) {
    return <div className="text-sm text-muted-foreground">Project not found.</div>;
  }

  let running = 0;
  for (const t of tasks) {
    for (const key of Object.keys(liveExec)) {
      const e = liveExec[key];
      if (e === undefined) {
        continue;
      }
      if (e.taskId === t.id && e.status === 'running') {
        running += 1;
      }
    }
  }

  let inspectTaskName = '';
  if (inspect !== null) {
    for (const t of tasks) {
      if (t.id === inspect.taskId) {
        inspectTaskName = t.name;
      }
    }
  }

  async function togglePause(): Promise<void> {
    if (workspace === null) {
      return;
    }
    try {
      if (workspace.paused) {
        await api.resumeWorkspace(workspace.id);
      } else {
        await api.pauseWorkspace(workspace.id);
      }
      await actions.refreshWorkspaces();
      toast.success('Saved');
    } catch (e: unknown) {
      toast.error(String(e));
    }
  }

  async function remove(): Promise<void> {
    if (workspace === null) {
      return;
    }
    if (!window.confirm(`Delete project "${workspace.name}"?`)) {
      return;
    }
    try {
      await api.deleteWorkspace(workspace.id);
      await actions.refreshWorkspaces();
      toast.success('Deleted');
      navigate('/');
    } catch (e: unknown) {
      toast.error(String(e));
    }
  }

  async function createTask(): Promise<void> {
    if (workspace === null) {
      return;
    }
    setCreating(true);
    try {
      await api.createTask(workspace.id, {
        name: 'New task',
        command: 'echo hello',
        runtime: 'shell',
        docker_image: null,
        trigger_type: 'manual',
        trigger_glob: null,
        trigger_cron: null,
        concurrency: 'restart',
        enabled: true,
      });
      await actions.refreshTasks(workspace.id);
      toast.success('Task created');
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setCreating(false);
    }
  }

  let stateBadge: React.JSX.Element;
  if (workspace.paused) {
    stateBadge = <Badge variant="warn">Paused</Badge>;
  } else if (running > 0) {
    stateBadge = <Badge>{`${String(running)} running`}</Badge>;
  } else {
    stateBadge = <Badge variant="success">Live</Badge>;
  }

  let pauseIcon = <Pause className="w-3.5 h-3.5" />;
  let pauseLabelStr = 'Pause';
  if (workspace.paused) {
    pauseIcon = <PlayCircle className="w-3.5 h-3.5" />;
    pauseLabelStr = 'Resume';
  }

  return (
    <div className="flex gap-0 -mx-8 min-h-[calc(100vh-4rem)]">
      <div className="flex-1 min-w-0 px-8 py-0 flex flex-col gap-6">
        <header className="flex items-end justify-between gap-6 flex-wrap pb-4 border-b">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Project</span>
              {stateBadge}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{workspace.name}</h1>
            <p className="text-xs text-muted-foreground font-mono truncate">{workspace.path}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" onClick={() => { void togglePause(); }} variant="outline" size="sm">
              {pauseIcon} {pauseLabelStr}
            </Button>
            <Button type="button" onClick={() => { void remove(); }} variant="ghost" size="sm">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
            <Button type="button" onClick={() => { void createTask(); }} disabled={creating} size="sm">
              New task
            </Button>
          </div>
        </header>

        {tasks.length === 0 && (
          <Card className="border-dashed">
            <div className="p-8 text-center text-sm text-muted-foreground">No tasks yet</div>
          </Card>
        )}

        <div className="flex flex-col gap-2 pb-8">
          {tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              onInspect={(target) => { setInspect(target); }}
            />
          ))}
        </div>
      </div>

      {inspect !== null && (
        <div className="w-[min(420px,40vw)] shrink-0 sticky top-0 self-start h-[calc(100vh-2rem)]">
          <LogPanel
            target={inspect}
            taskName={inspectTaskName}
            onClose={() => { setInspect(null); }}
            onCancel={(id) => { void api.cancelExecution(id); }}
          />
        </div>
      )}
    </div>
  );
}
