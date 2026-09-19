import { FolderOpen, Github, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Session } from "@/lib/session";
import {
  createProject,
  DEFAULT_WORKFLOW_TEMPLATE_ID,
  fetchGitProviders,
  fetchGitRepos,
  fetchGithubConnectUrl,
  GIT_PROVIDERS,
  pickProjectFolder,
  type GitProviderId,
  type GitProviderStatus,
  type GitRemoteRepo,
  type Project,
} from "@/lib/api";

type CreateProjectPanelProps = {
  session: Session;
  onCreated: (project: Project) => void;
  onCancel: () => void;
};

function gitProviderFromSelect(value: string): GitProviderId[] {
  const trimmed = value.trim();
  const hits: GitProviderId[] = [];
  if (trimmed.length === 0) {
    return hits;
  }
  for (const option of GIT_PROVIDERS) {
    if (option.id === trimmed) {
      hits.push(option.id);
    }
  }
  return hits;
}

function nameFromFolder(folderPath: string): string {
  const parts = folderPath.split(/[/\\]/);
  let last = "";
  for (const part of parts) {
    if (part.length > 0) {
      last = part;
    }
  }
  if (last.length > 0) {
    return last;
  }
  return folderPath;
}

export function CreateProjectPanel({
  session,
  onCreated,
  onCancel,
}: CreateProjectPanelProps) {
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [useGit, setUseGit] = useState(false);
  const [folderPath, setFolderPath] = useState("");
  const [provider, setProvider] = useState<GitProviderId>("github");
  const [providers, setProviders] = useState<GitProviderStatus[]>([]);
  const [repos, setRepos] = useState<GitRemoteRepo[]>([]);
  const [fullName, setFullName] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  async function loadProviders(): Promise<GitProviderStatus[]> {
    const listed = await fetchGitProviders(session);
    setProviders(listed.providers);
    return listed.providers;
  }

  async function loadRepos(nextProvider: GitProviderId, listed: readonly GitProviderStatus[]): Promise<void> {
    const row = listed.find((item) => item.id === nextProvider);
    if (row === undefined || row.connected !== true) {
      setRepos([]);
      return;
    }
    const body = await fetchGitRepos(session, nextProvider);
    setRepos(body.repos);
  }

  async function loadGit(nextProvider: GitProviderId): Promise<void> {
    setLoading(true);
    try {
      const listed = await loadProviders();
      await loadRepos(nextProvider, listed);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load git providers");
      setRepos([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleProviderChange(nextProvider: GitProviderId): Promise<void> {
    setProvider(nextProvider);
    setFullName("");
    await loadGit(nextProvider);
  }

  async function handleConnectGithub(): Promise<void> {
    setConnecting(true);
    try {
      const { url } = await fetchGithubConnectUrl(session);
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start GitHub connect");
      setConnecting(false);
    }
  }

  async function handlePickFolder(): Promise<void> {
    setPicking(true);
    try {
      const result = await pickProjectFolder(session);
      if (result.path.length === 0) {
        return;
      }
      setFolderPath(result.path);
      if (name.trim().length === 0) {
        setName(nameFromFolder(result.path));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to pick folder");
    } finally {
      setPicking(false);
    }
  }

  function selectedRepo(): GitRemoteRepo | null {
    for (const repo of repos) {
      if (repo.fullName === fullName) {
        return repo;
      }
    }
    return null;
  }

  async function handleCreate(): Promise<void> {
    setCreating(true);
    try {
      if (useGit === true) {
        const repo = selectedRepo();
        if (repo === null) {
          setCreating(false);
          return;
        }
        const trimmedName = name.trim().length > 0 ? name.trim() : repo.repo;
        const created = await createProject(session, {
          name: trimmedName,
          description: description.trim(),
          workflowTemplateId: DEFAULT_WORKFLOW_TEMPLATE_ID,
          git: {
            provider: repo.provider,
            owner: repo.owner,
            repo: repo.repo,
            branch: repo.defaultBranch,
          },
        });
        onCreated(created);
        if (created.git !== null) {
          toast.success(`Following ${created.git.owner}/${created.git.repo}`);
        }
        return;
      }
      const trimmedPath = folderPath.trim();
      const trimmedName = name.trim().length > 0 ? name.trim() : nameFromFolder(trimmedPath);
      const created = await createProject(session, {
        name: trimmedName,
        description: description.trim(),
        workflowTemplateId: DEFAULT_WORKFLOW_TEMPLATE_ID,
        repoPath: trimmedPath,
      });
      onCreated(created);
      if (created.git !== null) {
        toast.success(`Following ${created.git.owner}/${created.git.repo}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  }

  const currentProvider = providers.find((item) => item.id === provider);
  const connected = currentProvider !== undefined && currentProvider.connected === true;
  const providerChoices = providers.length > 0 ? providers : GIT_PROVIDERS;
  let providerLabel = "git provider";
  if (currentProvider !== undefined) {
    providerLabel = currentProvider.label;
  } else {
    for (const option of GIT_PROVIDERS) {
      if (option.id === provider) {
        providerLabel = option.label;
      }
    }
  }
  const busy = creating || loading || connecting || picking;
  let canSubmit = false;
  if (useGit === true) {
    canSubmit = selectedRepo() !== null && creating !== true;
  } else {
    canSubmit = folderPath.trim().length > 0 && creating !== true;
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">New project</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A project is a path. A local folder that is already a git clone is followed from its
          origin. A git provider pick is cloned into Lotaru, then followed.
        </p>
      </div>

      <div className="panel-card space-y-5 p-6">
        <div className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.08] px-4 py-3">
          <div className="min-w-0">
            <Label htmlFor="project-use-git">Select git provider</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              {useGit === true
                ? "Clone that repository into Lotaru and follow its pull requests and other git events."
                : "Use this folder. If it is already a clone, Lotaru follows its origin — no second copy."}
            </p>
          </div>
          <Switch
            id="project-use-git"
            checked={useGit}
            disabled={busy}
            onCheckedChange={(next) => {
              setUseGit(next);
              if (next === true) {
                void loadGit(provider);
              }
            }}
          />
        </div>

        {useGit !== true ? (
          <div className="space-y-2">
            <Label htmlFor="project-folder">Folder</Label>
            <div className="flex gap-2">
              <Input
                id="project-folder"
                value={folderPath}
                onChange={(event) => setFolderPath(event.target.value)}
                placeholder="C:\Users\you\Documents\my-project"
                disabled={busy}
              />
              <Button type="button" variant="outline" onClick={() => void handlePickFolder()} disabled={busy}>
                {picking ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
                Browse
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="project-provider">Provider</Label>
              <Select
                id="project-provider"
                value={provider}
                disabled={busy}
                onChange={(event) => {
                  const next = gitProviderFromSelect(event.target.value);
                  const selected = next[0];
                  if (selected === undefined) {
                    return;
                  }
                  void handleProviderChange(selected);
                }}
              >
                {providerChoices.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>

            {connected !== true ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Connect {providerLabel} first, then pick a repository.
                </p>
                <div className="flex flex-wrap gap-2">
                  {provider === "github" ? (
                    <Button type="button" disabled={busy} onClick={() => void handleConnectGithub()}>
                      {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Github className="h-4 w-4" />}
                      Connect GitHub
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" asChild={true}>
                    <Link to="/settings#connections">Open connections</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="project-repo">Repository</Label>
                <Select
                  id="project-repo"
                  value={fullName}
                  disabled={busy}
                  onChange={(event) => {
                    const next = event.target.value;
                    setFullName(next);
                    const hit = repos.find((item) => item.fullName === next);
                    if (hit !== undefined && name.trim().length === 0) {
                      setName(hit.repo);
                    }
                  }}
                >
                  <option value="">Select a repository</option>
                  {repos.map((repo) => (
                    <option key={repo.fullName} value={repo.fullName}>
                      {repo.fullName}
                      {repo.private ? " (private)" : ""}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </>
        )}

        <div className="space-y-2">
          <Label htmlFor="project-name">Name</Label>
          <Input
            id="project-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="My project"
            disabled={busy}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="project-description">Description</Label>
          <Textarea
            id="project-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Optional notes about this project"
            rows={3}
            disabled={busy}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={busy || canSubmit !== true} onClick={() => void handleCreate()}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}
