import { useEffect, useState } from "react";
import { ChevronRight, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { ConnectorLogo } from "@/components/ConnectorLogo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useSession } from "@/hooks/useSession";
import {
  probeAiTool,
  saveAiTool,
  type AiToolHealth,
  type AiToolRow,
} from "@/lib/api";

type AiDraft = {
  secret: string;
  baseUrl: string;
  model: string;
};

function visibleAiTools(
  rows: readonly AiToolRow[],
  query: string,
  linkedOnly: boolean,
): AiToolRow[] {
  const needle = query.trim().toLowerCase();
  const matched: AiToolRow[] = [];
  for (const row of rows) {
    if (linkedOnly && row.connected !== true) {
      continue;
    }
    const hay = `${row.label} ${row.id} ${row.lane}`.toLowerCase();
    if (needle.length > 0 && hay.includes(needle) !== true) {
      continue;
    }
    matched.push(row);
  }
  const ordered = matched.slice();
  ordered.sort((left: AiToolRow, right: AiToolRow) => {
    if (left.connected === right.connected) {
      return left.label.localeCompare(right.label);
    }
    if (left.connected) {
      return -1;
    }
    return 1;
  });
  return ordered;
}

function connectedCount(rows: readonly AiToolRow[]): number {
  let count = 0;
  for (const row of rows) {
    if (row.connected) {
      count += 1;
    }
  }
  return count;
}

function laneLabel(lane: AiToolRow["lane"]): string {
  if (lane === "local") {
    return "This machine";
  }
  if (lane === "cli") {
    return "CLI";
  }
  return "Cloud";
}

function secretPlaceholder(row: AiToolRow): string {
  if (row.lane === "cli") {
    return "";
  }
  if (row.connected) {
    return "Paste a new key to replace";
  }
  if (row.lane === "local") {
    return "Optional local API key";
  }
  return "API key";
}

function draftFor(row: AiToolRow, drafts: Record<string, AiDraft>): AiDraft {
  const listed = drafts[row.id];
  if (listed !== undefined) {
    return listed;
  }
  return { secret: "", baseUrl: row.baseUrl, model: row.model };
}

function modelChoices(row: AiToolRow, health: AiToolHealth | undefined): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  if (health !== undefined) {
    for (const name of health.models) {
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      names.push(name);
    }
  }
  if (row.model.length > 0 && seen.has(row.model) !== true) {
    names.push(row.model);
  }
  return names;
}

function connectSecret(row: AiToolRow, draft: AiDraft): string {
  if (row.lane !== "cli") {
    return draft.secret;
  }
  if (draft.secret.length > 0) {
    return draft.secret;
  }
  if (row.connected) {
    return "";
  }
  return "connected";
}

