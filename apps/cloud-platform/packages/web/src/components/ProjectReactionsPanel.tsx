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
  fetchProjectReactions,
  type LotaruReaction,
} from "@/lib/api";
import { catalogEventLabel } from "@/lib/event-catalog";

function defaultTitle(eventType: string): string {
  if (eventType.startsWith("github.")) {
    return "Review PR #{{detail}}";
  }
  if (eventType === "file.changed") {
    return "Handle {{path}} change";
  }
  if (eventType === "voice.intent") {
    return "{{detail}}";
  }
  if (eventType === "app.started") {
    return "App started — {{detail}}";
  }
  return "Handle {{type}}";
}

function reactionTemplateHint(eventType: string): string {
  if (eventType === "voice.intent") {
    return "{{path}} is the transcript. {{detail}} is the intent title and summary.";
  }
  if (eventType.startsWith("github.")) {
    return "{{detail}} is the pull request number. {{path}} is owner/repo.";
  }
  if (eventType === "file.changed") {
    return "{{path}} is the saved file path.";
  }
  return "{{type}}, {{path}}, and {{detail}} expand from the event.";
}

function taskReactions(rows: LotaruReaction[]): LotaruReaction[] {
  const tasks: LotaruReaction[] = [];
  for (const row of rows) {
    if (row.action === "create_task") {
      tasks.push(row);
    }
  }
  return tasks;
}

type Props = {
  projectId: string;
};

export function ProjectReactionsPanel(props: Props): React.JSX.Element {
  const session = useSession();
  const [reactions, setReactions] = useState<LotaruReaction[]>([]);
  const [eventTypes, setEventTypes] = useState<string[]>(["file.changed"]);
  const [eventType, setEventType] = useState("file.changed");
  const [githubRepos, setGithubRepos] = useState<string[]>([]);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [titleTemplate, setTitleTemplate] = useState(defaultTitle("file.changed"));
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    const listed = await fetchProjectReactions(session, props.projectId);
    setReactions(taskReactions(listed.reactions));
    setEventTypes(listed.eventTypes);
    setGithubRepos(listed.githubRepos);
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

  const githubEvent = eventType.startsWith("github.");

  async function handleCreate(): Promise<void> {
    setSaving(true);
    try {
      let repo = "";
      if (githubEvent) {
        repo = selectedRepo;
      }
      await createProjectReaction(session, props.projectId, {
        action: "create_task",
        eventType,
        repo,
        titleTemplate: titleTemplate.trim(),
        enabled: true,
      });
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
    <section className="panel-card space-y-4 p-5">
      <p className="text-xs leading-relaxed text-muted-foreground">
        When a catalog event fires — file save, clock, GitHub, or{" "}
        <Link
          className="underline underline-offset-2"
          to={`/projects/${props.projectId}/voice`}
        >
          voice intent
        </Link>
        — create a task. GitHub token lives in{" "}
        <Link className="underline underline-offset-2" to="/settings#github">
          Settings
        </Link>
        .
      </p>
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
                {catalogEventLabel(typeName)}
              </option>
            ))}
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
        <div className="space-y-2 sm:col-span-2 xl:col-span-2">
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
          <p className="text-[11px] text-muted-foreground">{reactionTemplateHint(eventType)}</p>
        </div>
      </div>
      {reactions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-8 text-center">
          <p className="text-sm font-medium">No reactions yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Pick an event above and Add. Voice intents only fire when the scanner emits — wire{" "}
            <span className="font-medium text-foreground">Voice intent</span> here to turn speech into
            tasks.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {reactions.map((reaction) => (
            <li
              key={reaction.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{catalogEventLabel(reaction.eventType)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {reaction.action === "create_task" ? reaction.titleTemplate : reaction.id}
                </p>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => void handleDelete(reaction.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
