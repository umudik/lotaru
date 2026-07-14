import { BookOpen, Home, Monitor, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConsoleView } from '@/lib/nav';

const items: { id: ConsoleView; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'agents', label: 'Agents', icon: Monitor },
  { id: 'tasks', label: 'Tasks', icon: Terminal },
  { id: 'docs', label: 'Docs', icon: BookOpen },
];

interface Props {
  active: ConsoleView;
  onChange: (view: ConsoleView) => void;
}

export function ConsoleSidebar(props: Props): React.JSX.Element {
  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r bg-card py-3">
      <nav className="flex flex-col gap-0.5 px-2">
        {items.map((item) => {
          const Icon = item.icon;
          const active = props.active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                props.onChange(item.id);
              }}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors text-left',
                active
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
