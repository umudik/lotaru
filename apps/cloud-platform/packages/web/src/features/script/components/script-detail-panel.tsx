import { useEffect, useState } from 'react';
import { Copy, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@script/components/ui/select';
import { Switch } from '@script/components/ui/switch';
import { CommandField } from '@script/components/command-editor-dialog';
import { patchScript } from '@script/lib/script-patch';
import { duplicateScriptBody } from '@script/lib/project-templates';
import { ConfirmDeleteDialog } from '@script/components/confirm-delete-dialog';
import { ConfirmDuplicateDialog } from '@script/components/confirm-duplicate-dialog';
import { ScriptHistory } from '@script/components/script-history';
import { LogPanel } from '@script/components/log-panel';
import type { InspectTarget } from '@script/components/run-dots';
import { CATALOG_EVENT_TYPES, catalogEventLabel } from '@/lib/event-catalog';
import { fetchEventTypes, type EventTypeOption } from '@/lib/api';
import { useSession } from '@/hooks/useSession';
import { cn } from '@/lib/utils';
import { api } from '@script/api/client';
import { actions, useStore } from '@script/state/store';
import type { Script, TriggerKind, ConcurrencyKind } from '@script/types';

const triggerOptions: readonly { value: TriggerKind; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'save', label: 'On save' },
  { value: 'startup', label: 'Startup' },
  { value: 'scheduled', label: 'Clock (10s)' },
  { value: 'event', label: 'Bus event' },
];
const concurrencyOptions: readonly { value: ConcurrencyKind; label: string }[] = [
  { value: 'restart', label: 'Restart' },
  { value: 'queue', label: 'Queue' },
  { value: 'ignore', label: 'Ignore' },
  { value: 'parallel', label: 'Parallel' },
];

function enabledLabel(enabled: boolean): string {
  if (enabled) {
    return 'On';
  }
  return 'Off';
}

type DetailTab = 'script' | 'logs';

interface Props {
  script: Script;
  inspectId: string | null;
  inspect: InspectTarget | null;
  detailTab: DetailTab;
  onDetailTabChange(tab: DetailTab): void;
  existingScriptNames: readonly string[];
  onInspect(target: InspectTarget): void;
  onCancelExecution(executionId: string): void;
  onClosePanel(): void;
  onDuplicated(script: Script): void;
  onDeleted(scriptId: string): void;
}

function detailTabClass(active: boolean): string {
  if (active) {
    return 'border-primary text-foreground';
  }
  return 'border-transparent text-muted-foreground hover:text-foreground';
}

