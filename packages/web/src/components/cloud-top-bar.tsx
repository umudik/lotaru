import { FookieCloudMark } from '@/components/fookie-cloud-mark';
import { isCloudHost } from '@/lib/auth';
import type { AgentInfo } from '@/hooks/use-agent-connection';

export function CloudTopBar(props: {
  agentOnline?: boolean;
  agentInfo?: AgentInfo | null;
}): React.JSX.Element | null {
  if (!isCloudHost()) {
    return null;
  }

  const online = props.agentOnline === true;
  const host = props.agentInfo?.hostname?.trim();
  let statusLabel = 'Waiting for agent';
  if (online) {
    statusLabel = host !== undefined && host.length > 0 ? `Agent · ${host}` : 'Agent connected';
  }

  return (
    <div className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border/60 bg-background/90 px-6 backdrop-blur-md">
      <FookieCloudMark size="md" />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className={
            online
              ? 'inline-block h-1.5 w-1.5 rounded-full bg-success'
              : 'inline-block h-1.5 w-1.5 rounded-full bg-warn animate-pulse'
          }
        />
        <span className="truncate max-w-[16rem] font-medium tracking-tight">{statusLabel}</span>
      </div>
    </div>
  );
}
