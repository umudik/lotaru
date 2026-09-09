import { useCallback, useEffect, useState } from "react";
import { Loader2, Volume2 } from "lucide-react";
import { VoiceSettingsLink } from "@/components/VoiceSettingsLink";
import { PageContent } from "@/components/layout/PageContent";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { useSpeakPlayer } from "@/features/speak/SpeakPlayerContext";
import { useSession } from "@/hooks/useSession";
import {
  createSpeakUtterance,
  fetchSpeakUtterances,
  type SpeakUtterance,
} from "@/lib/api";
import { cn, formatMillis } from "@/lib/utils";

function sourceLabel(source: SpeakUtterance["source"]): string {
  if (source === "mcp") {
    return "MCP";
  }
  if (source === "note") {
    return "Notes";
  }
  return "Speak";
}

function speakLoadFailure(err: unknown): string {
  if (err instanceof Error) {
    const text = err.message.trim();
    if (text.length > 0) {
      return text;
    }
  }
  return "Could not load speak queue.";
}

function statusLabel(status: SpeakUtterance["status"], playing: boolean): string {
  if (playing === true) {
    return "Playing";
  }
  if (status === "queued") {
    return "Queued";
  }
  if (status === "ready") {
    return "Ready";
  }
  if (status === "played") {
    return "Played";
  }
  return "Failed";
}

export function SpeakPage(props: { projectId: string }): React.JSX.Element {
  const session = useSession();
  const speak = useSpeakPlayer();
  const [draft, setDraft] = useState("");
  const [rows, setRows] = useState<SpeakUtterance[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    const data = await fetchSpeakUtterances(session, props.projectId);
    setRows(data.utterances);
  }, [session, props.projectId]);

  useEffect(() => {
    let cancelled = false;
    void load()
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        setError(speakLoadFailure(err));
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setLoading(false);
      });
    const timer = window.setInterval(() => {
      void load().catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        setError(speakLoadFailure(err));
      });
    }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    if (speak.speaking === true) {
      return;
    }
    void load().catch((err: unknown) => {
      setError(speakLoadFailure(err));
    });
  }, [load, speak.speaking]);

  async function submit(): Promise<void> {
    const text = draft.trim();
    if (text.length === 0) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const utterance = await createSpeakUtterance(session, props.projectId, text, "ui");
      setDraft("");
      speak.arm();
      await speak.playUtterance(utterance.id);
      await load();
    } catch (err) {
      if (err instanceof Error && err.message.trim().length > 0) {
        setError(err.message);
      } else {
        setError("Speak failed");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Speak"
        info="Lotaru reads this aloud with the voice in Settings. Notes and MCP share this queue."
        actions={<VoiceSettingsLink />}
      />
      <PageContent className="space-y-4 overflow-y-auto">
        {error.length > 0 || speak.error.length > 0 ? (
          <p className="text-sm text-destructive">{error.length > 0 ? error : speak.error}</p>
        ) : null}
        <form
          className="panel-card space-y-3 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="block text-sm font-medium" htmlFor="speak-draft">
            Say this
          </label>
          <textarea
            id="speak-draft"
            className="min-h-[7rem] w-full resize-none rounded-md border border-border bg-transparent px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Type what Lotaru should read. MCP speak and new notes land in the same queue."
          />
          <div className="flex items-center justify-end gap-2">
            <Button type="submit" disabled={saving || draft.trim().length === 0}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
              Speak
            </Button>
          </div>
        </form>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading queue…
          </div>
        ) : (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Recent</h2>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing spoken yet.</p>
            ) : (
              <ul className="space-y-2">
                {rows.map((row) => {
                  const playing =
                    speak.current !== null && speak.current.id === row.id && speak.speaking === true;
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        className={cn(
                          "w-full rounded-xl border border-border/70 px-3 py-3 text-left transition-colors hover:bg-secondary/50",
                          playing && "bg-secondary",
                        )}
                        onClick={() => {
                          speak.arm();
                          void speak.playUtterance(row.id);
                        }}
                      >
                        <p className="line-clamp-3 text-sm">{row.text}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {sourceLabel(row.source)} · {statusLabel(row.status, playing)} · {formatMillis(row.createdAt)}
                        </p>
                        {row.error.length > 0 ? (
                          <p className="mt-1 text-[11px] text-destructive">{row.error}</p>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </PageContent>
    </div>
  );
}
