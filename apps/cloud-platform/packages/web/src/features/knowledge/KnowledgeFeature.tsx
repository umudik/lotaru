import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useSession } from "@/hooks/useSession";
import {
  createKnowledgeTemplate,
  deleteKnowledgeArtifact,
  deleteKnowledgeTemplate,
  fetchAppSettings,
  fetchKnowledgeArtifact,
  fetchKnowledgeArtifacts,
  fetchKnowledgeTemplates,
  patchKnowledgeArtifact,
  type KnowledgeArtifact,
  type KnowledgeKind,
  type KnowledgeTemplate,
  type TargetLanguage,
} from "@/lib/api";
import { CATALOG_EVENT_TYPES, catalogEventLabel } from "@/lib/event-catalog";
import { formatMillis } from "@/lib/utils";

function knowledgeBase(projectId: string): string {
  return `/projects/${projectId}/knowledge`;
}

function TemplatesPage(props: {
  projectId: string;
  kind: KnowledgeKind;
}): React.JSX.Element {
  const session = useSession();
  const base = knowledgeBase(props.projectId);
  const [templates, setTemplates] = useState<KnowledgeTemplate[]>([]);
  const [languages, setLanguages] = useState<TargetLanguage[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState("file.changed");
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState("tr");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  let heading = "Document templates";
  let listPath = `${base}/documentation/list`;
  let listLabel = "Documents";
  let titlePlaceholder = "API change summary for the team";
  if (props.kind === "diagram") {
    heading = "Diagram templates";
    listPath = `${base}/diagrams/list`;
    listLabel = "Diagrams";
    titlePlaceholder = "Service dependency map after a deploy";
  }

  const load = useCallback(async (): Promise<void> => {
    if (session === null) {
      return;
    }
    const data = await fetchKnowledgeTemplates(session, props.projectId, props.kind);
    setTemplates(data.templates);
  }, [session, props.projectId, props.kind]);

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

  function closeCreate(): void {
    setCreateOpen(false);
    setTitle("");
    setDescription("");
    setError("");
  }

  async function createTemplate(): Promise<void> {
    if (session === null) {
      return;
    }
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createKnowledgeTemplate(session, {
        projectId: props.projectId,
        kind: props.kind,
        title: trimmed,
        eventType,
        description: description.trim(),
        language,
        enabled: true,
      });
      closeCreate();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setSaving(false);
    }
  }

  async function removeTemplate(templateId: string): Promise<void> {
    if (session === null) {
      return;
    }
    await deleteKnowledgeTemplate(session, templateId);
    await load();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={heading}
        subtitle={`Event → ${listLabel}. Templates turn State into Knowledge.`}
        actions={
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            New template
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {templates.length === 0 ? (
            <div className="panel-card flex flex-col items-center justify-center px-6 py-16 text-center">
              <p className="text-sm font-semibold text-foreground">No templates yet</p>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Pick a When event, describe the output, and Lotaru writes into {listLabel} when that
                event happens in this project.
              </p>
              <Button
                className="mt-4"
                size="sm"
                onClick={() => {
                  setCreateOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                New template
              </Button>
            </div>
          ) : (
            <ul className="space-y-2">
              {templates.map((template) => (
                <li key={template.id} className="panel-card flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{template.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {catalogEventLabel(template.eventType)} · {template.language.toUpperCase()}
                    </p>
                    {template.description.length > 0 ? (
                      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                        {template.description}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void removeTemplate(template.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            Generated outputs land in{" "}
            <Link className="underline underline-offset-2" to={listPath}>
              {listLabel}
            </Link>
            .
          </p>
        </div>
        {createOpen ? (
          <aside className="flex w-[380px] shrink-0 flex-col border-l border-white/[0.07] bg-[#0a0a0a]">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
              <h2 className="text-sm font-semibold">New template</h2>
              <Button type="button" variant="ghost" size="sm" onClick={closeCreate}>
                Close
              </Button>
            </div>
            <form
              className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5"
              onSubmit={(event) => {
                event.preventDefault();
                void createTemplate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="template-title">Title</Label>
                <Input
                  id="template-title"
                  value={title}
                  autoFocus
                  placeholder={titlePlaceholder}
                  onChange={(event) => {
                    setTitle(event.target.value);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-event">When</Label>
                <Select
                  id="template-event"
                  value={eventType}
                  onChange={(event) => {
                    setEventType(event.target.value);
                  }}
                >
                  {CATALOG_EVENT_TYPES.map((typeName) => (
                    <option key={typeName} value={typeName}>
                      {catalogEventLabel(typeName)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-description">Description</Label>
                <textarea
                  id="template-description"
                  className="min-h-[8rem] w-full resize-y rounded-xl border border-white/[0.1] bg-[#111111] px-3 py-2 text-sm"
                  value={description}
                  placeholder="Create a document with this structure and tone…"
                  onChange={(event) => {
                    setDescription(event.target.value);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-language">Language</Label>
                <Select
                  id="template-language"
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
              {error.length > 0 ? <p className="text-xs text-destructive">{error}</p> : null}
              <div className="mt-auto flex gap-2 border-t border-white/[0.06] pt-4">
                <Button type="button" variant="outline" className="flex-1" onClick={closeCreate}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={saving || title.trim().length === 0}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save
                </Button>
              </div>
            </form>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function ArtifactsPage(props: {
  projectId: string;
  kind: KnowledgeKind;
}): React.JSX.Element {
  const session = useSession();
  const base = knowledgeBase(props.projectId);
  const [artifacts, setArtifacts] = useState<KnowledgeArtifact[]>([]);
  const [error, setError] = useState("");

  let heading = "Documents";
  let templatesPath = `${base}/documentation/templates`;
  if (props.kind === "diagram") {
    heading = "Diagrams";
    templatesPath = `${base}/diagrams/templates`;
  }

  const load = useCallback(async (): Promise<void> => {
    if (session === null) {
      return;
    }
    const data = await fetchKnowledgeArtifacts(session, props.projectId, props.kind);
    setArtifacts(data.artifacts);
  }, [session, props.projectId, props.kind]);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "load failed");
    });
  }, [load]);

  async function removeArtifact(artifactId: string): Promise<void> {
    if (session === null) {
      return;
    }
    await deleteKnowledgeArtifact(session, artifactId);
    await load();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={heading}
        subtitle="Generated from templates when matching events land."
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {error.length > 0 ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}
        {artifacts.length === 0 ? (
          <div className="panel-card flex flex-col items-center justify-center px-6 py-16 text-center">
            <p className="text-sm font-semibold text-foreground">
              {props.kind === "diagram" ? "No diagrams yet" : "No documents yet"}
            </p>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              Outputs appear here after a matching Events signal. Define a template first, then watch
              State turn into Knowledge.
            </p>
            <Link
              to={templatesPath}
              className="mt-4 inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
            >
              Define a template
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {artifacts.map((artifact) => (
              <li key={artifact.id} className="panel-card flex items-start justify-between gap-3 p-4">
                <Link
                  to={`${base}/${props.kind === "diagram" ? "diagrams" : "documentation"}/list/${artifact.id}`}
                  className="min-w-0 flex-1"
                >
                  <p className="text-sm font-semibold">{artifact.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Template: {artifact.templateTitle} · {catalogEventLabel(artifact.eventType)} ·{" "}
                    {formatMillis(Date.parse(artifact.createdAt))}
                  </p>
                </Link>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void removeArtifact(artifact.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ArtifactDetail(props: {
  projectId: string;
  kind: KnowledgeKind;
}): React.JSX.Element {
  const { artifactId } = useParams();
  const session = useSession();
  const navigate = useNavigate();
  const base = knowledgeBase(props.projectId);
  const [artifact, setArtifact] = useState<KnowledgeArtifact | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  let listPath = `${base}/documentation/list`;
  if (props.kind === "diagram") {
    listPath = `${base}/diagrams/list`;
  }

  const load = useCallback(async (): Promise<void> => {
    if (session === null || typeof artifactId !== "string") {
      return;
    }
    const next = await fetchKnowledgeArtifact(session, artifactId);
    setArtifact(next);
    setBody(next.body);
  }, [session, artifactId]);

  useEffect(() => {
    void load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "open failed");
    });
  }, [load]);

  async function save(): Promise<void> {
    if (session === null || artifact === null) {
      return;
    }
    setSaving(true);
    try {
      const next = await patchKnowledgeArtifact(session, artifact.id, { body });
      setArtifact(next);
      setBody(next.body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  if (artifact === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {error.length > 0 ? error : "Opening…"}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumb={[{ label: props.kind === "diagram" ? "Diagrams" : "Documents", to: listPath }]}
        title={artifact.title}
        subtitle={`Template: ${artifact.templateTitle} · ${catalogEventLabel(artifact.eventType)}`}
        actions={
          <Button type="button" size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {error.length > 0 ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}
        <textarea
          className="min-h-[24rem] w-full resize-y rounded-xl border border-white/[0.1] bg-[#111111] px-3 py-2 font-mono text-[13px] leading-6"
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
          }}
        />
        <div className="mt-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              navigate(listPath);
            }}
          >
            Back to list
          </Button>
        </div>
      </div>
    </div>
  );
}

export function KnowledgeFeature(props: { projectId: string }): React.JSX.Element {
  const base = knowledgeBase(props.projectId);
  return (
    <Routes>
      <Route index element={<Navigate to={`${base}/documentation/templates`} replace />} />
      <Route path="documentation" element={<Navigate to={`${base}/documentation/templates`} replace />} />
      <Route
        path="documentation/templates"
        element={<TemplatesPage projectId={props.projectId} kind="document" />}
      />
      <Route
        path="documentation/list"
        element={<ArtifactsPage projectId={props.projectId} kind="document" />}
      />
      <Route
        path="documentation/list/:artifactId"
        element={<ArtifactDetail projectId={props.projectId} kind="document" />}
      />
      <Route path="diagrams" element={<Navigate to={`${base}/diagrams/templates`} replace />} />
      <Route
        path="diagrams/templates"
        element={<TemplatesPage projectId={props.projectId} kind="diagram" />}
      />
      <Route path="diagrams/list" element={<ArtifactsPage projectId={props.projectId} kind="diagram" />} />
      <Route
        path="diagrams/list/:artifactId"
        element={<ArtifactDetail projectId={props.projectId} kind="diagram" />}
      />
      <Route path="*" element={<Navigate to={`${base}/documentation/templates`} replace />} />
    </Routes>
  );
}
