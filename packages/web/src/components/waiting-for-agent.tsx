import { Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { AgentInfo } from '@/hooks/use-agent-connection';

const INSTALL_CMD = 'npx -y @umudik/lotaru@latest';

interface Props {
  info: AgentInfo | null;
}

export function WaitingForAgent(_props: Props): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(INSTALL_CMD);
    setCopied(true);
    window.setTimeout(() => {
      setCopied(false);
    }, 2000);
  }

  return (
    <div className="min-h-screen grid place-items-center px-6">
      <div className="w-full max-w-lg space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary grid place-items-center text-primary-foreground font-bold">
            L
          </div>
          <div>
            <div className="text-lg font-semibold tracking-tight">Lotaru</div>
            <div className="text-sm text-muted-foreground">Waiting for your local backend</div>
          </div>
        </div>

        <div className="rounded-xl border bg-card/50 p-5 space-y-3">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Projects and tasks live on the agent running on your machine. Start it in a terminal —
            sign in when asked — then this page connects automatically.
          </p>
          <div className="flex items-center gap-2 rounded-md border bg-background p-1.5 pl-3 font-mono text-sm">
            <span className="text-muted-foreground select-none">$</span>
            <code className="flex-1 truncate">{INSTALL_CMD}</code>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => {
                void copy();
              }}
              aria-label="Copy command"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Use the same Fookie account as this browser session.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-warn animate-pulse" />
          Listening for agent…
        </div>
      </div>
    </div>
  );
}