export function AiToolsSettings(props: {
  tools: AiToolRow[];
  savingId: string;
  probingId: string;
  focusId: string;
  onTools: (tools: AiToolRow[]) => void;
  onSaving: (id: string) => void;
  onProbing: (id: string) => void;
  onOllamaSaved: () => void;
}): React.JSX.Element {
  const session = useSession();
  const [query, setQuery] = useState("");
  const [linkedOnly, setLinkedOnly] = useState(false);
  const [openToolId, setOpenToolId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, AiDraft>>({});
  const [healthById, setHealthById] = useState<Record<string, AiToolHealth>>({});
  useEffect(() => {
    const hash = props.focusId;
    if (hash.length === 0 || hash === "ai") {
      return;
    }
    setOpenToolId(hash);
  }, [props.focusId]);
  const listed = visibleAiTools(props.tools, query, linkedOnly);
  const linked = connectedCount(props.tools);

  function setDraft(id: string, patch: Partial<AiDraft>): void {
    const row = props.tools.find((tool) => tool.id === id);
    if (row === undefined) {
      return;
    }
    const current = draftFor(row, drafts);
    setDrafts(
      Object.assign({}, drafts, {
        [id]: Object.assign({}, current, patch),
      }),
    );
  }

  async function persist(row: AiToolRow, disconnect: boolean): Promise<AiToolRow> {
    const draft = draftFor(row, drafts);
    const saved = await saveAiTool(session, row.id, {
      secret: disconnect ? "" : connectSecret(row, draft),
      baseUrl: draft.baseUrl,
      model: draft.model,
      disconnect,
    });
    const next: AiToolRow[] = [];
    for (const tool of props.tools) {
      if (tool.id === saved.tool.id) {
        next.push(saved.tool);
        continue;
      }
      next.push(tool);
    }
    props.onTools(next);
    setDrafts(Object.assign({}, drafts, { [row.id]: { secret: "", baseUrl: saved.tool.baseUrl, model: saved.tool.model } }));
    if (row.id === "ollama") {
      props.onOllamaSaved();
    }
    return saved.tool;
  }

  async function handleSave(row: AiToolRow): Promise<void> {
    props.onSaving(row.id);
    try {
      const saved = await persist(row, false);
      if (saved.connected) {
        toast.success(`${saved.label} connected`);
      } else {
        toast.success(`${saved.label} disconnected`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save AI tool");
    } finally {
      props.onSaving("idle");
    }
  }

  async function handleDisconnect(row: AiToolRow): Promise<void> {
    props.onSaving(row.id);
    try {
      const saved = await persist(row, true);
      toast.success(`${saved.label} disconnected`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect AI tool");
    } finally {
      props.onSaving("idle");
    }
  }

  async function handleProbe(row: AiToolRow): Promise<void> {
    props.onProbing(row.id);
    try {
      if (row.lane !== "cli") {
        await persist(row, false);
      }
      const result = await probeAiTool(session, row.id);
      setHealthById(Object.assign({}, healthById, { [row.id]: result.health }));
      const next: AiToolRow[] = [];
      for (const tool of props.tools) {
        if (tool.id === result.tool.id) {
          next.push(result.tool);
          continue;
        }
        next.push(tool);
      }
      props.onTools(next);
      if (result.health.reachable) {
        toast.success(`${row.label} reachable`);
      } else if (result.health.error.length > 0) {
        toast.error(result.health.error);
      } else {
        toast.error(`${row.label} is not reachable`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to test AI tool");
    } finally {
      props.onProbing("idle");
    }
  }

  return (
    <section id="ai-tools" className="panel-card space-y-5 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          Keys stay on this machine. Local models never leave it. Cloud calls go from this Lotaru
          process, not a hosted proxy. Event responders, Notes, and templates pick from Connected.
        </p>
        <Badge variant={linked > 0 ? "success" : "muted"}>{`${linked} connected`}</Badge>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="ai-tool-search"
            value={query}
            placeholder="Search AI tools"
            className="pl-9"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>
        <div className="flex shrink-0 rounded-lg border border-border/70 p-0.5">
          <Button
            type="button"
            size="sm"
            variant={linkedOnly ? "ghost" : "secondary"}
            onClick={() => {
              setLinkedOnly(false);
            }}
          >
            All
          </Button>
          <Button
            type="button"
            size="sm"
            variant={linkedOnly ? "secondary" : "ghost"}
            onClick={() => {
              setLinkedOnly(true);
            }}
          >
            Connected
          </Button>
        </div>
      </div>
      {listed.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {linkedOnly ? "No connected AI tools match." : "No AI tools match that search."}
        </p>
      ) : (
        <ul className="divide-y divide-border/50 rounded-xl border border-border/60">
          {listed.map((row, index) => {
            const draft = draftFor(row, drafts);
            const saving = props.savingId === row.id;
            const probing = props.probingId === row.id;
            const health = healthById[row.id];
            const models = modelChoices(row, health);
            const busy = saving || probing;
            return (
              <li key={row.id}>
                <details
                  id={row.id}
                  name="lotaru-ai-tool"
                  className="connection-tool"
                  open={props.focusId === row.id ? true : undefined}
                  onToggle={(event) => {
                    if (event.currentTarget.open) {
                      setOpenToolId(row.id);
                      return;
                    }
                    if (openToolId === row.id) {
                      setOpenToolId("");
                    }
                  }}
                >
                  <summary className="connection-summary flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <ChevronRight className="connection-chevron h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <ConnectorLogo id={row.id} label={row.label} eager={index < 10} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{row.label}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {laneLabel(row.lane)}
                      </span>
                    </span>
                    {row.connected ? (
                      <Badge variant="success">Connected</Badge>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">Connect</span>
                    )}
                  </summary>
                  <div className="space-y-3 px-3 pb-3 pt-1">
                    {row.lane === "local" ? (
                      <div className="space-y-2">
                        <Label htmlFor={`${row.id}-base`}>Host</Label>
                        <Input
                          id={`${row.id}-base`}
                          value={draft.baseUrl}
                          placeholder={row.defaultBase}
                          onChange={(event) => {
                            setDraft(row.id, { baseUrl: event.target.value });
                          }}
                        />
                      </div>
                    ) : null}
                    {row.lane === "cloud" || (row.lane === "local" && row.protocol === "openai") ? (
                      <div className="space-y-2">
                        <Label htmlFor={`${row.id}-secret`}>API key</Label>
                        <Input
                          id={`${row.id}-secret`}
                          type="password"
                          value={draft.secret}
                          placeholder={secretPlaceholder(row)}
                          onChange={(event) => {
                            setDraft(row.id, { secret: event.target.value });
                          }}
                        />
                      </div>
                    ) : null}
                    {row.lane !== "cli" ? (
                      <div className="space-y-2">
                        <Label htmlFor={`${row.id}-model`}>Model</Label>
                        {models.length > 0 ? (
                          <Select
                            id={`${row.id}-model`}
                            value={draft.model}
                            onChange={(event) => {
                              setDraft(row.id, { model: event.target.value });
                            }}
                          >
                            <option value="">Choose a model</option>
                            {models.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <Input
                            id={`${row.id}-model`}
                            value={draft.model}
                            placeholder={row.defaultModel.length > 0 ? row.defaultModel : "model id"}
                            onChange={(event) => {
                              setDraft(row.id, { model: event.target.value });
                            }}
                          />
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Connect only if Test finds the CLI on PATH. Log in to the CLI on this
                        machine.
                      </p>
                    )}
                    {health !== undefined && health.error.length > 0 ? (
                      <p className="text-xs text-destructive">{health.error}</p>
                    ) : health !== undefined && health.detail.length > 0 ? (
                      <p className="text-xs text-muted-foreground">{health.detail}</p>
                    ) : null}
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          void handleProbe(row);
                        }}
                      >
                        {probing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Test
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          void handleSave(row);
                        }}
                      >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {row.connected ? "Update" : "Connect"}
                      </Button>
                      {row.connected ? (
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            void handleDisconnect(row);
                          }}
                        >
                          Disconnect
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
