import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AiSettingsLink } from "@/components/AiSettingsLink";
import { EmptyStatePanel } from "@/components/EmptyStatePanel";
import { InlineErrorBanner } from "@/components/InlineErrorBanner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { ResizeHandle } from "@script/components/resize-handle";
import { useDragResize } from "@script/hooks/use-drag-resize";
import { useSession } from "@/hooks/useSession";
import {
  createVoiceRule,
  deleteVoiceRule,
  fetchVoiceRuleSubscribers,
  fetchVoiceRules,
  patchVoiceRule,
  scanVoiceRulesNow,
  testVoiceRules,
  type AgentKind,
  type EventSubscriber,
  type VoiceRule,
  type VoiceRuleHit,
  type VoiceRuleMatch,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  draftFromRule,
  emptyRuleDraft,
  RuleDetailPanel,
  type RuleDraft,
} from "./RuleDetailPanel";

type PanelMode = "closed" | "create" | "edit";

type TestResult = { matches: VoiceRuleMatch[]; ran: boolean; error: string };

const STARTERS: { name: string; instruction: string }[] = [
  {
    name: "Hatırlatma",
    instruction:
      "Konuşan kişi ileride yapılacak bir şeyi hatırlatmamı istediğinde: \"şunu hatırlat\", \"aklımda kalsın\", \"yarın şunu yap\" gibi.",
  },
  {
    name: "Task",
    instruction:
      "Konuşan kişi somut bir iş açılmasını istediğinde: \"buna task aç\", \"şunu yapmamız lazım\", \"bunu listeye ekle\" gibi.",
  },
  {
    name: "Karar",
    instruction:
      "Konuşan kişi bir karara vardığını söylediğinde: \"şöyle yapıyoruz\", \"karar verdik\", \"bundan sonra böyle olacak\" gibi.",
  },
];

function runtimeLabel(kind: AgentKind): string {
  if (kind === "ollama") {
    return "Matching on local Ollama";
  }
  return `Matching on ${kind}`;
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) {
    return "just now";
  }
  if (diff < 3_600_000) {
    return `${String(Math.floor(diff / 60_000))}m ago`;
  }
  if (diff < 86_400_000) {
    return `${String(Math.floor(diff / 3_600_000))}h ago`;
  }
  return new Date(ms).toLocaleDateString();
}

