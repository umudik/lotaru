import { Link, matchPath, useLocation } from "react-router-dom";
import {
  FolderKanban,
  ListTodo,
  NotebookPen,
  Settings,
  SquareTerminal,
  BookOpen,
  Activity,
  FileText,
  GitBranch,
  ListOrdered,
  Mic,
  MicOff,
  Loader2,
  Bot,
  Wand2,
  Network,
  ScrollText,
  LayoutTemplate,
  ShoppingBag,
  Volume2,
  X,
  type LucideIcon,
} from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { cn } from "@/lib/utils";
import { useSession } from "@/hooks/useSession";
import { useVoiceListen } from "@/features/voice/VoiceListenContext";
import { useSpeakPlayer } from "@/features/speak/SpeakPlayerContext";
import { VoiceLevelBars } from "@/features/voice/VoiceWaveform";
import { toast } from "sonner";
import { useIngestAlarm } from "@/components/IngestAlarmBanner";

export function AppSidebar(props: { mobileOpen: boolean; onClose: () => void }) {
  const { pathname } = useLocation();
  const session = useSession();
  const voice = useVoiceListen();
  const speak = useSpeakPlayer();
  const ingest = useIngestAlarm();

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
        <NavGroup label="You">
          <NavItem to="/voice" label="Voice" icon={Mic} />
          <NavItem to="/speak" label="Speak" icon={Volume2} />
        </NavGroup>
        <div className="space-y-0.5">
          <NavItem to="/projects" label="Projects" icon={FolderKanban} end />
        </div>

        {projectId ? (
          <div className="space-y-3">
            <p className="truncate px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {projectName}
            </p>
            <NavGroup label="Automation">
              <NavItem to={`/projects/${projectId}/rules`} label="Event extractors" icon={Wand2} />
              <NavItem to={`/projects/${projectId}/agents`} label="Event responders" icon={Bot} />
              <NavItem to={`/projects/${projectId}/scripts`} label="Scripts" icon={ScrollText} />
            </NavGroup>
            <NavGroup label="Shell">
              <NavItem to={`/projects/${projectId}/terminal`} label="Terminal" icon={SquareTerminal} />
            </NavGroup>
            <NavGroup label="Work">
              <NavItem to={`/projects/${projectId}/tasks`} label="Tasks" icon={ListTodo} />
              <NavItem to={`/projects/${projectId}/pipeline`} label="Pipeline" icon={ListOrdered} />
            </NavGroup>
            <NavGroup label="Notes">
              <NavItem to={`/projects/${projectId}/notes`} label="Notes" icon={NotebookPen} />
            </NavGroup>
            <NavGroup label="Knowledge">
              <NavItem
                to={`/projects/${projectId}/knowledge/documentation/list`}
                label="Documents"
                icon={FileText}
              />
              <NavItem
                to={`/projects/${projectId}/knowledge/documentation/templates`}
                label="Doc templates"
                icon={LayoutTemplate}
              />
              <NavItem
                to={`/projects/${projectId}/knowledge/diagrams/list`}
                label="Diagrams"
                icon={GitBranch}
              />
              <NavItem
                to={`/projects/${projectId}/knowledge/diagrams/templates`}
                label="Diagram templates"
                icon={Network}
              />
              <NavItem to={`/projects/${projectId}/library`} label="Sources" icon={BookOpen} />
            </NavGroup>
            <NavGroup label="Marketplace">
              <NavItem
                to={`/projects/${projectId}/marketplace`}
                label="Marketplace"
                icon={ShoppingBag}
              />
            </NavGroup>
            <NavGroup label="Log">
              <NavItem to={`/projects/${projectId}/logs`} label="Log" icon={Activity} />
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
        <div className="space-y-1">
          <SidebarListenButton voice={voice} />
          <SidebarSpeakButton speak={speak} />
          {voice.error.length > 0 ? (
            <p className="px-3 text-[10px] leading-snug text-destructive">{voice.error}</p>
          ) : null}
          {speak.error.length > 0 ? (
            <p className="px-3 text-[10px] leading-snug text-destructive">{speak.error}</p>
          ) : null}
        </div>
        <NavItem to="/settings" label="Settings" icon={Settings} warn={ingest.kind !== "ok"} />
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

function SidebarListenButton(props: {
  voice: ReturnType<typeof useVoiceListen>;
}): React.JSX.Element {
  const listenActive = props.voice.armed;
  const listenLive = listenActive && props.voice.listening;
  let listenLabel = "Listen";
  if (props.voice.reconnecting && listenActive) {
    listenLabel = "Reconnecting";
  } else if (listenLive) {
    listenLabel = "Listening";
  } else if (listenActive) {
    listenLabel = "Connecting";
  }
  return (
    <button
      type="button"
      className={cn(
        "relative flex h-9 w-full items-center gap-2 overflow-hidden rounded-md px-2.5 text-sm font-medium transition-colors",
        listenActive
          ? "bg-success/15 text-success hover:bg-success/20"
          : "bg-destructive/15 text-destructive hover:bg-destructive/20",
      )}
      onClick={() => {
        if (listenActive) {
          props.voice.stop();
          return;
        }
        void props.voice.start().catch((err: unknown) => {
          const message =
            err instanceof Error && err.message.length > 0
              ? err.message
              : "Could not start Listen.";
          toast.error(message);
        });
      }}
    >
      {props.voice.reconnecting && listenActive ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      ) : listenLive ? (
        <MicOff className="h-4 w-4 shrink-0 opacity-90" />
      ) : listenActive ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      ) : (
        <Mic className="h-4 w-4 shrink-0 opacity-90" />
      )}
      <span className={cn("min-w-0 flex-1 truncate text-left", listenLive && "pr-[4.25rem]")}>
        {listenLabel}
      </span>
      {listenLive ? (
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center">
          <VoiceLevelBars level={props.voice.level} active={true} size="wide" className="shrink-0" />
        </span>
      ) : null}
    </button>
  );
}

function SidebarSpeakButton(props: {
  speak: ReturnType<typeof useSpeakPlayer>;
}): React.JSX.Element {
  const speakActive = props.speak.armed;
  let speakLabel = "Speak";
  if (speakActive && props.speak.speaking) {
    speakLabel = "Speaking";
  } else if (speakActive) {
    speakLabel = "Speak on";
  }
  return (
    <button
      type="button"
      className={cn(
        "flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-sm font-medium transition-colors",
        speakActive
          ? "bg-success/15 text-success hover:bg-success/20"
          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
      onClick={() => {
        if (speakActive) {
          props.speak.disarm();
          return;
        }
        props.speak.arm();
      }}
    >
      <Volume2 className="h-4 w-4 shrink-0 opacity-90" />
      <span className="min-w-0 flex-1 truncate text-left">{speakLabel}</span>
    </button>
  );
}

type NavItemProps = {
  to: string;
  label: string;
  icon: LucideIcon;
  badge: number | null;
  end: boolean | null;
  active: boolean | null;
  warn: boolean | null;
};

function NavItem(rawProps: Partial<NavItemProps> & Pick<NavItemProps, "to" | "label" | "icon">) {
  const { pathname } = useLocation();
  let badge = 0;
  const givenBadge = rawProps.badge;
  if (givenBadge !== null && givenBadge !== undefined && givenBadge > 0) {
    badge = givenBadge;
  }
  let end = false;
  if ("end" in rawProps && rawProps.end === true) {
    end = true;
  }
  const warn = rawProps.warn === true;
  const { to, label, icon: Icon } = rawProps;
  let on = matchPath({ path: to, end }, pathname) !== null;
  if ("active" in rawProps && rawProps.active === true) {
    on = true;
  }
  if ("active" in rawProps && rawProps.active === false) {
    on = false;
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
      {warn ? (
        <span className="h-2 w-2 shrink-0 rounded-full bg-warn" aria-label="Needs attention" />
      ) : (
        <span
          className={cn(
            "flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[11px] font-medium",
            badge > 0 ? "bg-primary text-primary-foreground" : "invisible",
          )}
          aria-hidden={badge <= 0}
        >
          {badge > 0 ? badge : 0}
        </span>
      )}
    </Link>
  );
}
