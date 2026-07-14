import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const sample = [
  { name: 'build-api', project: 'my-app', trigger: 'on save', last: '—' },
  { name: 'lint', project: 'my-app', trigger: 'manual', last: '—' },
  { name: 'scan', project: 'api', trigger: 'schedule', last: '—' },
] as const;

export function TasksView(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Tasks load from your connected agent. Placeholders show the shape of the console.
      </p>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Task</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Last run</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sample.map((t) => (
              <TableRow key={t.name}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell>{t.project}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{t.trigger}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{t.last}</TableCell>
                <TableCell>
                  <Badge variant="outline">Offline</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
