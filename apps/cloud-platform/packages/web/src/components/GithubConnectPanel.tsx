import { useState } from "react";
import { Link } from "react-router-dom";
import { Github, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/useSession";
import { saveGithubSettings } from "@/lib/api";

export function GithubConnectPanel(props: {
  connected: boolean;
  repos: readonly string[];
  onChanged: () => void;
  framed?: boolean;
}): React.JSX.Element {
  const session = useSession();
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);

  async function saveToken(): Promise<void> {
    if (session === null) {
      return;
    }
    setSaving(true);
    try {
      const saved = await saveGithubSettings(session, token);
      setToken("");
      if (saved.connected) {
        toast.success("GitHub token saved");
      } else {
        toast.success("GitHub token cleared");
      }
      props.onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save GitHub token");
    } finally {
      setSaving(false);
    }
  }

  let status = "Not connected";
  let statusClass = "text-muted-foreground";
  if (props.connected) {
    status = "Connected";
    statusClass = "text-success";
  }

  let remotes = "This project folder has no github.com remote yet.";
  if (props.repos.length === 1) {
    const only = props.repos[0];
    if (only !== undefined) {
      remotes = `Watching ${only}`;
    }
  }
  if (props.repos.length > 1) {
    remotes = `Watching ${props.repos.join(", ")}`;
  }

  let wrapClass = "panel-card space-y-4 p-5";
  if (props.framed === false) {
    wrapClass = "space-y-4 border-b border-white/[0.08] pb-4";
  }

  return (
    <section className={wrapClass}>
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary">
          <Github className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">GitHub</h2>
            <span className={`text-xs ${statusClass}`}>{status}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Paste a personal access token so Lotaru can record pull request opened, updated, and
            merged events from this folder’s remotes.
          </p>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="github-connect-token">Token</Label>
        <div className="flex gap-2">
          <Input
            id="github-connect-token"
            type="password"
            value={token}
            placeholder={props.connected ? "Paste a new token to replace" : "ghp_…"}
            onChange={(event) => {
              setToken(event.target.value);
            }}
          />
          <Button type="button" variant="outline" disabled={saving} onClick={() => void saveToken()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </div>
      {props.connected ? (
        <p className="text-xs text-muted-foreground">{remotes}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Token also lives in{" "}
          <Link className="underline underline-offset-2" to="/settings#github">
            Settings
          </Link>
          . Repo scope is enough to list pull requests.
        </p>
      )}
    </section>
  );
}
