import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useSession } from "@/hooks/useSession";
import {
  approveKnowledgeOutput,
  createKnowledgeItem,
  deleteKnowledgeItem,
  fetchAppSettings,
  fetchKnowledgeItem,
  fetchKnowledgeItems,
  patchKnowledgeItem,
  patchKnowledgeOutput,
  proposeKnowledgeOutput,
  type KnowledgeAudience,
  type KnowledgeIntent,
  type KnowledgeItem,
  type KnowledgeOutput,
  type KnowledgeView,
  type TargetLanguage,
} from "@/lib/api";
import { cn } from "@/lib/utils";

function knowledgeBase(projectId: string): string {
  return `/projects/${projectId}/knowledge`;
}

function intentLabel(intent: KnowledgeIntent): string {
  if (intent === "process") {
    return "Process";
  }
  if (intent === "api") {
    return "API";
  }
  return "Overview";
}

function audienceLabel(audience: KnowledgeAudience): string {
  if (audience === "ops") {
    return "Ops";
  }
  if (audience === "frontend") {
    return "Frontend";
  }
  return "Developer";
}

function outputCounts(item: KnowledgeItem): { docs: number; diagrams: number } {
  let docs = 0;
  if (item.document.currentVersion > 0 || item.document.proposedVersion > 0) {
    docs = 1;
  }
  let diagrams = 0;
  if (item.diagram.currentVersion > 0 || item.diagram.proposedVersion > 0) {
    diagrams = 1;
  }
  return { docs, diagrams };
}

