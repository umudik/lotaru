import { useState } from "react";
import { Loader2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { EventSubscriber, VoiceRule, VoiceRuleMatch } from "@/lib/api";

export type RuleDraft = {
  name: string;
  slug: string;
  instruction: string;
  enabled: boolean;
};

type Props = {
  mode: "create" | "edit";
  rule: VoiceRule | null;
  draft: RuleDraft;
  saving: boolean;
  error: string;
  testing: boolean;
  testTranscript: string;
  testResult: { matches: VoiceRuleMatch[]; ran: boolean; error: string } | null;
  subscribers: EventSubscriber[];
  onDraftChange(next: RuleDraft): void;
  onTestTranscriptChange(next: string): void;
  onTest(): void;
  onClose(): void;
  onCreate(): void;
  onSave(): void;
  onDelete(): void;
};

export function RuleDetailPanel(props: Props): React.JSX.Element {
  const [slugTouched, setSlugTouched] = useState(false);
  const heading =
    props.mode === "create" ? "New rule" : props.rule !== null ? props.rule.name : "Rule";
  let eventType = "voice.rule.…";
  if (props.rule !== null) {
    eventType = props.rule.eventType;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-l bg-card/20">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{heading}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{eventType}</p>
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
              <p className="text-xs text-muted-foreground">Include this rule in every scan</p>
            </div>
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
                const name = event.target.value;
                const next = Object.assign({}, props.draft, { name });
                if (props.mode === "create" && slugTouched !== true) {
                  next.slug = "";
                }
                props.onDraftChange(next);
              }}
              placeholder="Hatırlatma"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="rule-slug">Event id</Label>
            <Input
              id="rule-slug"
              value={props.draft.slug}
              onChange={(event) => {
                setSlugTouched(true);
                props.onDraftChange(Object.assign({}, props.draft, { slug: event.target.value }));
              }}
              placeholder="derived from the name"
            />
            <p className="text-[11px] text-muted-foreground">
              Leave empty to derive it from the name. While something listens for this event,
              the id is frozen — nothing can be left pointing at an event that no longer exists.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="rule-instruction">Match when…</Label>
            <textarea
              id="rule-instruction"
              className="min-h-[140px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={props.draft.instruction}
              onChange={(event) => {
                props.onDraftChange(
                  Object.assign({}, props.draft, { instruction: event.target.value }),
                );
              }}
              placeholder={
                "Konuşan bir hatırlatma bırakırsa: \"şunu hatırlat\", \"aklımda kalsın\", \"yarın şunu yap\" gibi."
              }
            />
            <p className="text-[11px] text-muted-foreground">
              Plain language, in whatever language you speak. The scanner reads your transcript and
              decides whether this describes what was said.
            </p>
          </div>

          {props.mode === "edit" ? (
            <div className="space-y-2 rounded-md border border-border/70 px-3 py-3">
              <p className="text-sm font-medium">
                Listeners ({String(props.subscribers.length)})
              </p>
              {props.subscribers.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nothing subscribes to this event yet, so the rule can be renamed or deleted
                  freely. Add an agent or a script to act on it.
                </p>
              ) : (
                <>
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
                  <p className="text-[11px] text-muted-foreground">
                    The event id is frozen and the rule cannot be deleted while these exist.
                  </p>
                </>
              )}
            </div>
          ) : null}

          <div className="space-y-2 rounded-md border border-border/70 px-3 py-3">
            <p className="text-sm font-medium">Try it</p>
            <p className="text-xs text-muted-foreground">
              Paste something you might say. This only checks the match — no events are emitted.
            </p>
            <textarea
              className="min-h-[72px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={props.testTranscript}
              onChange={(event) => {
                props.onTestTranscriptChange(event.target.value);
              }}
              placeholder="Yarın Ali'yi aramayı hatırlat."
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={props.onTest}
              disabled={props.testing || props.testTranscript.trim().length === 0}
            >
              {props.testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Test against saved rules
            </Button>
            {props.testResult !== null ? (
              props.testResult.error.length > 0 ? (
                <p className="text-xs text-destructive">{props.testResult.error}</p>
              ) : props.testResult.matches.length === 0 ? (
                <p className="text-xs text-muted-foreground">No rule matched that transcript.</p>
              ) : (
                <ul className="space-y-1">
                  {props.testResult.matches.map((match, index) => (
                    <li
                      key={`${match.slug}-${String(index)}`}
                      className="rounded-md bg-secondary/50 px-2 py-1.5 text-xs"
                    >
                      <span className="font-mono">{match.slug}</span>
                      <span className="text-muted-foreground"> → {match.title}</span>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
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
            <Button
              type="button"
              variant="ghost"
              onClick={props.onDelete}
              disabled={props.subscribers.length > 0}
              title={
                props.subscribers.length > 0
                  ? "Remove or repoint the listeners first"
                  : "Delete this rule"
              }
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
  return { name: "", slug: "", instruction: "", enabled: true };
}

export function draftFromRule(rule: VoiceRule): RuleDraft {
  return {
    name: rule.name,
    slug: rule.slug,
    instruction: rule.instruction,
    enabled: rule.enabled,
  };
}
