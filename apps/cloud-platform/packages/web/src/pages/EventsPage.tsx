import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageContent } from "@/components/layout/PageContent";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { useSession } from "@/hooks/useSession";
import {
  CATALOG_EVENT_TYPES,
  catalogEventLabel,
  eventLabelWithRules,
  isClockCatalogEvent,
  isVoiceRuleEvent,
} from "@/lib/event-catalog";
import {
  fetchEventTypes,
  fetchProjectEvents,
  replayProjectEvent,
  type EventTypeOption,
  type LotaruEventListener,
  type LotaruEventRow,
} from "@/lib/api";
import { cn, formatAge, formatMillis } from "@/lib/utils";

type EventFact = {
  label: string;
  value: string;
};

type EventCluster = {
  id: string;
  head: LotaruEventRow;
  count: number;
  oldestAt: number;
};

function clusterEvents(rows: LotaruEventRow[]): EventCluster[] {
  const clusters: EventCluster[] = [];
  for (const row of rows) {
    const prev = clusters[clusters.length - 1];
    if (
      prev !== undefined &&
      isClockCatalogEvent(prev.head.type) &&
      isClockCatalogEvent(row.type)
    ) {
      prev.count += 1;
      prev.oldestAt = row.createdAt;
      continue;
    }
    clusters.push({
      id: row.id,
      head: row,
      count: 1,
      oldestAt: row.createdAt,
    });
  }
  return clusters;
}

function pathFactLabel(eventType: string): string {
  if (eventType.startsWith("github.")) {
    return "Repository";
  }
  if (isVoiceRuleEvent(eventType)) {
    return "Matched";
  }
  return "Path";
}

function detailFactLabel(eventType: string): string {
  if (eventType.startsWith("github.")) {
    return "Pull request";
  }
  if (eventType === "file.changed") {
    return "Change";
  }
  if (eventType === "app.started") {
    return "Reason";
  }
  if (isVoiceRuleEvent(eventType)) {
    return "What was asked";
  }
  return "Detail";
}

function eventTextField(raw: string | null | undefined): string {
  if (typeof raw === "string") {
    return raw;
  }
  return "";
}

function eventListeners(raw: LotaruEventListener[] | null | undefined): LotaruEventListener[] {
  if (Array.isArray(raw) !== true) {
    return [];
  }
  const listeners: LotaruEventListener[] = [];
  for (const entry of raw) {
    if (entry === null || entry === undefined) {
      continue;
    }
    if (typeof entry !== "object") {
      continue;
    }
    const kind = entry.kind;
    const id = entry.id;
    const label = entry.label;
    if (kind !== "script" && kind !== "agent" && kind !== "knowledge") {
      continue;
    }
    if (typeof id !== "string" || id.length === 0) {
      continue;
    }
    if (typeof label !== "string") {
      continue;
    }
    listeners.push({ kind, id, label });
  }
  return listeners;
}

function eventFacts(cluster: EventCluster): EventFact[] {
  const event = cluster.head;
  const path = eventTextField(event.path);
  const detail = eventTextField(event.detail);
  const scriptId = eventTextField(event.scriptId);
  const facts: EventFact[] = [
    { label: "When", value: formatMillis(event.createdAt) },
    { label: "Age", value: formatAge(event.createdAt) },
  ];
  if (cluster.count > 1) {
    facts.push({
      label: "Span",
      value: `${formatMillis(cluster.oldestAt)} → ${formatMillis(event.createdAt)}`,
    });
    facts.push({ label: "Ticks", value: String(cluster.count) });
  }
  if (isClockCatalogEvent(event.type)) {
    facts.push({ label: "Interval", value: "Every 10 seconds, every project" });
  }
  if (path.length > 0) {
    facts.push({ label: pathFactLabel(event.type), value: path });
  }
  if (detail.length > 0) {
    let detailValue = detail;
    if (event.type.startsWith("github.")) {
      detailValue = `#${detail}`;
    }
    facts.push({ label: detailFactLabel(event.type), value: detailValue });
  }
  if (scriptId.length > 0) {
    facts.push({ label: "Target script", value: scriptId });
  }
  facts.push({ label: "Event id", value: event.id });
  facts.push({ label: "Event type", value: event.type });
  return facts;
}

function listenerHref(projectId: string, listener: LotaruEventListener): string {
  if (listener.kind === "script") {
    return `/projects/${projectId}/scripts`;
  }
  if (listener.kind === "knowledge") {
    return `/projects/${projectId}/knowledge/documentation/templates`;
  }
  return `/projects/${projectId}/agents`;
}

