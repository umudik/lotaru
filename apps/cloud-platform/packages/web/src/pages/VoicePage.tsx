import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { useVoiceListen } from "@/features/voice/VoiceListenContext";
import { VoiceWaveform } from "@/features/voice/VoiceWaveform";
import { useSession } from "@/hooks/useSession";
import {
  ApiError,
  fetchVoiceDecisions,
  fetchVoiceSegments,
  fetchVoiceStatus,
  type VoiceIntentDecision,
  type VoiceSegment,
} from "@/lib/api";
import { cn, formatMillis } from "@/lib/utils";

const TRANSCRIPT_PAGE = 40;

function voiceHistoryLoadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) {
      return "Voice API is missing on this server — restart Lotaru.";
    }
    if (err.status === 403) {
      return "This project is not available for voice history.";
    }
    if (err.status === 401) {
      return "Sign in again to load voice history.";
    }
    if (err.message.length > 0) {
      return err.message;
    }
  }
  if (err instanceof Error && err.message.length > 0) {
    return err.message;
  }
  return "Could not load voice history.";
}

type SidecarUiState = {
  reachable: boolean;
  model: string;
  language: string;
  device: string;
  checked: boolean;
};

function livePhaseLabel(
  listeningThisProject: boolean,
  phase: string,
  reconnecting: boolean,
): string {
  if (reconnecting) {
    return "Reconnecting…";
  }
  if (listeningThisProject !== true) {
    return "Idle";
  }
  if (phase === "speaking") {
    return "Hearing you";
  }
  if (phase === "quiet") {
    return "Pause… (~2s ends the line)";
  }
  if (phase === "connecting") {
    return "Connecting…";
  }
  return "Listening";
}

function liveHint(
  listeningThisProject: boolean,
  phase: string,
  reconnecting: boolean,
  partial: string,
  sidecarReachable: boolean,
): string {
  if (partial.length > 0) {
    return partial;
  }
  if (reconnecting) {
    return "Connection dropped — starting again automatically.";
  }
  if (listeningThisProject !== true) {
    if (sidecarReachable) {
      return "Mic is off. Press Listen.";
    }
    return "Speech engine is warming up. Try Listen in a moment.";
  }
  if (phase === "speaking") {
    return "Wave moves with your voice — keep talking.";
  }
  if (phase === "quiet") {
    return "Short pause. Keep going, or wait ~2s to finish this line.";
  }
  return "Speak — waveform shows the mic is live.";
}