export function ScriptDetailPanel(props: Props): React.JSX.Element {
  const t = useStore((s) => {
    for (const row of s.scripts) {
      if (row.id === props.script.id) {
        return row;
      }
    }
    return props.script;
  });
  const [name, setName] = useState(t.name);
  const [command, setCommand] = useState(t.command);
  const [glob, setGlob] = useState(t.trigger_glob);
  const [enabled, setEnabled] = useState(t.enabled);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [eventTypes, setEventTypes] = useState<EventTypeOption[]>([]);
  const session = useSession();

  useEffect(() => {
    if (session === null || t.project_id.length === 0) {
      return;
    }
    void fetchEventTypes(session, t.project_id)
      .then((data) => {
        setEventTypes(data.eventTypes);
      })
      .catch(() => {
        setEventTypes([]);
      });
  }, [session, t.project_id]);

  useEffect(() => {
    setName(t.name);
    setCommand(t.command);
    setGlob(t.trigger_glob);
    setEnabled(t.enabled);
  }, [t.id, t.name, t.command, t.trigger_glob, t.enabled]);

  async function saveField(partial: Partial<Script>): Promise<void> {
    try {
      await patchScript(t, partial);
    } catch (e: unknown) {
      toast.error(String(e));
    }
  }

  async function setScriptEnabled(next: boolean): Promise<void> {
    if (next === t.enabled) {
      return;
    }
    setEnabled(next);
    try {
      await patchScript(t, { enabled: next });
    } catch (e: unknown) {
      setEnabled(t.enabled);
      toast.error(String(e));
    }
  }

  const duplicatePreview = duplicateScriptBody(t, props.existingScriptNames);

  async function duplicate(): Promise<void> {
    const body = duplicateScriptBody(t, props.existingScriptNames);
    const r = await api.createScript(t.project_id, body);
    actions.upsertScript(r.script);
    toast.success('Script duplicated');
    props.onDuplicated(r.script);
  }

  async function removeScript(): Promise<void> {
    await api.deleteScript(t.id);
    actions.removeScript(t.id);
    toast.success('Script deleted');
    props.onDeleted(t.id);
  }

  let globInput: React.JSX.Element | null = null;
  if (t.trigger_type === 'save') {
    globInput = (
      <div className="flex flex-col gap-1.5 min-w-0">
        <Label className="text-xs text-muted-foreground">Path filter</Label>
        <Input
          value={glob}
          onChange={(e) => {
            setGlob(e.target.value);
          }}
          onBlur={() => {
            void saveField({ trigger_glob: glob });
          }}
          placeholder="**/*.ts"
          className="font-mono h-9 text-xs w-full"
        />
      </div>
    );
  }

  let clockHint: React.JSX.Element | null = null;
  if (t.trigger_type === 'scheduled') {
    clockHint = (
      <p className="text-xs text-muted-foreground">Listens to clock.tick every 10 seconds.</p>
    );
  }

  let busEventOptions: EventTypeOption[] = eventTypes;
  if (busEventOptions.length === 0) {
    busEventOptions = CATALOG_EVENT_TYPES.map((eventType) => ({
      type: eventType,
      label: '',
      kind: 'platform' as const,
    }));
  }

  let busEventInput: React.JSX.Element | null = null;
  if (t.trigger_type === 'event') {
    busEventInput = (
      <div className="flex flex-col gap-1.5 min-w-0">
        <Label className="text-xs text-muted-foreground">Bus event</Label>
        <Select
          value={t.trigger_bus_event.length > 0 ? t.trigger_bus_event : CATALOG_EVENT_TYPES[0]}
          onValueChange={(v) => {
            void saveField({ trigger_bus_event: v });
          }}
        >
          <SelectTrigger className="h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {busEventOptions.map((entry) => (
              <SelectItem key={entry.type} value={entry.type}>
                {entry.kind === 'rule' && entry.label.length > 0
                  ? `Rule: ${entry.label}`
                  : catalogEventLabel(entry.type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  let logsBody: React.JSX.Element;
  if (props.inspect !== null) {
    logsBody = <LogPanel target={props.inspect} onCancel={props.onCancelExecution} />;
  } else {
    logsBody = (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground text-center">
        Select a run from history to view logs.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden border-l">
      <div className="flex items-center justify-between gap-2 shrink-0 px-4 py-3 border-b">
        <div className="flex items-center gap-1 min-w-0">
          <button
            type="button"
            className={cn(
              'text-sm font-semibold px-2 py-1 border-b-2 transition-colors',
              detailTabClass(props.detailTab === 'script'),
            )}
            onClick={() => {
              props.onDetailTabChange('script');
            }}
          >
            Script
          </button>
          <button
            type="button"
            className={cn(
              'text-sm font-semibold px-2 py-1 border-b-2 transition-colors',
              detailTabClass(props.detailTab === 'logs'),
            )}
            onClick={() => {
              props.onDetailTabChange('logs');
            }}
          >
            Logs
          </button>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              setDuplicateOpen(true);
            }}
          >
            <Copy className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => {
              setDeleteOpen(true);
            }}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={props.onClosePanel}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <ConfirmDuplicateDialog
        open={duplicateOpen}
        name={t.name}
        copyName={duplicatePreview.name}
        onOpenChange={setDuplicateOpen}
        onConfirm={duplicate}
      />
      <ConfirmDeleteDialog
        open={deleteOpen}
        kind="script"
        name={t.name}
        onOpenChange={setDeleteOpen}
        onConfirm={removeScript}
      />

      {props.detailTab === 'script' && (
        <div className="flex flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto p-4">
          <div className="flex items-center gap-3 shrink-0">
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              onBlur={() => {
                if (name !== t.name) {
                  void saveField({ name });
                }
              }}
              className="h-9 font-medium flex-1"
            />
            <div className="flex items-center gap-2 shrink-0">
              <Switch
                checked={enabled}
                onCheckedChange={(v) => {
                  void setScriptEnabled(v);
                }}
              />
              <span className="text-xs text-muted-foreground">{enabledLabel(enabled)}</span>
            </div>
          </div>

          <CommandField
            value={command}
            runtime={t.runtime}
            onSave={(next) => {
              setCommand(next);
              if (next !== t.command) {
                void saveField({ command: next });
              }
            }}
          />

          <div className="rounded-lg border border-white/[0.1] bg-[#111111] p-3 flex flex-col gap-3 shrink-0">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5 min-w-0">
                <Label className="text-xs text-muted-foreground">Trigger</Label>
                <Select
                  value={t.trigger_type}
                  onValueChange={(v) => {
                    const kind = v as TriggerKind;
                    void saveField({ trigger_type: kind });
                  }}
                >
                  <SelectTrigger className="h-9 text-xs w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {triggerOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5 min-w-0">
                <Label className="text-xs text-muted-foreground">Concurrency</Label>
                <Select
                  value={t.concurrency}
                  onValueChange={(v) => {
                    void saveField({ concurrency: v as ConcurrencyKind });
                  }}
                >
                  <SelectTrigger className="h-9 text-xs w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {concurrencyOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {globInput}
            {busEventInput}
            {clockHint}
          </div>

          <ScriptHistory scriptId={t.id} selectedId={props.inspectId} onInspect={props.onInspect} />
        </div>
      )}

      {props.detailTab === 'logs' && (
        <div className="flex flex-1 min-h-0 flex flex-col">{logsBody}</div>
      )}
    </div>
  );
}
