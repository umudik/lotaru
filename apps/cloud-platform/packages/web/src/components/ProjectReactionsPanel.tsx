import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useSession } from "@/hooks/useSession";
import {
  createProjectReaction,
  deleteProjectReaction,
  fetchKnowledgeItems,
  fetchProjectEvents,
  fetchProjectReactions,
  type KnowledgeItem,
  type LotaruEventRow,
  type LotaruReaction,
} from "@/lib/api";

type Props = {
  projectId: string;
};

function eventTypeLabel(eventType: string): string {
  if (eventType === "github.pull_request.opened") {
    return "Pull request opened";
  }
  if (eventType === "github.pull_request.updated") {
    return "Pull request updated";
  }
  if (eventType === "github.pull_request.merged") {
    return "Pull request merged";
  }
  if (eventType === "file.changed") {
    return "File saved";
  }
  if (eventType === "clock.tick") {
    return "Clock (every 10s)";
  }
  if (eventType === "schedule.fired") {
    return "Clock (every 10s)";
  }
  if (eventType === "app.started") {
    return "App started";
  }
  return eventType;
}

function defaultTitle(eventType: string): string {
  if (eventType.startsWith("github.")) {
    return "Review PR #{{detail}}";
  }
  if (eventType === "file.changed") {
    return "Handle {{path}} change";
  }
  return "Handle {{type}}";
}

function knowledgeOutputKinds(documentOn: boolean, diagramOn: boolean): Array<"document" | "diagram"> {
  const kinds: Array<"document" | "diagram"> = [];
  if (documentOn === true) {
    kinds.push("document");
  }
  if (diagramOn === true) {
    kinds.push("diagram");
  }
  return kinds;
}

function reactionSummary(reaction: LotaruReaction, items: KnowledgeItem[]): string {
  if (reaction.action === "create_task") {
    return reaction.titleTemplate;
  }
  let subject = reaction.knowledgeItemId;
  for (const item of items) {
    if (item.id === reaction.knowledgeItemId) {
      subject = item.subject;
    }
  }
  return `${subject} · ${reaction.knowledgeOutputs.join(", ")}`;
}

