import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { VoiceSettingsLink } from "@/components/VoiceSettingsLink";
import { PageContent } from "@/components/layout/PageContent";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { useVoiceListen } from "@/features/voice/VoiceListenContext";
import { VoiceWaveform } from "@/features/voice/VoiceWaveform";
import { useSession } from "@/hooks/useSession";
import {
  ApiError,
  fetchVoiceSegments,
  fetchVoiceStatus,
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
      return "Voice history is not available.";
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
      return "Mic is off. Use Listen in the sidebar footer.";
    }
    return "Speech engine is warming up. Try Listen in the sidebar in a moment.";
  }
  if (phase === "speaking") {
    return "Wave moves with your voice — keep talking.";
  }
  if (phase === "quiet") {
    return "Short pause. Keep going, or wait ~2s to finish this line.";
  }
  return "Speak — waveform shows the mic is live.";
}

export function VoicePage(): React.JSX.Element {
  const session = useSession();
  const voice = useVoiceListen();
  const [segments, setSegments] = useState<VoiceSegment[]>([]);
  const [nextCursor, setNextCursor] = useState("");
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
        const status = await fetchVoiceStatus(session);
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
  }, [session]);

  useEffect(() => {
    if (session === null) {
      return;
    }
    setLoading(true);
    void fetchVoiceSegments(session, { limit: TRANSCRIPT_PAGE })
      .then((segmentData) => {
        setSegments(segmentData.segments);
        const nextPage = segmentData.next[0];
        if (nextPage !== undefined) {
          setNextCursor(nextPage);
        } else {
          setNextCursor("");
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(voiceHistoryLoadError(err));
        setLoading(false);
      });
  }, [session]);

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

  async function loadMore(): Promise<void> {
    if (session === null || nextCursor.length === 0 || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await fetchVoiceSegments(session, {
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

  const listeningLive = voice.listening;
  const liveArmed = voice.armed;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Voice"
        info="Speak to text for you, not a project. Event extractors on a project read this transcript and emit into that project."
        actions={<VoiceSettingsLink />}
      />
      <PageContent className="space-y-4 overflow-y-auto">
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
                      ? "text-success"
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
                    ? "text-warn"
                    : voice.phase === "speaking"
                      ? "text-success"
                      : "text-muted-foreground",
                )}
                aria-live="polite"
              >
                {livePhaseLabel(listeningLive, voice.phase, voice.reconnecting)}
              </p>
            </div>
          </div>
          <VoiceWaveform
            stream={liveArmed ? voice.mediaStream : null}
            active={listeningLive}
            className={cn(
              "border border-border/60",
              listeningLive ? "opacity-100" : "opacity-40",
            )}
          />
          <p className="min-h-[3rem] text-sm text-foreground" aria-live="polite">
            {liveHint(
              listeningLive,
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
        <section className="panel-card space-y-2 p-4">
          <h2 className="text-sm font-semibold">Event extractors</h2>
          <p className="text-sm text-muted-foreground">
            Extractors live on a project. They read this transcript and emit into that project.
          </p>
          <Link
            className="inline-block text-sm font-medium underline underline-offset-2"
            to="/projects"
          >
            Open a project
          </Link>
        </section>
      </PageContent>
    </div>
  );
}