export function VoicePage(props: { projectId: string }): React.JSX.Element {
  const session = useSession();
  const voice = useVoiceListen();
  const [segments, setSegments] = useState<VoiceSegment[]>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [decisions, setDecisions] = useState<VoiceIntentDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [sidecarUi, setSidecarUi] = useState<SidecarUiState>({
    reachable: false,
    model: "",
    language: "",
    device: "",
    checked: false,
  });

    useEffect(() => {
    if (session === null) {
      return;
    }
    let cancelled = false;
    async function refreshSidecar(): Promise<void> {
      try {
        const status = await fetchVoiceStatus(session, props.projectId);
        if (cancelled) {
          return;
        }
        setSidecarUi({
          reachable: status.sidecarReachable,
          model: status.sidecarModel,
          language: status.sidecarLanguage,
          device: status.sidecarDevice,
          checked: true,
        });
      } catch {
        if (cancelled) {
          return;
        }
        setSidecarUi({
          reachable: false,
          model: "",
          language: "",
          device: "",
          checked: true,
        });
      }
    }
    void refreshSidecar();
    const timer = window.setInterval(() => {
      void refreshSidecar();
    }, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session, props.projectId]);

  useEffect(() => {
    if (session === null) {
      return;
    }
    setLoading(true);
    void Promise.all([
      fetchVoiceSegments(session, props.projectId, { limit: TRANSCRIPT_PAGE }),
      fetchVoiceDecisions(session, props.projectId, 40),
    ])
      .then(([segmentData, decisionData]) => {
        setSegments(segmentData.segments);
        const nextPage = segmentData.next[0];
        if (nextPage !== undefined) {
          setNextCursor(nextPage);
        } else {
          setNextCursor("");
        }
        const emitted: VoiceIntentDecision[] = [];
        for (const row of decisionData.decisions) {
          if (row.emit) {
            emitted.push(row);
          }
        }
        setDecisions(emitted);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(voiceHistoryLoadError(err));
        setLoading(false);
      });
  }, [session, props.projectId]);

  useEffect(() => {
    if (voice.liveSegments.length === 0) {
      return;
    }
    setSegments((prev) => {
      const merged: VoiceSegment[] = [];
      const seen = new Set<string>();
      for (const segment of voice.liveSegments) {
        if (seen.has(segment.id)) {
          continue;
        }
        seen.add(segment.id);
        merged.push(segment);
      }
      for (const segment of prev) {
        if (seen.has(segment.id)) {
          continue;
        }
        seen.add(segment.id);
        merged.push(segment);
      }
      return merged;
    });
  }, [voice.liveSegments]);

  useEffect(() => {
    if (voice.lastDecision === null) {
      return;
    }
    const decision = voice.lastDecision;
    if (decision.emit !== true) {
      return;
    }
    setDecisions((prev) => {
      const next: VoiceIntentDecision[] = [decision];
      for (const row of prev) {
        if (row.id === decision.id) {
          continue;
        }
        next.push(row);
      }
      return next;
    });
  }, [voice.lastDecision]);

  async function loadMore(): Promise<void> {
    if (session === null || nextCursor.length === 0 || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await fetchVoiceSegments(session, props.projectId, {
        limit: TRANSCRIPT_PAGE,
        cursor: nextCursor,
      });
      setSegments((current) => {
        const merged = current.slice();
        const seen = new Set<string>();
        for (const row of current) {
          seen.add(row.id);
        }
        for (const row of page.segments) {
          if (seen.has(row.id)) {
            continue;
          }
          seen.add(row.id);
          merged.push(row);
        }
        return merged;
      });
      const nextPage = page.next[0];
      if (nextPage !== undefined) {
        setNextCursor(nextPage);
      } else {
        setNextCursor("");
      }
    } catch (err: unknown) {
      setError(voiceHistoryLoadError(err));
    } finally {
      setLoadingMore(false);
    }
  }

  const listeningThisProject = voice.listening && voice.projectId === props.projectId;
  const liveOnThisProject = voice.armed && voice.projectId === props.projectId;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Voice"
        subtitle="Speak → text → work. Transcript is kept; audio is not."
        actions={
          <Button
            type="button"
            size="sm"
            variant={liveOnThisProject ? "destructive" : "default"}
            onClick={() => {
              if (liveOnThisProject) {
                voice.stop();
                return;
              }
              void voice.start(props.projectId).catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "mic failed");
              });
            }}
          >
            {liveOnThisProject ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {liveOnThisProject ? "Stop" : "Listen"}
          </Button>
        }
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {error.length > 0 || voice.error.length > 0 ? (
          <p className="text-sm text-destructive">
            {error.length > 0 ? error : voice.error}
          </p>
        ) : null}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading transcript…
          </div>
        ) : null}
        <section className="panel-card space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Live</h2>
            <div className="flex flex-wrap items-center gap-3">
              <p
                className={cn(
                  "text-xs font-medium",
                  sidecarUi.checked !== true
                    ? "text-muted-foreground"
                    : sidecarUi.reachable
                      ? "text-emerald-400"
                      : "text-destructive",
                )}
                aria-live="polite"
              >
                {sidecarUi.checked !== true
                  ? "STT…"
                  : sidecarUi.reachable
                    ? `STT ready${sidecarUi.model.length > 0 ? ` · ${sidecarUi.model}` : ""}${sidecarUi.language.length > 0 ? `/${sidecarUi.language}` : ""}${sidecarUi.device.length > 0 ? ` · ${sidecarUi.device}` : ""}`
                    : "Speech engine offline"}
              </p>
              <p
                className={cn(
                  "text-xs font-medium",
                  voice.reconnecting
                    ? "text-amber-400"
                    : voice.phase === "speaking"
                      ? "text-emerald-400"
                      : "text-muted-foreground",
                )}
                aria-live="polite"
              >
                {livePhaseLabel(listeningThisProject, voice.phase, voice.reconnecting)}
              </p>
            </div>
          </div>
          <VoiceWaveform
            stream={liveOnThisProject ? voice.mediaStream : null}
            active={listeningThisProject}
            className={cn(
              "border border-border/60",
              listeningThisProject ? "opacity-100" : "opacity-40",
            )}
          />
          <p className="min-h-[3rem] text-sm text-foreground" aria-live="polite">
            {liveHint(
              listeningThisProject,
              voice.phase,
              voice.reconnecting,
              voice.partialText,
              sidecarUi.reachable,
            )}
          </p>
        </section>
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Transcript</h2>
          <p className="text-[11px] text-muted-foreground">
            One row after a ~2s pause. Natural pauses no longer chop every breath.
          </p>
          {loading !== true && segments.length === 0 ? (
            <div className="panel-card space-y-3 px-6 py-10 text-center">
              <p className="text-sm font-semibold">No utterances yet</p>
              <p className="text-sm text-muted-foreground">
                Final lines land here after each pause. Audio is never kept.
              </p>
            </div>
          ) : (
            <>
              <ul className="space-y-2">
                {segments.map((segment) => (
                  <li key={segment.id} className="panel-card space-y-1 p-4">
                    <p className="text-sm leading-relaxed">{segment.text}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatMillis(segment.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
              {nextCursor.length > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={loadingMore}
                  onClick={() => {
                    void loadMore();
                  }}
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading
                    </>
                  ) : (
                    "Load older"
                  )}
                </Button>
              ) : null}
            </>
          )}
        </section>
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Work</h2>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                className="text-[11px] text-muted-foreground underline underline-offset-2"
                to={`/projects/${props.projectId}/agents`}
              >
                Agents
              </Link>
              <Link
                className="text-[11px] text-muted-foreground underline underline-offset-2"
                to={`/projects/${props.projectId}/tasks`}
              >
                Tasks
              </Link>
              <Link
                className="text-[11px] text-muted-foreground underline underline-offset-2"
                to={`/projects/${props.projectId}/events?type=voice.intent`}
              >
                Events
              </Link>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Emitted voice.intent events. Use Agents for scheduled or event-driven follow-up.
          </p>
          {voice.lastDecision !== null && voice.lastDecision.emit === true ? (
            <div className="panel-card space-y-2 border border-emerald-500/30 bg-emerald-500/5 p-4">
              <p className="text-sm font-medium">
                Latest intent
                {voice.lastDecision.title.length > 0 ? ` — ${voice.lastDecision.title}` : ""}
              </p>
              {voice.lastDecision.summary.length > 0 ? (
                <p className="text-xs text-muted-foreground">{voice.lastDecision.summary}</p>
              ) : null}
              <Link
                className="inline-block text-xs font-medium underline underline-offset-2"
                to={`/projects/${props.projectId}/tasks`}
              >
                Open Tasks
              </Link>
            </div>
          ) : null}
          {loading !== true && decisions.length === 0 ? (
            <div className="panel-card space-y-2 px-6 py-10 text-center">
              <p className="text-sm font-semibold">No work intents yet</p>
              <p className="text-sm text-muted-foreground">
                Clear asks (“create a task…”) emit here. Greetings stay in the transcript only.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {decisions.map((decision) => (
                <li key={decision.id} className="panel-card p-4 text-sm">
                  <p className="font-medium">
                    {decision.title.length > 0 ? decision.title : "voice.intent"}
                  </p>
                  {decision.summary.length > 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">{decision.summary}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-3">
                    <Link
                      className="text-[11px] text-muted-foreground underline underline-offset-2"
                      to={`/projects/${props.projectId}/tasks`}
                    >
                      Tasks
                    </Link>
                    <Link
                      className="text-[11px] text-muted-foreground underline underline-offset-2"
                      to={`/projects/${props.projectId}/events?type=voice.intent`}
                    >
                      Event
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