function KnowledgeList(props: { projectId: string; view: KnowledgeView }): React.JSX.Element {
  const session = useSession();
  const base = knowledgeBase(props.projectId);
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [languages, setLanguages] = useState<TargetLanguage[]>([]);
  const [subject, setSubject] = useState("");
  const [intent, setIntent] = useState<KnowledgeIntent>("process");
  const [audience, setAudience] = useState<KnowledgeAudience>("developer");
  const [language, setLanguage] = useState("tr");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async (): Promise<void> => {
    if (session === null) {
      return;
    }
    const data = await fetchKnowledgeItems(session, props.projectId, props.view);
    setItems(data.items);
  }, [session, props.projectId, props.view]);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "load failed");
    });
  }, [load]);

  useEffect(() => {
    if (session === null) {
      return;
    }
    void fetchAppSettings(session).then((data) => {
      setLanguages(data.languages);
      setLanguage(data.settings.targetLanguage);
    });
  }, [session]);

  async function createItem(): Promise<void> {
    if (session === null) {
      return;
    }
    const trimmed = subject.trim();
    if (trimmed.length === 0) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createKnowledgeItem(session, {
        projectId: props.projectId,
        subject: trimmed,
        intent,
        audience,
        language,
      });
      setSubject("");
      navigate(`${base}/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setSaving(false);
    }
  }

  let heading = "Knowledge";
  if (props.view === "documentation") {
    heading = "Documentation";
  }
  if (props.view === "diagrams") {
    heading = "Diagrams";
  }

  return (
    <div className="note-desk flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
              A brief is the question. Documentation and diagrams are two views of the same
              answer. You own the current text; the agent only proposes.
            </p>
          </div>
        </div>

        <form
          className="panel-card space-y-3 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void createItem();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="knowledge-subject">Subject</Label>
              <Input
                id="knowledge-subject"
                value={subject}
                placeholder="Transfer"
                onChange={(event) => {
                  setSubject(event.target.value);
                }}
              />
            </div>
            <div>
              <Label htmlFor="knowledge-intent">Intent</Label>
              <Select
                id="knowledge-intent"
                value={intent}
                onChange={(event) => {
                  setIntent(event.target.value as KnowledgeIntent);
                }}
              >
                <option value="process">Process</option>
                <option value="api">API</option>
                <option value="overview">Overview</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="knowledge-audience">Audience</Label>
              <Select
                id="knowledge-audience"
                value={audience}
                onChange={(event) => {
                  setAudience(event.target.value as KnowledgeAudience);
                }}
              >
                <option value="developer">Developer</option>
                <option value="frontend">Frontend</option>
                <option value="ops">Ops</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="knowledge-language">Language</Label>
              <Select
                id="knowledge-language"
                value={language}
                onChange={(event) => {
                  setLanguage(event.target.value);
                }}
              >
                {languages.map((lang) => (
                  <option key={lang.id} value={lang.id}>
                    {lang.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between">
            {error ? <p className="text-xs text-destructive">{error}</p> : <span />}
            <Button type="submit" disabled={saving || subject.trim().length === 0}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              New
            </Button>
          </div>
        </form>

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No knowledge yet. Start with a brief.</p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              const counts = outputCounts(item);
              return (
                <Link
                  key={item.id}
                  to={`${base}/${item.id}`}
                  className="panel-card block px-5 py-4 transition-colors hover:bg-secondary/40"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-base font-medium">{item.subject}</p>
                    {item.stale ? (
                      <span className="text-[11px] font-medium text-warn">Stale</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {intentLabel(item.intent)} · {audienceLabel(item.audience)} · {item.language.toUpperCase()}
                  </p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {counts.docs} doc · {counts.diagrams} diagram
                  </p>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function KnowledgeDetail(props: { projectId: string; tab: "document" | "diagram" }): React.JSX.Element {
  const { itemId } = useParams();
  const session = useSession();
  const base = knowledgeBase(props.projectId);
  const navigate = useNavigate();
  const [item, setItem] = useState<KnowledgeItem | null>(null);
  const [currentBody, setCurrentBody] = useState("");
  const [proposedBody, setProposedBody] = useState("");
  const [sourcesText, setSourcesText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [proposing, setProposing] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (session === null || typeof itemId !== "string") {
      return;
    }
    const next = await fetchKnowledgeItem(session, itemId);
    setItem(next);
    const output = props.tab === "document" ? next.document : next.diagram;
    setCurrentBody(output.currentBody);
    setProposedBody(output.proposedBody);
    setSourcesText(output.sourcesText);
  }, [session, itemId, props.tab]);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "open failed");
    });
  }, [load]);

  async function saveCurrent(): Promise<void> {
    if (session === null || item === null) {
      return;
    }
    setSaving(true);
    try {
      const next = await patchKnowledgeOutput(session, item.id, props.tab, {
        currentBody,
        sourcesText,
      });
      setItem(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveProposed(): Promise<void> {
    if (session === null || item === null) {
      return;
    }
    setSaving(true);
    try {
      const next = await patchKnowledgeOutput(session, item.id, props.tab, {
        proposedBody,
        sourcesText,
      });
      setItem(next);
      setProposedBody(next[props.tab === "document" ? "document" : "diagram"].proposedBody);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  async function approve(): Promise<void> {
    if (session === null || item === null) {
      return;
    }
    setSaving(true);
    try {
      const next = await approveKnowledgeOutput(session, item.id, props.tab);
      setItem(next);
      const output = props.tab === "document" ? next.document : next.diagram;
      setCurrentBody(output.currentBody);
      setProposedBody(output.proposedBody);
    } catch (err) {
      setError(err instanceof Error ? err.message : "approve failed");
    } finally {
      setSaving(false);
    }
  }

  async function propose(): Promise<void> {
    if (session === null || item === null) {
      return;
    }
    setProposing(true);
    setError(null);
    try {
      const next = await proposeKnowledgeOutput(session, item.id, props.tab);
      setItem(next);
      const output = props.tab === "document" ? next.document : next.diagram;
      setProposedBody(output.proposedBody);
    } catch (err) {
      setError(err instanceof Error ? err.message : "agent failed");
    } finally {
      setProposing(false);
    }
  }

  async function remove(): Promise<void> {
    if (session === null || item === null) {
      return;
    }
    await deleteKnowledgeItem(session, item.id);
    navigate(base);
  }

  async function clearStale(): Promise<void> {
    if (session === null || item === null) {
      return;
    }
    const next = await patchKnowledgeItem(session, item.id, { stale: false });
    setItem(next);
  }

  if (item === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {error ?? "Opening…"}
      </div>
    );
  }

  const output: KnowledgeOutput = props.tab === "document" ? item.document : item.diagram;

  return (
    <div className="note-desk flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-6 px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link to={base} className="text-xs text-muted-foreground hover:text-foreground">
              Knowledge
            </Link>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{item.subject}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {intentLabel(item.intent)} · {audienceLabel(item.audience)} · {item.language.toUpperCase()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {item.stale ? (
              <Button type="button" variant="outline" size="sm" onClick={() => void clearStale()}>
                Mark current
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="sm" onClick={() => void remove()}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex gap-2">
          <Link
            to={`${base}/${item.id}`}
            className={cn(
              "inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium",
              props.tab === "document"
                ? "bg-primary text-primary-foreground"
                : "border border-white/[0.1] bg-[#111111] text-muted-foreground hover:text-foreground",
            )}
          >
            Documentation
          </Link>
          <Link
            to={`${base}/${item.id}/diagrams`}
            className={cn(
              "inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium",
              props.tab === "diagram"
                ? "bg-primary text-primary-foreground"
                : "border border-white/[0.1] bg-[#111111] text-muted-foreground hover:text-foreground",
            )}
          >
            Diagrams
          </Link>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <section className="panel-card space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Current v{output.currentVersion}</h2>
            <Button type="button" size="sm" disabled={saving} onClick={() => void saveCurrent()}>
              Save
            </Button>
          </div>
          <textarea
            className="min-h-[14rem] w-full resize-y rounded-xl border border-white/[0.1] bg-[#111111] px-3 py-2 font-mono text-[13px] leading-6"
            value={currentBody}
            onChange={(event) => {
              setCurrentBody(event.target.value);
            }}
          />
        </section>

        <section className="panel-card space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">Proposed v{output.proposedVersion}</h2>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={proposing} onClick={() => void propose()}>
                {proposing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Ask agent
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void saveProposed()}>
                Save draft
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={saving || proposedBody.trim().length === 0}
                onClick={() => void approve()}
              >
                Approve
              </Button>
            </div>
          </div>
          <textarea
            className="min-h-[14rem] w-full resize-y rounded-xl border border-white/[0.1] bg-[#111111] px-3 py-2 font-mono text-[13px] leading-6"
            value={proposedBody}
            placeholder="Agent output lands here. Edit it, then approve."
            onChange={(event) => {
              setProposedBody(event.target.value);
            }}
          />
        </section>

        <section className="panel-card space-y-2 p-5">
          <Label htmlFor="knowledge-sources">Sources</Label>
          <Input
            id="knowledge-sources"
            value={sourcesText}
            placeholder="PR #182, Meeting #12, Note #17"
            onChange={(event) => {
              setSourcesText(event.target.value);
            }}
          />
        </section>
      </div>
    </div>
  );
}

export function KnowledgeFeature(props: { projectId: string }): React.JSX.Element {
  const base = knowledgeBase(props.projectId);
  return (
    <Routes>
      <Route index element={<KnowledgeList projectId={props.projectId} view="all" />} />
      <Route
        path="documentation"
        element={<KnowledgeList projectId={props.projectId} view="documentation" />}
      />
      <Route path="diagrams" element={<KnowledgeList projectId={props.projectId} view="diagrams" />} />
      <Route path=":itemId" element={<KnowledgeDetail projectId={props.projectId} tab="document" />} />
      <Route
        path=":itemId/diagrams"
        element={<KnowledgeDetail projectId={props.projectId} tab="diagram" />}
      />
      <Route path="*" element={<Navigate to={base} replace />} />
    </Routes>
  );
}
