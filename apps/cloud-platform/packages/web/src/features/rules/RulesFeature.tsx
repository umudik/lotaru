import { useCallback, useEffect, useState } from "react";
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
  type EventSubscriber,
  type VoiceRule,
  type VoiceRuleHit,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  draftFromRule,
  emptyRuleDraft,
  RuleDetailPanel,
  type RuleDraft,
} from "./RuleDetailPanel";

type PanelMode = "closed" | "create" | "edit";

function nameTaken(rules: readonly VoiceRule[], name: string, exceptId: string): boolean {
  const needle = name.trim().toLowerCase();
  if (needle.length === 0) {
    return false;
  }
  for (const rule of rules) {
    if (rule.id === exceptId) {
      continue;
    }
    if (rule.name.trim().toLowerCase() === needle) {
      return true;
    }
  }
  return false;
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
  const [subscribers, setSubscribers] = useState<EventSubscriber[]>([]);
  const [panelMode, setPanelMode] = useState<PanelMode>("closed");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RuleDraft>(emptyRuleDraft());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
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
    setSubscribers([]);
    setError("");
  }

  function openCreate(): void {
    setPanelMode("create");
    setSelectedId(null);
    setDraft(emptyRuleDraft());
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
      setError("Name and match are required");
      return;
    }
    if (nameTaken(rules, name, "")) {
      setError("Name already used");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const created = await createVoiceRule(session, {
        projectId: props.projectId,
        name,
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
      setError("Name and match are required");
      return;
    }
    if (nameTaken(rules, name, selectedId)) {
      setError("Name already used");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = await patchVoiceRule(session, selectedId, {
        name,
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Event extractors"
        info="An extractor turns something you said into an event. Responders and scripts can subscribe to that event."
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
                openCreate();
              }}
            >
              <Plus className="h-4 w-4" />
              New extractor
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
              <p className="text-sm text-muted-foreground">Loading extractors…</p>
            ) : rules.length === 0 ? (
              <EmptyStatePanel
                title="No extractors yet"
                description=""
                action={
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      openCreate();
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    New extractor
                  </Button>
                }
              />
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
                      {rule.enabled !== true ? (
                        <p className="mt-1 text-xs text-muted-foreground">Off</p>
                      ) : null}
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
                    <p className="text-sm text-muted-foreground">Nothing matched yet.</p>
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
              subscribers={subscribers}
              onDraftChange={setDraft}
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