function listenerKindLabel(kind: LotaruEventListener["kind"]): string {
  if (kind === "script") {
    return "Script";
  }
  if (kind === "agent") {
    return "Agent";
  }
  return "Doc template";
}

function eventTypeFilterFromQuery(raw: string | null): string {
  if (raw === null) {
    return "";
  }
  if (isVoiceRuleEvent(raw)) {
    return raw;
  }
  for (const catalogType of CATALOG_EVENT_TYPES) {
    if (catalogType === raw) {
      return catalogType;
    }
  }
  return "";
}

const EVENT_PAGE_SIZE = 40;

export function EventsPage(): React.JSX.Element {
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  let projectId = "";
  if (typeof params["projectId"] === "string" && params["projectId"].length > 0) {
    projectId = params["projectId"];
  }
  const session = useSession();
  const [events, setEvents] = useState<LotaruEventRow[]>([]);
  const [eventTypes, setEventTypes] = useState<EventTypeOption[]>([]);
  const [nextCursors, setNextCursors] = useState<string[]>([]);
  const typeFilter = eventTypeFilterFromQuery(searchParams.get("type"));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [replayingId, setReplayingId] = useState("");
  const nextRef = useRef<string[]>([]);
  const pagedRef = useRef(false);

  useEffect(() => {
    if (session === null || projectId.length === 0) {
      return;
    }
    void fetchEventTypes(session, projectId)
      .then((data) => {
        setEventTypes(data.eventTypes);
      })
      .catch(() => {
        setEventTypes([]);
      });
  }, [session, projectId]);

  const loadFirstPage = useCallback(
    async (silent: boolean): Promise<void> => {
      if (session === null || projectId.length === 0) {
        return;
      }
      if (silent !== true) {
        setLoading(true);
      }
      try {
        const data = await fetchProjectEvents(session, projectId, {
          limit: EVENT_PAGE_SIZE,
          cursor: "",
          type: typeFilter,
        });
        setEvents(Array.isArray(data.events) ? data.events : []);
        const nextPage = Array.isArray(data.next) ? data.next : [];
        nextRef.current = nextPage;
        setNextCursors(nextPage);
        if (silent !== true) {
          pagedRef.current = false;
        }
        setError("");
      } catch (err: unknown) {
        if (silent) {
          return;
        }
        if (err instanceof Error) {
          setError(err.message);
          return;
        }
        setError("Failed to load events");
      } finally {
        if (silent !== true) {
          setLoading(false);
        }
      }
    },
    [session, projectId, typeFilter],
  );

  async function loadMore(): Promise<void> {
    if (session === null || projectId.length === 0) {
      return;
    }
    const cursor = nextRef.current[0];
    if (cursor === undefined) {
      return;
    }
    setLoadingMore(true);
    try {
      const data = await fetchProjectEvents(session, projectId, {
        limit: EVENT_PAGE_SIZE,
        cursor,
        type: typeFilter,
      });
      const page = Array.isArray(data.events) ? data.events : [];
      const nextPage = Array.isArray(data.next) ? data.next : [];
      setEvents((current) => current.concat(page));
      nextRef.current = nextPage;
      setNextCursors(nextPage);
      pagedRef.current = true;
      setError("");
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to load events");
      }
    } finally {
      setLoadingMore(false);
    }
  }

  useAutoRefresh(
    useCallback(
      (silent: boolean) => {
        if (silent && pagedRef.current) {
          return;
        }
        void loadFirstPage(silent);
      },
      [loadFirstPage],
    ),
    { enabled: session !== null && projectId.length > 0, intervalMs: 300_000 },
  );

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
      toast.success("Replayed through current listeners");
      await loadFirstPage(true);
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

  const clusters = clusterEvents(events);
  const ruleTypes = eventTypes.filter((entry) => entry.kind === "rule");
  const agentTypes = eventTypes.filter((entry) => entry.kind === "agent");
  const mintedLabels: Record<string, string> = {};
  for (const entry of eventTypes) {
    if (entry.kind === "rule" || entry.kind === "agent") {
      mintedLabels[entry.type] = entry.label;
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Events"
        info="What happened in this project."
        actions={
          <div className="flex items-center gap-2">
            <Label htmlFor="event-type-filter" className="sr-only">
              Type
            </Label>
            <Select
              id="event-type-filter"
              className="h-9 w-[14rem]"
              value={typeFilter}
              onChange={(event) => {
                pagedRef.current = false;
                const nextType = event.target.value;
                setSearchParams(
                  (current) => {
                    const next = new URLSearchParams(current);
                    if (nextType.length === 0) {
                      next.delete("type");
                    } else {
                      next.set("type", nextType);
                    }
                    return next;
                  },
                  { replace: true },
                );
              }}
            >
              <option value="">All types</option>
              {ruleTypes.length > 0 ? (
                <optgroup label="Extractors">
                  {ruleTypes.map((entry) => (
                    <option key={entry.type} value={entry.type}>
                      {entry.label.length > 0 ? entry.label : entry.type}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {agentTypes.length > 0 ? (
                <optgroup label="Responders">
                  {agentTypes.map((entry) => (
                    <option key={entry.type} value={entry.type}>
                      {entry.label.length > 0 ? entry.label : entry.type}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label="Platform">
                {CATALOG_EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {catalogEventLabel(type)}
                  </option>
                ))}
              </optgroup>
            </Select>
          </div>
        }
      />
      <PageContent className="overflow-y-auto">
        {error.length > 0 ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}
        {loading && events.length === 0 ? (
          <div className="space-y-3">
            <Skeleton className="h-36 rounded-2xl" />
            <Skeleton className="h-36 rounded-2xl" />
            <Skeleton className="h-36 rounded-2xl" />
          </div>
        ) : events.length === 0 ? (
          <div className="panel-card px-6 py-16 text-center">
            <p className="text-sm font-medium">
              {typeFilter.length > 0 ? "No events match this type." : "No events recorded yet."}
            </p>
          </div>
        ) : (
          <>
          <ul className="space-y-3">
            {clusters.map((cluster) => {
              const facts = eventFacts(cluster);
              const listeners = eventListeners(cluster.head.listeners);
              return (
                <li key={cluster.id} className="panel-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-semibold tracking-tight">
                          {eventLabelWithRules(cluster.head.type, mintedLabels)}
                        </h2>
                        {cluster.count > 1 ? (
                          <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium tabular-nums">
                            {cluster.count} ticks
                          </span>
                        ) : null}
                        {isVoiceRuleEvent(cluster.head.type) ? (
                          <Link
                            className="text-[11px] text-muted-foreground underline underline-offset-2"
                            to={`/projects/${projectId}/rules`}
                          >
                            Open extractors
                          </Link>
                        ) : null}
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">{cluster.head.type}</p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={replayingId.length > 0 || cluster.head.replayable !== true}
                      onClick={() => {
                        void replay(cluster.head.id);
                      }}
                    >
                      {replayingId === cluster.head.id ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Replaying
                        </>
                      ) : (
                        "Replay"
                      )}
                    </Button>
                  </div>
                  <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
                    {facts.map((fact) => (
                      <div key={`${cluster.id}-${fact.label}`} className="min-w-0">
                        <dt className="text-[11px] text-muted-foreground">{fact.label}</dt>
                        <dd
                          className={cn(
                            "mt-0.5 truncate text-sm",
                            fact.label === "Event type" || fact.label === "Event id"
                              ? "font-mono text-xs"
                              : null,
                          )}
                        >
                          {fact.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-4 border-t border-white/[0.06] pt-3">
                    <p className="text-[11px] text-muted-foreground">Listeners</p>
                    {listeners.length === 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        None. Add a listener on{" "}
                        <Link
                          className="underline underline-offset-2"
                          to={`/projects/${projectId}/agents`}
                        >
                          Event responders
                        </Link>{" "}
                        or{" "}
                        <Link
                          className="underline underline-offset-2"
                          to={`/projects/${projectId}/scripts`}
                        >
                          Scripts
                        </Link>
                        .
                      </p>
                    ) : (
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {listeners.map((listener) => (
                          <li key={`${listener.kind}-${listener.id}`}>
                            <Link
                              to={listenerHref(projectId, listener)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-2 py-1 text-[11px] hover:border-white/[0.16]"
                            >
                              <span className="text-muted-foreground">
                                {listenerKindLabel(listener.kind)}
                              </span>
                              <span className="max-w-[14rem] truncate">{listener.label}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {nextCursors.length > 0 ? (
            <div className="mt-4 flex justify-center">
              <Button
                type="button"
                variant="outline"
                disabled={loadingMore}
                onClick={() => {
                  void loadMore();
                }}
              >
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {loadingMore ? "Loading" : "Load older"}
              </Button>
            </div>
          ) : null}
          </>
        )}
      </PageContent>
    </div>
  );
}
