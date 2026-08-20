import { Link, matchPath, useLocation } from "react-router-dom";
import {
  FolderKanban,
  ListTodo,
  NotebookPen,
  Settings,
  Terminal,
  BookOpen,
  Activity,
  FileText,
  GitBranch,
  ListOrdered,
  Zap,
  Mic,
  X,
  type LucideIcon,
} from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { cn } from "@/lib/utils";
import { useSession } from "@/hooks/useSession";
import { useVoiceListen } from "@/features/voice/VoiceListenContext";

export function AppSidebar(props: { mobileOpen: boolean; onClose: () => void }) {
  const { pathname } = useLocation();
  const session = useSession();
  const voice = useVoiceListen();

  const projectMatch = matchPath("/projects/:projectId/*", pathname);
  let activeProjectId: string | null = null;
  if (projectMatch !== null) {
    const paramId = projectMatch.params.projectId;
    if (typeof paramId === "string" && paramId.length > 0) {
      activeProjectId = paramId;
    }
  }
  let fallbackProjectId: string | null = activeProjectId;
  if (fallbackProjectId === null && session.projectId !== null) {
    fallbackProjectId = session.projectId;
  }
  const projectId = activeProjectId;
  let projectName: string | null = projectId;
  if (session.projectName !== null) {
    projectName = session.projectName;
  } else if (projectId === null && fallbackProjectId !== null) {
    projectName = fallbackProjectId;
  }

  return (
    <aside className={cn("app-sidebar", props.mobileOpen && "is-open")}>
      <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <BrandMark compact />
        <button
          type="button"
          onClick={props.onClose}
          className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground md:hidden"
          aria-label="Close menu"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
        <div className="space-y-0.5">
          <NavItem to="/projects" label="Projects" icon={FolderKanban} end />
        </div>

        {projectId ? (
          <div className="space-y-3">
            <p className="truncate px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {projectName}
            </p>
            <NavGroup label="State">
              <NavItem to={`/projects/${projectId}/events`} label="Events" icon={Activity} />
              <NavItem to={`/projects/${projectId}/voice`} label="Voice" icon={Mic} />
              <NavItem to={`/projects/${projectId}/reactions`} label="Reactions" icon={Zap} />
              <NavItem to={`/projects/${projectId}/scripts`} label="Scripts" icon={Terminal} />
            </NavGroup>
            <NavGroup label="Work">
              <NavItem to={`/projects/${projectId}/tasks`} label="Tasks" icon={ListTodo} />
              <NavItem to={`/projects/${projectId}/pipeline`} label="Pipeline" icon={ListOrdered} />
            </NavGroup>
            <NavGroup label="Knowledge">
              <NavGroup label="Documentation">
                <NavItem
                  to={`/projects/${projectId}/knowledge/documentation/templates`}
                  label="Templates"
                  icon={FileText}
                />
                <NavItem
                  to={`/projects/${projectId}/knowledge/documentation/list`}
                  label="Documents"
                  icon={FileText}
                />
              </NavGroup>
              <NavGroup label="Diagrams">
                <NavItem
                  to={`/projects/${projectId}/knowledge/diagrams/templates`}
                  label="Templates"
                  icon={GitBranch}
                />
                <NavItem
                  to={`/projects/${projectId}/knowledge/diagrams/list`}
                  label="Diagrams"
                  icon={GitBranch}
                />
              </NavGroup>
              <NavItem to={`/projects/${projectId}/notes`} label="Notes" icon={NotebookPen} />
              <NavItem to={`/projects/${projectId}/library`} label="Sources" icon={BookOpen} />
            </NavGroup>
          </div>
        ) : fallbackProjectId ? (
          <div className="space-y-0.5">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Recent project
            </p>
            <NavItem
              to={`/projects/${fallbackProjectId}/tasks`}
              label={projectName !== null ? projectName : "Open project"}
              icon={ListTodo}
            />
          </div>
        ) : null}
      </nav>
      <div className="shrink-0 space-y-1 border-t border-border/70 px-2 py-2">
        {projectId !== null ? (
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              voice.listening && voice.projectId === projectId
                ? "bg-destructive/15 text-destructive"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
            onClick={() => {
              if (voice.listening && voice.projectId === projectId) {
                voice.stop();
                return;
              }
              void voice.start(projectId);
            }}
          >
            <Mic className="h-4 w-4" />
            {voice.listening && voice.projectId === projectId ? "Listening" : "Listen"}
          </button>
        ) : null}
        <NavItem to="/settings" label="Settings" icon={Settings} />
      </div>
    </aside>
  );
}

function NavGroup(props: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="space-y-0.5">
      <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {props.label}
      </p>
      {props.children}
    </div>
  );
}

type NavItemProps = {
  to: string;
  label: string;
  icon: LucideIcon;
  badge: number | null;
  end: boolean | null;
  active: boolean | null;
};

function NavItem(rawProps: Partial<NavItemProps> & Pick<NavItemProps, "to" | "label" | "icon">) {
  const { pathname } = useLocation();
  let badge = 0;
  if ("badge" in rawProps && typeof rawProps.badge === "number") {
    badge = rawProps.badge;
  }
  let end = false;
  if ("end" in rawProps && rawProps.end === true) {
    end = true;
  }
  const { to, label, icon: Icon } = rawProps;
  let on = matchPath({ path: to, end }, pathname) !== null;
  if ("active" in rawProps && typeof rawProps.active === "boolean") {
    on = rawProps.active;
  }

  return (
    <Link
      to={to}
      aria-current={on ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-2 rounded-md px-2.5 text-sm font-medium transition-colors",
        on
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-90" />
      <span className="flex-1 truncate">{label}</span>
      <span
        className={cn(
          "flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[11px] font-medium",
          badge > 0 ? "bg-primary text-primary-foreground" : "invisible",
        )}
        aria-hidden={badge <= 0}
      >
        {badge > 0 ? badge : 0}
      </span>
    </Link>
  );
}
