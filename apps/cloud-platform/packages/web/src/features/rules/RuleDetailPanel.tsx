import { Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { EventSubscriber, VoiceRule } from "@/lib/api";

export type RuleDraft = {
  name: string;
  instruction: string;
  enabled: boolean;
};

type Props = {
  mode: "create" | "edit";
  rule: VoiceRule | null;
  draft: RuleDraft;
  saving: boolean;
  error: string;
  subscribers: EventSubscriber[];
  onDraftChange(next: RuleDraft): void;
  onClose(): void;
  onCreate(): void;
  onSave(): void;
  onDelete(): void;
};

export function RuleDetailPanel(props: Props): React.JSX.Element {
  const heading =
    props.mode === "create" ? "New extractor" : props.rule !== null ? props.rule.name : "Extractor";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-l bg-card/20">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
        <p className="truncate text-sm font-semibold">{heading}</p>
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
            <p className="text-sm font-medium">Enabled</p>
            <Switch
              checked={props.draft.enabled}
              onCheckedChange={(checked) => {
                props.onDraftChange(Object.assign({}, props.draft, { enabled: checked }));
              }}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="rule-name">Name</Label>
            <Input
              id="rule-name"
              value={props.draft.name}
              onChange={(event) => {
                props.onDraftChange(Object.assign({}, props.draft, { name: event.target.value }));
              }}
              placeholder="Reminder"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="rule-instruction">Match</Label>
            <textarea
              id="rule-instruction"
              className="min-h-[140px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={props.draft.instruction}
              onChange={(event) => {
                props.onDraftChange(
                  Object.assign({}, props.draft, { instruction: event.target.value }),
                );
              }}
              placeholder="They asked to remember something later."
            />
          </div>

          {props.mode === "edit" && props.subscribers.length > 0 ? (
            <div className="space-y-2 rounded-md border border-border/70 px-3 py-3">
              <p className="text-sm font-medium">
                Listeners ({String(props.subscribers.length)})
              </p>
              <ul className="space-y-1">
                {props.subscribers.map((subscriber) => (
                  <li
                    key={`${subscriber.kind}-${subscriber.id}`}
                    className="rounded-md bg-secondary/50 px-2 py-1.5 text-xs"
                  >
                    <span className="text-muted-foreground">{subscriber.kind}</span>{" "}
                    {subscriber.label}
                    {subscriber.enabled !== true ? " · off" : ""}
                  </li>
                ))}
              </ul>
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
            <Button
              type="button"
              variant="ghost"
              onClick={props.onDelete}
              disabled={props.subscribers.length > 0}
            >
              <Trash2 className="h-4 w-4" />
              Delete
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

export function emptyRuleDraft(): RuleDraft {
  return { name: "", instruction: "", enabled: true };
}

export function draftFromRule(rule: VoiceRule): RuleDraft {
  return {
    name: rule.name,
    instruction: rule.instruction,
    enabled: rule.enabled,
  };
}
