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
  let statusLabel = 'Waiting for agent';
  if (online) {
    const host = props.agentInfo?.hostname;
    statusLabel = host !== undefined && host.length > 0 ? host : 'Agent connected';
  }

  return (
    <div className="sticky top-0 z-30 flex h-10 items-center justify-between gap-3 border-b border-border/60 bg-background/85 px-4 backdrop-blur-md">
      <FookieCloudMark size="sm" />
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span
          className={
            online
              ? 'inline-block h-1.5 w-1.5 rounded-full bg-success'
              : 'inline-block h-1.5 w-1.5 rounded-full bg-warn animate-pulse'
          }
        />
        <span className="truncate max-w-[14rem]">{statusLabel}</span>
      </div>
    </div>
  );
}
