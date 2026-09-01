import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { AiSettingsLink } from "@/components/AiSettingsLink";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { EmptyStatePanel } from "@/components/EmptyStatePanel";
import { ResizeHandle } from "@script/components/resize-handle";
import { useDragResize } from "@script/hooks/use-drag-resize";
import { useSession } from "@/hooks/useSession";
import {
  createAgent,
  deleteAgent,
  fetchAgents,
  fetchEventTypes,
  patchAgent,
  runAgentNow,
  type EventTypeOption,
  type LotaruAgent,
} from "@/lib/api";
import { eventLabelWithRules } from "@/lib/event-catalog";
import { cn } from "@/lib/utils";
import {
  AgentDetailPanel,
  draftFromAgent,
  emptyAgentDraft,
  type CreateDraft,
} from "./AgentDetailPanel";

type PanelMode = "closed" | "create" | "edit";

function detailPanelWidth(open: boolean, size: number): number {
  if (open) {
    return size;
  }
  return 0;
}

export function AgentsFeature(props: { projectId: string }): React.JSX.Element {
  const session = useSession();
  const [agents, setAgents] = useState<LotaruAgent[]>([]);
  const [eventTypes, setEventTypes] = useState<EventTypeOption[]>([]);
  const [panelMode, setPanelMode] = useState<PanelMode>("closed");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CreateDraft>(emptyAgentDraft());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState("");
  const [loading, setLoading] = useState(true);
  const [viewportMaxDetail, setViewportMaxDetail] = useState(960);
  const detailResize = useDragResize({
    storageKey: "agents-workspace-detail-width",
    initial: 520,
    min: 380,
    max: viewportMaxDetail,
  });

  const load = useCallback(async (): Promise<void> => {
    if (session === null) {
      return;
    }
    const [agentData, eventTypeData] = await Promise.all([
      fetchAgents(session, props.projectId),
      fetchEventTypes(session, props.projectId),
    ]);
    setAgents(agentData.agents);
    setEventTypes(eventTypeData.eventTypes);
  }, [session, props.projectId]);

  useEffect(() => {
    void (async () => {
      try {
        await load();
        setError("");
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "load failed");
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  useEffect(() => {
    setPanelMode("closed");
    setSelectedId(null);
    setDraft(emptyAgentDraft());
    setError("");
  }, [props.projectId]);

  useEffect(() => {
    function syncMax(): void {
      setViewportMaxDetail(Math.max(480, Math.floor(window.innerWidth * 0.78)));
    }
    syncMax();
    window.addEventListener("resize", syncMax);
    return () => {
      window.removeEventListener("resize", syncMax);
    };
  }, []);

  let selectedAgent: LotaruAgent | null = null;
  if (selectedId !== null) {
    for (const agent of agents) {
      if (agent.id === selectedId) {
        selectedAgent = agent;
      }
    }
  }

  const detailOpen = panelMode !== "closed";

  function closePanel(): void {
    setPanelMode("closed");
    setSelectedId(null);
    setDraft(emptyAgentDraft());
    setError("");
  }

  function openCreate(): void {
    setPanelMode("create");
    setSelectedId(null);
    setDraft(emptyAgentDraft());
    setError("");
  }

  function selectAgent(agentId: string): void {
    if (selectedId === agentId && panelMode === "edit") {
      closePanel();
      return;
    }
    let found: LotaruAgent | null = null;
    for (const agent of agents) {
      if (agent.id === agentId) {
        found = agent;
      }
    }
    if (found === null) {
      return;
    }
    setPanelMode("edit");
    setSelectedId(agentId);
    setDraft(draftFromAgent(found));
    setError("");
  }

  async function onCreate(): Promise<void> {
    if (session === null) {
      return;
    }
    const trimmedTitle = draft.title.trim();
    const trimmedPrompt = draft.prompt.trim();
    if (trimmedTitle.length === 0 || trimmedPrompt.length === 0) {
      setError("Title and prompt are required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const created = await createAgent(session, {
        projectId: props.projectId,
        title: trimmedTitle,
        prompt: trimmedPrompt,
        trigger: draft.trigger,
        eventType: draft.trigger === "event" ? draft.eventType : undefined,
        scheduleHour: draft.trigger === "schedule" ? draft.scheduleHour : undefined,
        scheduleMinute: draft.trigger === "schedule" ? draft.scheduleMinute : undefined,
        includeVoice: draft.includeVoice,
        action: draft.action,
        noteBookTitle: draft.noteBookTitle.trim(),
        enabled: draft.enabled,
      });
      await load();
      setSelectedId(created.id);
      setPanelMode("edit");
      setDraft(draftFromAgent(created));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setSaving(false);
    }
  }

  async function onSave(): Promise<void> {
    if (session === null || selectedId === null) {
      return;
    }
    const trimmedTitle = draft.title.trim();
    const trimmedPrompt = draft.prompt.trim();
    if (trimmedTitle.length === 0 || trimmedPrompt.length === 0) {
      setError("Title and prompt are required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = await patchAgent(session, selectedId, {
        title: trimmedTitle,
        prompt: trimmedPrompt,
        trigger: draft.trigger,
        eventType: draft.trigger === "event" ? draft.eventType : "",
        scheduleHour: draft.scheduleHour,
        scheduleMinute: draft.scheduleMinute,
        includeVoice: draft.includeVoice,
        action: draft.action,
        noteBookTitle: draft.noteBookTitle.trim(),
        enabled: draft.enabled,
      });
      await load();
      setDraft(draftFromAgent(saved));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(): Promise<void> {
    if (session === null || selectedId === null) {
      return;
    }
    await deleteAgent(session, selectedId);
    closePanel();
    await load();
  }

  async function onRun(): Promise<void> {
    if (session === null || selectedId === null) {
      return;
    }
    setRunningId(selectedId);
    setError("");
    try {
      await runAgentNow(session, selectedId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "run failed");
    } finally {
      setRunningId("");
    }
  }

  // Rules and bus-writing agents both mint event types the user named.
  const mintedLabels: Record<string, string> = {};
  for (const entry of eventTypes) {
    if (entry.kind === "rule" || entry.kind === "agent") {
      mintedLabels[entry.type] = entry.label;
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Event responders"
        info="A responder runs one prompt when an event fires or at a set time each day, then turns the reply into a note, a task, an event on the bus, or nothing."
        actions={
          <div className="flex items-center gap-2">
            <AiSettingsLink />
            <Button type="button" size="sm" className="shrink-0" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              New responder
            </Button>
          </div>
        }
      />
      <div className="flex min-h-0 flex-1 overflow-hidden border-t">
      <div className="flex min-w-[280px] flex-1 flex-col px-8">
        {error.length > 0 && panelMode === "closed" ? (
          <div className="mt-3">
            <InlineErrorBanner message={error} />
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto py-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading responders…</p>
          ) : agents.length === 0 ? (
            <EmptyStatePanel
              title="No responders yet"
              description="Pick when it runs, write the prompt, choose what happens to the reply."
              action={
                <Button type="button" size="sm" onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  New responder
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  className={cn(
                    "panel-card rounded-lg p-4 text-left transition-colors hover:bg-secondary/40",
                    selectedId === agent.id && panelMode === "edit" && "ring-1 ring-primary",
                    agent.enabled !== true && "opacity-60",
                  )}
                  onClick={() => {
                    selectAgent(agent.id);
                  }}
                >
                  <p className="text-sm font-semibold">{agent.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {agent.trigger === "schedule"
                      ? `Daily at ${String(agent.scheduleHour).padStart(2, "0")}:${String(agent.scheduleMinute).padStart(2, "0")}`
                      : eventLabelWithRules(agent.eventType, mintedLabels)}
                    {agent.action === "note" ? " → note" : ""}
                    {agent.action === "task" ? " → task" : ""}
                    {agent.action === "event" ? ` → ${agent.outputEventType}` : ""}
                    {agent.includeVoice ? " · voice" : ""}
                    {agent.enabled !== true ? " · off" : ""}
                  </p>
                  <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{agent.prompt}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {detailOpen ? (
        <ResizeHandle onMouseDown={detailResize.onHandleMouseDown} active={detailResize.dragging} />
      ) : null}

      <div
        className={cn(
          "flex shrink-0 flex-col overflow-hidden bg-card/20",
          detailOpen && !detailResize.dragging && "transition-[width] duration-200 ease-out",
        )}
        style={{ width: detailPanelWidth(detailOpen, detailResize.size) }}
      >
        {detailOpen ? (
          <AgentDetailPanel
            mode={panelMode === "create" ? "create" : "edit"}
            agent={selectedAgent}
            draft={draft}
            eventTypes={eventTypes}
            saving={saving}
            running={runningId.length > 0}
            error={error}
            onDraftChange={setDraft}
            onClose={closePanel}
            onCreate={() => {
              void onCreate();
            }}
            onSave={() => {
              void onSave();
            }}
            onRun={() => {
              void onRun();
            }}
            onDelete={() => {
              void onDelete();
            }}
          />
        ) : null}
      </div>
    </div>
    </div>
  );
}
