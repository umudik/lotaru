import { FolderOpen, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Session } from "@/lib/session";
import {
  createProject,
  DEFAULT_WORKFLOW_TEMPLATE_ID,
  pickProjectFolder,
  type Project,
} from "@/lib/api";

type CreateProjectPanelProps = {
  session: Session;
  onCreated: (project: Project) => void;
  onCancel: () => void;
};

function folderNameFromPath(folderPath: string): string {
  const trimmed = folderPath.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  const last = parts[parts.length - 1];
  if (last === undefined) {
    return "";
  }
  return last;
}

export function CreateProjectPanel({
  session,
  onCreated,
  onCancel,
}: CreateProjectPanelProps) {
  const [creating, setCreating] = useState(false);
  const [picking, setPicking] = useState(false);
  const [name, setName] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [description, setDescription] = useState("");

  async function handlePickFolder() {
    setPicking(true);
    try {
      const result = await pickProjectFolder(session);
      if (result.path.length === 0) {
        return;
      }
      setFolderPath(result.path);
      if (name.trim().length === 0) {
        setName(folderNameFromPath(result.path));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to pick folder");
    } finally {
      setPicking(false);
    }
  }

  async function handleCreate() {
    const trimmedName = name.trim();
    const trimmedPath = folderPath.trim();
    if (!trimmedName) return;
    if (!trimmedPath) return;

    setCreating(true);
    try {
      const created = await createProject(session, {
        name: trimmedName,
        description: description.trim(),
        workflowTemplateId: DEFAULT_WORKFLOW_TEMPLATE_ID,
        repoPath: trimmedPath,
      });
      onCreated(created);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  }

  const canSubmit = Boolean(name.trim()) && Boolean(folderPath.trim());
  const busy = creating || picking;

  return (
    <div className="mx-auto w-full max-w-lg space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">New project</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Open a folder on this machine. Scripts, Terminal, Chat, and Agents use that folder.
        </p>
      </div>

      <div className="panel-card space-y-5 p-6">
        <div className="space-y-2">
          <Label htmlFor="project-folder">Folder</Label>
          <div className="flex gap-2">
            <Input
              id="project-folder"
              value={folderPath}
              onChange={(event) => setFolderPath(event.target.value)}
              placeholder="C:\Users\you\code\my-app"
              disabled={busy}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => void handlePickFolder()}
              disabled={busy}
            >
              {picking ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
              Browse
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="project-name">Name</Label>
          <Input
            id="project-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="My App"
            disabled={busy}
            autoFocus
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
          <Button disabled={busy || !canSubmit} onClick={() => void handleCreate()}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}
