import { useState } from 'react';
import { ConsoleSidebar } from '@/components/console-sidebar';
import { ConsoleTopbar } from '@/components/console-topbar';
import { AgentsView } from '@/components/views/agents-view';
import { DocsView } from '@/components/views/docs-view';
import { HomeView } from '@/components/views/home-view';
import { TasksView } from '@/components/views/tasks-view';
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