export function RulesFeature(props: { projectId: string }): React.JSX.Element {
  const session = useSession();
  const [rules, setRules] = useState<VoiceRule[]>([]);
  const [hits, setHits] = useState<VoiceRuleHit[]>([]);
  const [runtime, setRuntime] = useState<AgentKind>("ollama");
  const [subscribers, setSubscribers] = useState<EventSubscriber[]>([]);
  const [panelMode, setPanelMode] = useState<PanelMode>("closed");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RuleDraft>(emptyRuleDraft());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testTranscript, setTestTranscript] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [viewportMaxDetail, setViewportMaxDetail] = useState(960);
  const detailResize = useDragResize({
    storageKey: "rules-workspace-detail-width",
    initial: 520,
    min: 380,
    max: viewportMaxDetail,
  });

  const load = useCallback(async (): Promise<void> => {
    if (session === null) {
      return;
    }
    const data = await fetchVoiceRules(session, props.projectId);
    setRules(data.rules);
    setHits(data.hits);
    setRuntime(data.runtime);
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
    setDraft(emptyRuleDraft());
    setTestResult(null);
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

  const loadSubscribers = useCallback(
    async (ruleId: string): Promise<void> => {
      if (session === null) {
        return;
      }
      try {
        const data = await fetchVoiceRuleSubscribers(session, ruleId);
        setSubscribers(data.subscribers);
      } catch {
        setSubscribers([]);
      }
    },
    [session],
  );

  let selectedRule: VoiceRule | null = null;
  if (selectedId !== null) {
    for (const rule of rules) {
      if (rule.id === selectedId) {
        selectedRule = rule;
      }
    }
  }

  const detailOpen = panelMode !== "closed";

  function closePanel(): void {
    setPanelMode("closed");
    setSelectedId(null);
    setDraft(emptyRuleDraft());
    setTestResult(null);
    setSubscribers([]);
    setError("");
  }

  function openCreate(seed: RuleDraft | null): void {
    setPanelMode("create");
    setSelectedId(null);
    setDraft(seed !== null ? seed : emptyRuleDraft());
    setTestResult(null);
    setError("");
  }

  function selectRule(ruleId: string): void {
    if (selectedId === ruleId && panelMode === "edit") {
      closePanel();
      return;
    }
    let found: VoiceRule | null = null;
    for (const rule of rules) {
      if (rule.id === ruleId) {
        found = rule;
      }
    }
    if (found === null) {
      return;
    }
    setPanelMode("edit");
    setSelectedId(ruleId);
    setDraft(draftFromRule(found));
    setTestResult(null);
    setSubscribers([]);
    setError("");
    void loadSubscribers(ruleId);
  }

  async function onCreate(): Promise<void> {
    if (session === null) {
      return;
    }
    const name = draft.name.trim();
    const instruction = draft.instruction.trim();
    if (name.length === 0 || instruction.length === 0) {
      setError("Name and match description are required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const created = await createVoiceRule(session, {
        projectId: props.projectId,
        name,
        slug: draft.slug.trim().length > 0 ? draft.slug.trim() : undefined,
        instruction,
        enabled: draft.enabled,
      });
      await load();
      setSelectedId(created.id);
      setPanelMode("edit");
      setDraft(draftFromRule(created));
      void loadSubscribers(created.id);
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
    const name = draft.name.trim();
    const instruction = draft.instruction.trim();
    if (name.length === 0 || instruction.length === 0) {
      setError("Name and match description are required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = await patchVoiceRule(session, selectedId, {
        name,
        slug: draft.slug.trim().length > 0 ? draft.slug.trim() : undefined,
        instruction,
        enabled: draft.enabled,
      });
      await load();
      setDraft(draftFromRule(saved));
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
    try {
      await deleteVoiceRule(session, selectedId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "delete failed");
      await loadSubscribers(selectedId);
      return;
    }
    closePanel();
    await load();
  }

  async function onTest(): Promise<void> {
    if (session === null) {
      return;
    }
    setTesting(true);
    try {
      const result = await testVoiceRules(session, props.projectId, testTranscript.trim());
      setTestResult(result);
    } catch (err: unknown) {
      setTestResult({
        matches: [],
        ran: false,
        error: err instanceof Error ? err.message : "test failed",
      });
    } finally {
      setTesting(false);
    }
  }

  async function onScanNow(): Promise<void> {
    if (session === null) {
      return;
    }
    setScanning(true);
    try {
      const result = await scanVoiceRulesNow(session, props.projectId);
      if (result.ran !== true) {
        toast.message(result.skipped.length > 0 ? result.skipped : "Nothing to scan");
      } else {
        toast.success(
          `${String(result.matched)} match(es) from ${String(result.scanned)} transcript line(s)`,
        );
      }
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "scan failed");
    } finally {
      setScanning(false);
    }
  }

  const enabledCount = rules.filter((rule) => rule.enabled).length;
  let subtitle =
    "Every couple of minutes Lotaru reads what you said out loud and emits an event for each rule that matches. Scripts, agents, and notes subscribe to those events.";
  subtitle = `${runtimeLabel(runtime)} · ${subtitle}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Rules"
        subtitle={subtitle}
        actions={
          <div className="flex items-center gap-2">
            <AiSettingsLink />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="shrink-0"
              onClick={() => {
                void onScanNow();
              }}
              disabled={scanning || enabledCount === 0}
            >
              <RefreshCw className={cn("h-4 w-4", scanning && "animate-spin")} />
              Scan now
            </Button>
            <Button
              type="button"
              size="sm"
              className="shrink-0"
              onClick={() => {
                openCreate(null);
              }}
            >
              <Plus className="h-4 w-4" />
              New rule
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

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto py-3">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading rules…</p>
            ) : rules.length === 0 ? (
              <div className="space-y-4">
                <EmptyStatePanel
                  title="No rules yet"
                  description="A rule turns something you say into an event. Name it, describe in your own words when it should match, and everything else subscribes to the event it emits."
                  action={
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        openCreate(null);
                      }}
                    >
                      <Plus className="h-4 w-4" />
                      New rule
                    </Button>
                  }
                />
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Start from one of these
                  </p>
                  <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]">
                    {STARTERS.map((starter) => (
                      <button
                        key={starter.name}
                        type="button"
                        className="panel-card rounded-lg p-4 text-left transition-colors hover:bg-secondary/40"
                        onClick={() => {
                          openCreate({
                            name: starter.name,
                            slug: "",
                            instruction: starter.instruction,
                            enabled: true,
                          });
                        }}
                      >
                        <p className="text-sm font-semibold">{starter.name}</p>
                        <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                          {starter.instruction}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]">
                  {rules.map((rule) => (
                    <button
                      key={rule.id}
                      type="button"
                      className={cn(
                        "panel-card rounded-lg p-4 text-left transition-colors hover:bg-secondary/40",
                        selectedId === rule.id && panelMode === "edit" && "ring-1 ring-primary",
                        rule.enabled !== true && "opacity-60",
                      )}
                      onClick={() => {
                        selectRule(rule.id);
                      }}
                    >
                      <p className="text-sm font-semibold">{rule.name}</p>
                      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {rule.eventType}
                        {rule.enabled !== true ? " · off" : ""}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {rule.subscriberCount === 0
                          ? "No listeners yet"
                          : `${String(rule.subscriberCount)} listener${rule.subscriberCount === 1 ? "" : "s"}`}
                      </p>
                      <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                        {rule.instruction}
                      </p>
                    </button>
                  ))}
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Recent matches
                  </p>
                  {hits.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nothing matched yet. Turn on Listen, say something a rule covers, then use
                      Scan now instead of waiting for the timer.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {hits.map((hit) => (
                        <li key={hit.id} className="panel-card p-3 text-sm">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="min-w-0 truncate font-medium">{hit.title}</p>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {relativeTime(hit.createdAt)}
                            </span>
                          </div>
                          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                            voice.rule.{hit.slug}
                          </p>
                          {hit.summary.length > 0 ? (
                            <p className="mt-1 text-xs text-muted-foreground">{hit.summary}</p>
                          ) : null}
                          {hit.quote.length > 0 ? (
                            <p className="mt-1 border-l-2 border-border pl-2 text-xs italic text-muted-foreground">
                              {hit.quote}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <p className="pb-4 text-xs text-muted-foreground">
                  To act on a rule, open{" "}
                  <Link
                    to={`/projects/${props.projectId}/agents`}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Agents
                  </Link>{" "}
                  or{" "}
                  <Link
                    to={`/projects/${props.projectId}/scripts`}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Scripts
                  </Link>{" "}
                  and subscribe to its event.
                </p>
              </>
            )}
          </div>
        </div>

        {detailOpen ? (
          <ResizeHandle
            onMouseDown={detailResize.onHandleMouseDown}
            active={detailResize.dragging}
          />
        ) : null}

        <div
          className={cn(
            "flex shrink-0 flex-col overflow-hidden bg-card/20",
            detailOpen && !detailResize.dragging && "transition-[width] duration-200 ease-out",
          )}
          style={{ width: detailOpen ? detailResize.size : 0 }}
        >
          {detailOpen ? (
            <RuleDetailPanel
              mode={panelMode === "create" ? "create" : "edit"}
              rule={selectedRule}
              draft={draft}
              saving={saving}
              error={error}
              testing={testing}
              testTranscript={testTranscript}
              testResult={testResult}
              subscribers={subscribers}
              onDraftChange={setDraft}
              onTestTranscriptChange={setTestTranscript}
              onTest={() => {
                void onTest();
              }}
              onClose={closePanel}
              onCreate={() => {
                void onCreate();
              }}
              onSave={() => {
                void onSave();
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
