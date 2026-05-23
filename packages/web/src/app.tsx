import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/sidebar';
import { useBootstrap, useStore } from '@/state/store';
import { DashboardView } from '@/views/Dashboard';
import { WorkspaceView } from '@/views/Workspace';

type Route = { kind: 'list' } | { kind: 'workspace'; id: string };

function parsePathWithTaskRedirect(pathname: string): {
  route: Route;
  taskRedirect: string | null;
} {
  const clean = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (clean === '' || clean === 'dashboard') {
    return { route: { kind: 'list' }, taskRedirect: null };
  }
  const parts = clean.split('/');
  if (parts.length === 2 && parts[0] === 'workspace' && typeof parts[1] === 'string') {
    return { route: { kind: 'workspace', id: parts[1] }, taskRedirect: null };
  }
  if (parts.length === 2 && parts[0] === 'task' && typeof parts[1] === 'string') {
    return { route: { kind: 'list' }, taskRedirect: parts[1] };
  }
  return { route: { kind: 'list' }, taskRedirect: null };
}

export function navigate(path: string): void {
  let p = path;
  if (!p.startsWith('/')) {
    p = `/${p}`;
  }
  if (window.location.pathname === p) {
    return;
  }
  window.history.pushState({}, '', p);
  window.dispatchEvent(new Event('lotaru:navigate'));
}

function TaskRedirect(props: { taskId: string }): React.JSX.Element {
  const tasksByWorkspace = useStore((s) => s.tasksByWorkspace);
  useEffect(() => {
    for (const key of Object.keys(tasksByWorkspace)) {
      const list = tasksByWorkspace[key];
      if (list === undefined) {
        continue;
      }
      for (const t of list) {
        if (t.id === props.taskId) {
          navigate(`/workspace/${t.workspace_id}`);
          return;
        }
      }
    }
    navigate('/');
  }, [props.taskId, tasksByWorkspace]);
  return <div className="text-sm text-muted-foreground">Redirecting…</div>;
}

function renderRoute(route: Route): React.JSX.Element {
  if (route.kind === 'workspace') {
    return <WorkspaceView workspaceId={route.id} />;
  }
  return <DashboardView />;
}

function BootSplash(): React.JSX.Element {
  return (
    <div className="min-h-screen grid place-items-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary grid place-items-center text-primary-foreground font-bold animate-pulse">
          L
        </div>
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    </div>
  );
}

function useRouteWithRedirect(): { route: Route; taskRedirect: string | null } {
  const [parsed, setParsed] = useState(() => parsePathWithTaskRedirect(window.location.pathname));
  useEffect(() => {
    const handler = (): void => {
      setParsed(parsePathWithTaskRedirect(window.location.pathname));
    };
    window.addEventListener('popstate', handler);
    window.addEventListener('lotaru:navigate', handler);
    return () => {
      window.removeEventListener('popstate', handler);
      window.removeEventListener('lotaru:navigate', handler);
    };
  }, []);
  return parsed;
}

export function App(): React.JSX.Element {
  const { ready } = useBootstrap();
  const { route, taskRedirect } = useRouteWithRedirect();

  if (!ready) {
    return <BootSplash />;
  }

  if (taskRedirect !== null) {
    return (
      <div className="min-h-screen grid place-items-center">
        <TaskRedirect taskId={taskRedirect} />
      </div>
    );
  }

  if (route.kind === 'workspace') {
    return (
      <div className="min-h-screen">
        <Sidebar activeWorkspaceId={route.id} />
        <main className="pl-60 min-h-screen pr-0">
          <div className="w-full px-8 py-6">{renderRoute(route)}</div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Sidebar />
      <main className="pl-60 min-h-screen">
        <div className="max-w-[1600px] mx-auto px-8 py-8">{renderRoute(route)}</div>
      </main>
    </div>
  );
}
