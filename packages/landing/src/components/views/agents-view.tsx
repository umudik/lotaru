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
import { signInUrl } from '@/lib/config';

export function AgentsView(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Register a local agent</CardTitle>
          <CardDescription>
            The agent stays on your machine and runs shell or Docker tasks. The console only talks
            to agents signed in as you.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CopyCommand />
          <Button size="sm" asChild>
            <a href={signInUrl()}>Authenticate agent</a>
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
            <TableRow>
              <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                No agents yet. Start Lotaru locally, then sign in.
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">Shell</Badge>
        <Badge variant="outline">Docker</Badge>
        <span>Terminal control comes next.</span>
      </div>
    </div>
  );
}
