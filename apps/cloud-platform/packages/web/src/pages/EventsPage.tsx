import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProjectReactionsPanel } from "@/components/ProjectReactionsPanel";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/useSession";
import { fetchProjectEvents, replayProjectEvent, type LotaruEventRow } from "@/lib/api";

export function EventsPage(): React.JSX.Element {
  const { projectId = "" } = useParams();
  const session = useSession();
  const [events, setEvents] = useState<LotaruEventRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [replayingId, setReplayingId] = useState("");

  const load = useCallback(async (): Promise<void> => {
    if (session === null || projectId.length === 0) {
      return;
    }
    const data = await fetchProjectEvents(session, projectId, 80);
    setEvents(data.events);
  }, [session, projectId]);

  useEffect(() => {
    void load()
      .catch((err: unknown) => {
        if (err instanceof Error) {
          setError(err.message);
          return;
        }
        setError("load failed");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [load]);

  async function replay(eventId: string): Promise<void> {
    if (session === null) {
      return;
    }
    if (replayingId.length > 0) {
      return;
    }
    setReplayingId(eventId);
    try {
      await replayProjectEvent(session, projectId, eventId);
      toast.success("Event replayed through current listeners");
      await load();
    } catch (err: unknown) {
      if (err instanceof Error) {
        toast.error(err.message);
      } else {
        toast.error("Replay failed");
      }
    } finally {
      setReplayingId("");
    }
  }

  if (projectId.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">Open a project to see events.</p>;
  }

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="Events"
        subtitle="Catalog events are always present. Replay runs the current listeners, not a frozen snapshot."
      />
      {error.length > 0 ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? (
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No events yet.</p>
      ) : (
        <ul className="space-y-2">
          {events.map((event) => (
            <li key={event.id} className="panel-card flex items-start justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-medium">{event.type}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {event.path} {event.detail.length > 0 ? `· ${event.detail}` : ""}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={replayingId.length > 0}
                onClick={() => {
                  void replay(event.id);
                }}
              >
                {replayingId === event.id ? "Replaying…" : "Replay"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ProjectReactionsPanel projectId={projectId} />
    </div>
  );
}
