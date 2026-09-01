import { Loader2, Play, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CATALOG_EVENT_TYPES, catalogEventLabel } from "@/lib/event-catalog";
import type { AgentAction, EventTypeOption, LotaruAgent } from "@/lib/api";

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

function actionHint(action: AgentAction): string {
  if (action === "note") {
    return "The reply is saved as a page in the note book below and emits note.page.created.";
  }
  if (action === "task") {
    return "The reply becomes a task: first line is the title, the rest is the description.";
  }
  if (action === "event") {
    return "The reply is published on the bus as this agent's own event. Scripts, agents, and doc templates can subscribe to it.";
  }
  return "The reply is kept on the run record only. Use this for agents that act through MCP.";
}

function outputEventLabel(agent: LotaruAgent | null): string {
  if (agent === null) {
    return "agent.out.<from the title>";
  }
  return agent.outputEventType;
}

type CreateDraft = {
  title: string;
  prompt: string;
  trigger: "event" | "schedule";
  eventType: string;
  scheduleHour: number;
  scheduleMinute: number;
  includeVoice: boolean;
  action: AgentAction;
  noteBookTitle: string;
  enabled: boolean;
};

type Props = {
  mode: "create" | "edit";
  agent: LotaruAgent | null;
  draft: CreateDraft;
  eventTypes: EventTypeOption[];
  saving: boolean;
  running: boolean;
  error: string;
  onDraftChange(next: CreateDraft): void;
  onClose(): void;
  onCreate(): void;
  onSave(): void;
  onRun(): void;
  onDelete(): void;
};

