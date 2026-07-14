import { useEffect, useState } from 'react';
import { CopyCommand } from '@/components/copy-command';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getAccessToken, getUser, signInUrl } from '@/lib/config';

interface AgentStatus {
  online: boolean;
  info: { hostname: string; version: string; connectedAt: number } | null;
}

export function HomeView(): React.JSX.Element {
  const user = getUser();
  const [agent, setAgent] = useState<AgentStatus>({ online: false, info: null });

  useEffect(() => {
    const token = getAccessToken();
    if (token === null) {
      return;
    }
    let cancelled = false;
    async function tick(): Promise<void> {
      try {
        const res = await fetch('/v1/agent/status', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) {
          return;
        }
        const data = (await res.json()) as AgentStatus;
        setAgent(data);
      } catch {
        void 0;
      }
    }
    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Local agent</CardTitle>
            <CardDescription>
              Run the Lotaru agent on your machine with the same Fookie account as this console.
            </CardDescription>
          </div>
          <Badge variant={agent.online ? 'success' : 'warn'}>
            {agent.online ? 'Connected' : 'Not connected'}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <CopyCommand />
          {user === null ? (
            <Button
              onClick={() => {
                void signInUrl().then((url) => {
                  location.href = url;
                });
              }}
            >
              Sign in with Fookie
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Signed in as {user.email ?? user.id}
              {agent.online && agent.info !== null
                ? ` · agent ${agent.info.hostname} v${agent.info.version}`
                : ' · waiting for agent'}
            </p>
          )}
        </CardContent>
      </Card>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium">Projects</h2>
          <span className="text-xs text-muted-foreground">
            {agent.online ? 'Loaded from your agent' : 'Connect an agent to load yours'}
          </span>
        </div>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Path</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                  {agent.online
                    ? 'Open Tasks after agent sync lands workspaces here.'
                    : 'No agent online. Run npx @umudik/lotaru and sign in.'}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
