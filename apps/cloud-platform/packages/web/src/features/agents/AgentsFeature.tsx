import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Play, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSession } from "@/hooks/useSession";
import {
  createAgent,
  deleteAgent,
  fetchAgents,
  runAgentNow,
  type LotaruAgent,
} from "@/lib/api";
import { CATALOG_EVENT_TYPES, catalogEventLabel } from "@/lib/event-catalog";
import { cn } from "@/lib/utils";

function hourOptions(): number[] {
  const hours: number[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    hours.push(hour);
  }
  return hours;
}

function minuteOptions(): number[] {
  return [0, 15, 30, 45];
}

export function AgentsFeature(props: { projectId: string }): React.JSX.Element {
  const session = useSession();
  const [agents, setAgents] = useState<LotaruAgent[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [trigger, setTrigger] = useState<"event" | "schedule">("schedule");
  const [eventType, setEventType] = useState("note.page.written");
  const [scheduleHour, setScheduleHour] = useState(21);
  const [scheduleMinute, setScheduleMinute] = useState(0);
  const [includeVoice, setIncludeVoice] = useState(true);
  const [noteBookTitle, setNoteBookTitle] = useState("Günlük");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState("");

    const load = useCallback(async (): Promise<void> => {
    if (session === null) {
      return;
    }
    const data = await fetchAgents(session, props.projectId);
    setAgents(data.agents);
  }, [session, props.projectId]);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "load failed");
    });
  }, [load]);

  function closeCreate(): void {
    setCreateOpen(false);
    setTitle("");
    setPrompt("");
    setError("");
  }

  async function onCreate(): Promise<void> {
    if (session === null) {
      return;
    }
    const trimmedTitle = title.trim();
    const trimmedPrompt = prompt.trim();
    if (trimmedTitle.length === 0 || trimmedPrompt.length === 0) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createAgent(session, {
        projectId: props.projectId,
        title: trimmedTitle,
        prompt: trimmedPrompt,
        trigger,
        eventType: trigger === "event" ? eventType : undefined,
        scheduleHour: trigger === "schedule" ? scheduleHour : undefined,
        scheduleMinute: trigger === "schedule" ? scheduleMinute : undefined,
        includeVoice,
        noteBookTitle: noteBookTitle.trim(),
        enabled: true,
      });
      closeCreate();
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(agentId: string): Promise<void> {
    if (session === null) {
      return;
    }
    await deleteAgent(session, agentId);
    await load();
  }

  async function onRun(agentId: string): Promise<void> {
    if (session === null) {
      return;
    }
    setRunningId(agentId);
    setError("");
    try {
      await runAgentNow(session, agentId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "run failed");
    } finally {
      setRunningId("");
    }
  }

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="Agents"
        subtitle="Prompt + daily schedule or event. Optional voice context and note book write."
        actions={
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            New agent
          </Button>
        }
      />

      {error.length > 0 ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}

      {createOpen ? (
        <div className="panel-card space-y-3 p-4">
          <div className="space-y-1">
            <Label htmlFor="agent-title">Title</Label>
            <Input
              id="agent-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Daily journal"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="agent-prompt">Prompt</Label>
            <textarea
              id="agent-prompt"
              className="min-h-[120px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Read today's voice transcripts and write a short daily journal."
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="agent-trigger">Trigger</Label>
              <Select
                id="agent-trigger"
                value={trigger}
                onChange={(event) => {
                  if (event.target.value === "event" || event.target.value === "schedule") {
                    setTrigger(event.target.value);
                  }
                }}
              >
                <option value="schedule">Daily schedule</option>
                <option value="event">Event</option>
              </Select>
            </div>
            {trigger === "event" ? (
              <div className="space-y-1">
                <Label htmlFor="agent-event">Event</Label>
                <Select
                  id="agent-event"
                  value={eventType}
                  onChange={(event) => setEventType(event.target.value)}
                >
                  {CATALOG_EVENT_TYPES.map((entry) => (
                    <option key={entry} value={entry}>
                      {catalogEventLabel(entry)}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="agent-hour">Hour</Label>
                  <Select
                    id="agent-hour"
                    value={String(scheduleHour)}
                    onChange={(event) => setScheduleHour(Number(event.target.value))}
                  >
                    {hourOptions().map((hour) => (
                      <option key={hour} value={hour}>
                        {String(hour).padStart(2, "0")}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="agent-minute">Minute</Label>
                  <Select
                    id="agent-minute"
                    value={String(scheduleMinute)}
                    onChange={(event) => setScheduleMinute(Number(event.target.value))}
                  >
                    {minuteOptions().map((minute) => (
                      <option key={minute} value={minute}>
                        {String(minute).padStart(2, "0")}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2">
            <div>
              <p className="text-sm font-medium">Include voice transcripts</p>
              <p className="text-xs text-muted-foreground">Inject recent segments into the prompt</p>
            </div>
            <Switch checked={includeVoice} onCheckedChange={setIncludeVoice} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="agent-book">Note book title</Label>
            <Input
              id="agent-book"
              value={noteBookTitle}
              onChange={(event) => setNoteBookTitle(event.target.value)}
              placeholder="Günlük"
            />
            <p className="text-[11px] text-muted-foreground">
              If set, agent output becomes a page in this book and emits note.page.written.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={closeCreate}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void onCreate()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create
            </Button>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        {agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No agents yet. Create one for a daily journal or an event-driven workflow.
          </p>
        ) : null}
        {agents.map((agent) => (
          <div
            key={agent.id}
            className={cn(
              "panel-card flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between",
              agent.enabled !== true && "opacity-60",
            )}
          >
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-semibold">{agent.title}</p>
              <p className="text-xs text-muted-foreground">
                {agent.trigger === "schedule"
                  ? `Daily at ${String(agent.scheduleHour).padStart(2, "0")}:${String(agent.scheduleMinute).padStart(2, "0")}`
                  : catalogEventLabel(agent.eventType)}
                {agent.includeVoice ? " · voice" : ""}
                {agent.noteBookTitle.length > 0 ? ` · notes → ${agent.noteBookTitle}` : ""}
              </p>
              <p className="line-clamp-3 text-sm text-muted-foreground">{agent.prompt}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void onRun(agent.id)}
                disabled={runningId === agent.id}
              >
                {runningId === agent.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Run
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => void onDelete(agent.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
