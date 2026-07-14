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

const demoProjects = [
  { name: 'my-app', path: '~/projects/my-app', tasks: 4, status: 'disconnected' },
  { name: 'api', path: '~/work/api', tasks: 7, status: 'disconnected' },
] as const;

export function HomeView(): React.JSX.Element {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Local agent</CardTitle>
            <CardDescription>
              Run the Lotaru agent on your machine, then sign in so this console can reach it.
            </CardDescription>
          </div>
          <Badge variant="warn">Not connected</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <CopyCommand />
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild>
              <a href={signInUrl()}>Sign in with Fookie</a>
            </Button>
            <p className="text-xs text-muted-foreground">
              Opens <code className="font-mono text-foreground/80">127.0.0.1:4317</code> · data in{' '}
              <code className="font-mono text-foreground/80">~/.lotaru/</code>
            </p>
          </div>
        </CardContent>
      </Card>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium">Projects</h2>
          <span className="text-xs text-muted-foreground">Connect an agent to load yours</span>
        </div>
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Path</TableHead>
                <TableHead>Tasks</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {demoProjects.map((p) => (
                <TableRow key={p.name}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{p.path}</TableCell>
                  <TableCell>{p.tasks}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">Disconnected</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