export function ProjectReactionsPanel(props: Props): React.JSX.Element {
  const session = useSession();
  const [reactions, setReactions] = useState<LotaruReaction[]>([]);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [eventTypes, setEventTypes] = useState<string[]>(["file.changed"]);
  const [events, setEvents] = useState<LotaruEventRow[]>([]);
  const [eventType, setEventType] = useState("file.changed");
  const [action, setAction] = useState("create_task");
  const [githubConnected, setGithubConnected] = useState(false);
  const [githubRepos, setGithubRepos] = useState<string[]>([]);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [titleTemplate, setTitleTemplate] = useState(defaultTitle("file.changed"));
  const [knowledgeItemId, setKnowledgeItemId] = useState("");
  const [includeDocument, setIncludeDocument] = useState(true);
  const [includeDiagram, setIncludeDiagram] = useState(true);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    const listed = await fetchProjectReactions(session, props.projectId);
    setReactions(listed.reactions);
    setEventTypes(listed.eventTypes);
    setGithubConnected(listed.githubConnected);
    setGithubRepos(listed.githubRepos);
    const logged = await fetchProjectEvents(session, props.projectId, 8);
    setEvents(logged.events);
    const knowledge = await fetchKnowledgeItems(session, props.projectId, "all");
    setKnowledgeItems(knowledge.items);
  }, [session, props.projectId]);

  useEffect(() => {
    void reload().catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to load reactions");
    });
  }, [reload]);

  useEffect(() => {
    let typeKnown = false;
    for (const known of eventTypes) {
      if (known === eventType) {
        typeKnown = true;
      }
    }
    if (typeKnown !== true) {
      const first = eventTypes[0];
      if (first !== undefined) {
        setEventType(first);
        setTitleTemplate(defaultTitle(first));
      }
    }
  }, [eventTypes, eventType]);

  useEffect(() => {
    if (githubRepos.length === 0) {
      setSelectedRepo("");
      return;
    }
    let repoKnown = false;
    for (const repo of githubRepos) {
      if (repo === selectedRepo) {
        repoKnown = true;
      }
    }
    if (repoKnown !== true) {
      const first = githubRepos[0];
      if (first !== undefined) {
        setSelectedRepo(first);
      }
    }
  }, [githubRepos, selectedRepo]);

  useEffect(() => {
    if (knowledgeItems.length === 0) {
      setKnowledgeItemId("");
      return;
    }
    let itemKnown = false;
    for (const item of knowledgeItems) {
      if (item.id === knowledgeItemId) {
        itemKnown = true;
      }
    }
    if (itemKnown !== true) {
      const first = knowledgeItems[0];
      if (first !== undefined) {
        setKnowledgeItemId(first.id);
      }
    }
  }, [knowledgeItems, knowledgeItemId]);

  const githubEvent = eventType.startsWith("github.");
  const knowledgeAction = action === "propose_knowledge";
  const knowledgeOutputs = knowledgeOutputKinds(includeDocument, includeDiagram);
  const knowledgeReady = knowledgeItemId.length > 0 && knowledgeOutputs.length > 0;

  async function handleCreate(): Promise<void> {
    setSaving(true);
    try {
      let repo = "";
      if (githubEvent) {
        repo = selectedRepo;
      }
      if (knowledgeAction) {
        await createProjectReaction(session, props.projectId, {
          action: "propose_knowledge",
          eventType,
          repo,
          enabled: true,
          knowledgeItemId,
          knowledgeOutputs,
        });
      }
      if (knowledgeAction !== true) {
        await createProjectReaction(session, props.projectId, {
          action: "create_task",
          eventType,
          repo,
          titleTemplate: titleTemplate.trim(),
          enabled: true,
        });
      }
      toast.success("Reaction saved");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save reaction");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(reactionId: string): Promise<void> {
    try {
      await deleteProjectReaction(session, props.projectId, reactionId);
      toast.success("Reaction removed");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove reaction");
    }
  }

  return (
    <section className="panel-card mb-5 space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold">Reactions</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          An event can create a task for a person, or keep knowledge updated without a task. Documentation
          is not a task. Approve proposed versions on the Knowledge page.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="reaction-event">When</Label>
          <Select
            id="reaction-event"
            value={eventType}
            onChange={(event) => {
              const next = event.target.value;
              setEventType(next);
              setTitleTemplate(defaultTitle(next));
            }}
          >
            {eventTypes.map((typeName) => (
              <option key={typeName} value={typeName}>
                {eventTypeLabel(typeName)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="reaction-action">Then</Label>
          <Select
            id="reaction-action"
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
            }}
          >
            <option value="create_task">Create a task</option>
            <option value="propose_knowledge">Keep knowledge updated</option>
          </Select>
        </div>
        {githubEvent && githubRepos.length > 1 ? (
          <div className="space-y-2">
            <Label htmlFor="reaction-repo">Repository</Label>
            <Select
              id="reaction-repo"
              value={selectedRepo}
              onChange={(event) => {
                setSelectedRepo(event.target.value);
              }}
            >
              {githubRepos.map((repo) => (
                <option key={repo} value={repo}>
                  {repo}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {githubEvent && githubRepos.length === 1 ? (
          <div className="space-y-2">
            <Label>Repository</Label>
            <p className="flex h-10 items-center text-sm">{githubRepos[0]}</p>
          </div>
        ) : null}
        {knowledgeAction ? (
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="reaction-knowledge">Knowledge brief</Label>
            {knowledgeItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Create a brief on{" "}
                <Link className="underline underline-offset-2" to={`/projects/${props.projectId}/knowledge`}>
                  Knowledge
                </Link>{" "}
                first.
              </p>
            ) : (
              <Select
                id="reaction-knowledge"
                value={knowledgeItemId}
                onChange={(event) => {
                  setKnowledgeItemId(event.target.value);
                }}
              >
                {knowledgeItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.subject}
                  </option>
                ))}
              </Select>
            )}
            <div className="flex flex-wrap gap-4 pt-1">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={includeDocument}
                  onChange={(event) => {
                    setIncludeDocument(event.target.checked);
                  }}
                />
                Document
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={includeDiagram}
                  onChange={(event) => {
                    setIncludeDiagram(event.target.checked);
                  }}
                />
                Diagram
              </label>
              <Button type="button" size="sm" disabled={saving || knowledgeReady !== true} onClick={() => void handleCreate()}>
                Add
              </Button>
            </div>
          </div>
        ) : (
          <div className={`space-y-2 ${githubEvent && githubRepos.length > 0 ? "sm:col-span-2" : "sm:col-span-2 xl:col-span-2"}`}>
            <Label htmlFor="reaction-title">Create task</Label>
            <div className="flex gap-2">
              <Input
                id="reaction-title"
                value={titleTemplate}
                placeholder="Review this pull request"
                onChange={(event) => {
                  setTitleTemplate(event.target.value);
                }}
              />
              <Button type="button" size="sm" disabled={saving} onClick={() => void handleCreate()}>
                Add
              </Button>
            </div>
          </div>
        )}
      </div>
      {githubConnected !== true ? (
        <p className="text-xs text-muted-foreground">
          Pull request reactions appear after you paste a token in{" "}
          <Link className="underline underline-offset-2" to="/settings">
            Settings
          </Link>
          .
        </p>
      ) : null}
      {githubConnected && githubRepos.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          This project folder has no GitHub remote, so pull request reactions stay hidden.
        </p>
      ) : null}
      {reactions.length === 0 ? (
        <p className="text-xs text-muted-foreground">No reactions yet.</p>
      ) : (
        <ul className="space-y-2">
          {reactions.map((reaction) => (
            <li
              key={reaction.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-white/[0.08] px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{eventTypeLabel(reaction.eventType)}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {reaction.action === "propose_knowledge" ? "Keep knowledge updated" : "Create a task"}
                  {" · "}
                  {reaction.repo.length > 0 ? reaction.repo : "This project"}
                  {" · "}
                  {reactionSummary(reaction, knowledgeItems)}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  void handleDelete(reaction.id);
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {events.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Recent events
          </p>
          <ul className="space-y-1">
            {events.map((row) => (
              <li key={row.id} className="truncate text-[11px] text-muted-foreground">
                {eventTypeLabel(row.type)}
                {row.path.length > 0 ? ` · ${row.path}` : ""}
                {row.detail.length > 0 ? ` #${row.detail}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
