import { EventSourceMark, eventSourceOf } from "@/components/EventSourceSelect";
import type { EventTypeOption } from "@/lib/api";
import { catalogEventLabel } from "@/lib/event-catalog";

type EventTypeRow = {
  type: string;
  label: string;
  kind: string;
  sourceId: string;
  sourceLabel: string;
};

export function EventTypesTable(props: {
  rows: readonly EventTypeRow[];
  includeKind: boolean;
}): React.JSX.Element {
  if (props.rows.length === 0) {
    return <p className="text-xs text-muted-foreground">No event types yet.</p>;
  }
  return (
    <div className="max-h-64 overflow-auto rounded-md border border-border/70">
      <table className="w-full caption-bottom text-xs">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border/70 text-left text-muted-foreground">
            <th className="px-3 py-2 font-medium">Source</th>
            {props.includeKind ? <th className="px-3 py-2 font-medium">Kind</th> : null}
            <th className="px-3 py-2 font-medium">Event</th>
            <th className="px-3 py-2 font-medium">Type</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => {
            const option: EventTypeOption = {
              type: row.type,
              label: row.label,
              kind: row.kind === "rule" || row.kind === "agent" || row.kind === "connection" ? row.kind : "platform",
              sourceId: row.sourceId,
              sourceLabel: row.sourceLabel,
            };
            const source = eventSourceOf(option);
            const label = row.label.length > 0 ? row.label : catalogEventLabel(row.type);
            return (
              <tr key={row.type} className="border-b border-border/50 last:border-0">
                <td className="px-3 py-1.5">
                  <span className="flex items-center gap-2">
                    <EventSourceMark sourceId={source.id} sourceLabel={source.label} size="sm" />
                    <span className="text-foreground">{source.label}</span>
                  </span>
                </td>
                {props.includeKind ? (
                  <td className="px-3 py-1.5 capitalize text-muted-foreground">{row.kind}</td>
                ) : null}
                <td className="px-3 py-1.5 text-foreground">{label}</td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground">{row.type}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
