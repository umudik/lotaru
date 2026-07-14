import { useEffect, useState } from 'react';
import { ConsoleSidebar } from '@/components/console-sidebar';
import { ConsoleTopbar } from '@/components/console-topbar';
import { AgentsView } from '@/components/views/agents-view';
import { DocsView } from '@/components/views/docs-view';
import { HomeView } from '@/components/views/home-view';
import { TasksView } from '@/components/views/tasks-view';
import { exchangeCode } from '@/lib/config';
import { viewTitles } from '@/lib/nav';
import type { ConsoleView } from '@/lib/nav';

function MainView(props: { view: ConsoleView }): React.JSX.Element {
  if (props.view === 'agents') {
    return <AgentsView />;
  }
  if (props.view === 'tasks') {
    return <TasksView />;
  }
  if (props.view === 'docs') {
    return <DocsView />;
  }
  return <HomeView />;
}

export function App(): React.JSX.Element {
  const [view, setView] = useState<ConsoleView>('home');
  const [boot, setBoot] = useState<'ready' | 'auth' | 'error'>('ready');
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(location.href);
    if (url.pathname !== '/callback') {
      return;
    }
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (code === null || state === null) {
      setBoot('error');
      setAuthError('Missing OAuth code');
      return;
    }
    setBoot('auth');
    void exchangeCode(code, state)
      .then(() => {
        history.replaceState({}, '', '/');
        setBoot('ready');
        location.reload();
      })
      .catch((err: unknown) => {
        setBoot('error');
        setAuthError(err instanceof Error ? err.message : 'Auth failed');
      });
  }, []);

  if (boot === 'auth') {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Signing in…
      </div>
    );
  }

  if (boot === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm">
        <p className="text-destructive">{authError ?? 'Auth failed'}</p>
        <a className="text-primary underline" href="/">
          Back to console
        </a>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <ConsoleTopbar />
      <div className="flex min-h-0 flex-1">
        <ConsoleSidebar active={view} onChange={setView} />
        <main className="min-w-0 flex-1 overflow-auto">
          <div className="border-b bg-card px-6 py-4">
            <h1 className="text-xl font-normal tracking-tight">{viewTitles[view]}</h1>
          </div>
          <div className="mx-auto max-w-5xl px-6 py-6">
            <MainView view={view} />
          </div>
        </main>
      </div>
    </div>
  );
}
