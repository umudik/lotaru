import { Loader2, Play, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AiToolRow, EventTypeOption, LotaruAgent } from "@/lib/api";
import { ConnectedAiSelect } from "@/components/ConnectedAiSelect";
import { EventSourceSelect, eventOptionsFromCatalog } from "@/components/EventSourceSelect";

type CreateDraft = {
  title: string;
  prompt: string;
  eventType: string;
  includeVoice: boolean;
  aiToolId: string;
  enabled: boolean;
};

type Props = {
  mode: "create" | "edit";
  agent: LotaruAgent | null;
  draft: CreateDraft;
  eventTypes: EventTypeOption[];
  aiTools: AiToolRow[];
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
    options = eventOptionsFromCatalog();
  }
  const pickerOptions: EventTypeOption[] = [];
  for (const entry of options) {
    if (props.agent !== null && entry.type === props.agent.outputEventType) {
      continue;
    }
    pickerOptions.push(entry);
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-l bg-card/20">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{heading}</p>
          <p className="text-xs text-muted-foreground">Pick a connected AI</p>
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
          <ConnectedAiSelect
            id="agent-ai"
            value={props.draft.aiToolId}
            tools={props.aiTools}
            onChange={(next) => {
              props.onDraftChange(Object.assign({}, props.draft, { aiToolId: next }));
            }}
          />
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
            <Label htmlFor="agent-event">Event</Label>
            <EventSourceSelect
              id="agent-event"
              value={props.draft.eventType}
              options={pickerOptions}
              onChange={(next) => {
                props.onDraftChange(Object.assign({}, props.draft, { eventType: next }));
              }}
            />
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
              The trigger event's title and detail are appended automatically. The reply stays on
              the run. Use Lotaru MCP from the prompt to write notes, tasks, or events.
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
    eventType: "note.page.written",
    includeVoice: true,
    aiToolId: "",
    enabled: true,
  };
}

export function draftFromAgent(agent: LotaruAgent): CreateDraft {
  return {
    title: agent.title,
    prompt: agent.prompt,
    eventType: agent.eventType.length > 0 ? agent.eventType : "note.page.written",
    includeVoice: agent.includeVoice,
    aiToolId: agent.aiToolId,
    enabled: agent.enabled,
  };
}

export type { CreateDraft };
