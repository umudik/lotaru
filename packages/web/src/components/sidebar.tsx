import type { MouseEvent, ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { FookieCloudBack } from '@/components/fookie-cloud-back';
import { isCloudHost } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { WorkspaceTaskDots } from '@/components/workspace-task-dots';
import { useStore } from '@/state/store';
import { navigate } from '@/app';

interface NavItemProps {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  trailing?: ReactNode;
}

function navItemClass(active: boolean): string {
  if (active) {
    return 'flex items-center gap-2 h-9 px-2.5 rounded-md text-sm font-medium transition-colors bg-secondary text-foreground';
  }
  return 'flex items-center gap-2 h-9 px-2.5 rounded-md text-sm font-medium transition-colors text-muted-foreground hover:text-foreground hover:bg-secondary/60';
}

function NavItem(props: NavItemProps): React.JSX.Element {
  function onClick(e: MouseEvent<HTMLAnchorElement>): void {
    e.preventDefault();
    navigate(props.href);
  }
  return (
    <a href={props.href} onClick={onClick} className={navItemClass(props.active)}>
      <span className="w-4 h-4 flex items-center justify-center shrink-0">{props.icon}</span>
      <span className="flex-1 min-w-0 truncate">{props.label}</span>
      {props.trailing}
    </a>
  );
}

export function Sidebar(props: { activeWorkspaceId?: string }): React.JSX.Element {
  const workspaces = useStore((s) => s.workspaces);

  return (
    <aside className="fixed top-0 left-0 bottom-0 w-60 bg-card/40 border-r flex flex-col">
      <button
        type="button"
        onClick={() => {
          navigate('/');
        }}
        className="flex items-center gap-2.5 px-4 h-14 border-b hover:bg-secondary/40 transition-colors w-full text-left"
      >
        <div className="w-7 h-7 rounded-lg bg-primary grid place-items-center text-primary-foreground font-bold text-sm">
          L
        </div>
        <div className="flex flex-col items-start">
          <span className="text-sm font-semibold tracking-tight">Lotaru</span>
          <span className="text-[10px] text-muted-foreground font-mono">v0.1</span>
        </div>
      </button>

      <nav className="flex-1 overflow-y-auto px-2 py-3 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="px-2 flex items-center justify-between h-6">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Projects
            </span>
            <button
              type="button"
              onClick={() => {
                navigate('/');
              }}
              className="text-muted-foreground hover:text-foreground hover:bg-secondary rounded-sm w-5 h-5 grid place-items-center"
              title="Add project"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          {workspaces.length === 0 && (
            <div className="text-xs text-muted-foreground px-2.5 py-1.5">No projects yet</div>
          )}
          <div className="flex flex-col gap-0.5">
            {workspaces.map((w) => {
              let dotCls = 'bg-success';
              if (w.paused) {
                dotCls = 'bg-warn';
              }
              return (
                <NavItem
                  key={w.id}
                  href={`/workspace/${w.id}`}
                  active={props.activeWorkspaceId === w.id}
                  icon={<span className={cn('w-1.5 h-1.5 rounded-full', dotCls)} />}
                  label={w.name}
                  trailing={<WorkspaceTaskDots workspaceId={w.id} max={8} />}
                />
              );
            })}
          </div>
        </div>
      </nav>
      {isCloudHost() && (
        <div className="px-4 py-3 border-t">
          <FookieCloudBack />
        </div>
      )}
    </aside>
  );
}