export function AgentDetailPanel(props: Props): React.JSX.Element {
  const heading =
    props.mode === "create" ? "New responder" : props.agent !== null ? props.agent.title : "Responder";

  let options = props.eventTypes;
  if (options.length === 0) {
    options = CATALOG_EVENT_TYPES.map((type) => ({
      type,
      label: "",
      kind: "platform" as const,
    }));
  }
  const ruleOptions = options.filter((entry) => entry.kind === "rule");
  // An agent listening to itself is the one subscription the bus refuses, so it
  // is not offered in the first place.
  const agentOptions = options.filter((entry) => {
    if (entry.kind !== "agent") {
      return false;
    }
    if (props.agent === null) {
      return true;
    }
    return entry.type !== props.agent.outputEventType;
  });
  const platformOptions = options.filter((entry) => entry.kind === "platform");

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-l bg-card/20">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{heading}</p>
          <p className="text-xs text-muted-foreground">Shared AI</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={props.onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2">
            <div>
              <p className="text-sm font-medium">Enabled</p>
              <p className="text-xs text-muted-foreground">Listen for the trigger below when on</p>
            </div>
            <Switch
              checked={props.draft.enabled}
              onCheckedChange={(checked) => {
                props.onDraftChange(Object.assign({}, props.draft, { enabled: checked }));
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="agent-title">Title</Label>
            <Input
              id="agent-title"
              value={props.draft.title}
              onChange={(event) => {
                props.onDraftChange(Object.assign({}, props.draft, { title: event.target.value }));
              }}
              placeholder="Daily journal"
            />
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              1 · When
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="agent-trigger">Trigger</Label>
                <Select
                  id="agent-trigger"
                  value={props.draft.trigger}
                  onChange={(event) => {
                    if (event.target.value === "event" || event.target.value === "schedule") {
                      props.onDraftChange(
                        Object.assign({}, props.draft, { trigger: event.target.value }),
                      );
                    }
                  }}
                >
                  <option value="schedule">Daily schedule</option>
                  <option value="event">Event</option>
                </Select>
              </div>
              {props.draft.trigger === "event" ? (
                <div className="space-y-1">
                  <Label htmlFor="agent-event">Event</Label>
                  <Select
                    id="agent-event"
                    value={props.draft.eventType}
                    onChange={(event) => {
                      props.onDraftChange(
                        Object.assign({}, props.draft, { eventType: event.target.value }),
                      );
                    }}
                  >
                    {ruleOptions.length > 0 ? (
                      <optgroup label="Extractors">
                        {ruleOptions.map((entry) => (
                          <option key={entry.type} value={entry.type}>
                            {entry.label.length > 0 ? entry.label : entry.type}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {agentOptions.length > 0 ? (
                      <optgroup label="Responders">
                        {agentOptions.map((entry) => (
                          <option key={entry.type} value={entry.type}>
                            {entry.label.length > 0 ? entry.label : entry.type}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    <optgroup label="Platform">
                      {platformOptions.map((entry) => (
                        <option key={entry.type} value={entry.type}>
                          {entry.label.length > 0 ? entry.label : catalogEventLabel(entry.type)}
                        </option>
                      ))}
                    </optgroup>
                  </Select>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="agent-hour">Hour</Label>
                    <Select
                      id="agent-hour"
                      value={String(props.draft.scheduleHour)}
                      onChange={(event) => {
                        props.onDraftChange(
                          Object.assign({}, props.draft, {
                            scheduleHour: Number(event.target.value),
                          }),
                        );
                      }}
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
                      value={String(props.draft.scheduleMinute)}
                      onChange={(event) => {
                        props.onDraftChange(
                          Object.assign({}, props.draft, {
                            scheduleMinute: Number(event.target.value),
                          }),
                        );
                      }}
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
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              2 · Ask
            </p>
            <Label htmlFor="agent-prompt">Prompt</Label>
            <textarea
              id="agent-prompt"
              className="min-h-[160px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={props.draft.prompt}
              onChange={(event) => {
                props.onDraftChange(Object.assign({}, props.draft, { prompt: event.target.value }));
              }}
              placeholder="Read today's voice transcripts and write a short daily journal."
            />
            <p className="text-[11px] text-muted-foreground">
              The trigger event's title and detail are appended to the prompt automatically.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2">
            <div>
              <p className="text-sm font-medium">Include voice transcripts</p>
              <p className="text-xs text-muted-foreground">Inject recent segments into the prompt</p>
            </div>
            <Switch
              checked={props.draft.includeVoice}
              onCheckedChange={(checked) => {
                props.onDraftChange(Object.assign({}, props.draft, { includeVoice: checked }));
              }}
            />
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              3 · Then
            </p>
            <Label htmlFor="agent-action">Do with the reply</Label>
            <Select
              id="agent-action"
              value={props.draft.action}
              onChange={(event) => {
                const value = event.target.value;
                if (
                  value === "none" ||
                  value === "note" ||
                  value === "task" ||
                  value === "event"
                ) {
                  props.onDraftChange(Object.assign({}, props.draft, { action: value }));
                }
              }}
            >
              <option value="none">Just record the run</option>
              <option value="note">Write a note page</option>
              <option value="task">Create a task</option>
              <option value="event">Publish an event</option>
            </Select>
            <p className="text-[11px] text-muted-foreground">{actionHint(props.draft.action)}</p>
          </div>

          {props.draft.action === "event" ? (
            <div className="space-y-1">
              <Label>Event it publishes</Label>
              <p className="rounded-md border border-white/[0.08] bg-white/[0.02] px-3 py-2 font-mono text-xs text-foreground">
                {outputEventLabel(props.agent)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {props.agent === null
                  ? "Minted from the title when the agent is created, and it never moves afterwards."
                  : "Fixed for the life of the agent, so renaming never strands a subscriber."}
              </p>
            </div>
          ) : null}

          {props.draft.action === "note" ? (
            <div className="space-y-1">
              <Label htmlFor="agent-book">Note book title</Label>
              <Input
                id="agent-book"
                value={props.draft.noteBookTitle}
                onChange={(event) => {
                  props.onDraftChange(
                    Object.assign({}, props.draft, { noteBookTitle: event.target.value }),
                  );
                }}
                placeholder="Daily journal"
              />
              <p className="text-[11px] text-muted-foreground">
                Created on first use. Leave empty to use the agent title.
              </p>
            </div>
          ) : null}
        </div>

        {props.error.length > 0 ? (
          <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {props.error}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t px-4 py-3">
        {props.mode === "create" ? (
          <>
            <Button type="button" variant="ghost" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={props.onCreate} disabled={props.saving}>
              {props.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="ghost" onClick={props.onDelete}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
            <Button type="button" variant="secondary" onClick={props.onRun} disabled={props.running}>
              {props.running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Run
            </Button>
            <Button type="button" onClick={props.onSave} disabled={props.saving}>
              {props.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function emptyAgentDraft(): CreateDraft {
  return {
    title: "",
    prompt: "",
    trigger: "schedule",
    eventType: "note.page.written",
    scheduleHour: 21,
    scheduleMinute: 0,
    includeVoice: true,
    action: "none",
    noteBookTitle: "",
    enabled: true,
  };
}

export function draftFromAgent(agent: LotaruAgent): CreateDraft {
  return {
    title: agent.title,
    prompt: agent.prompt,
    trigger: agent.trigger,
    eventType: agent.eventType.length > 0 ? agent.eventType : "note.page.written",
    scheduleHour: agent.scheduleHour,
    scheduleMinute: agent.scheduleMinute,
    includeVoice: agent.includeVoice,
    action: agent.action,
    noteBookTitle: agent.noteBookTitle,
    enabled: agent.enabled,
  };
}

export type { CreateDraft };
