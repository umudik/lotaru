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
import { getAccessToken, signInUrl } from '@/lib/config';

interface AgentStatus {
  online: boolean;
  info: { hostname: string; version: string; connectedAt: number } | null;
}

export function AgentsView(): React.JSX.Element {
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
        setAgent((await res.json()) as AgentStatus);
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
        <CardHeader>
          <CardTitle className="text-base">Register a local agent</CardTitle>
          <CardDescription>
            The agent stays on your machine and runs shell or Docker tasks. Sign in locally with the
            same Fookie account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CopyCommand />
          <Button
            size="sm"
            onClick={() => {
              void signInUrl().then((url) => {
                location.href = url;
              });
            }}
          >
            Sign in on console
          </Button>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Agent</TableHead>
              <TableHead>Host</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agent.online && agent.info !== null ? (
              <TableRow>
                <TableCell className="font-medium">default</TableCell>
                <TableCell>{agent.info.hostname}</TableCell>
                <TableCell>{agent.info.version}</TableCell>
                <TableCell>
                  <Badge variant="success">Online</Badge>
                </TableCell>
              </TableRow>
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  No agents yet. Start Lotaru locally, then sign in.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
