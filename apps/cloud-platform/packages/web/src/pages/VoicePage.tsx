import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { useVoiceListen } from "@/features/voice/VoiceListenContext";
import { useSession } from "@/hooks/useSession";
import {
  fetchVoiceDecisions,
  fetchVoiceSegments,
  voiceSegmentAudioUrl,
  type VoiceIntentDecision,
  type VoiceSegment,
} from "@/lib/api";
import { formatMillis } from "@/lib/utils";

export function VoicePage(props: { projectId: string }): React.JSX.Element {
  const session = useSession();
  const voice = useVoiceListen();
  const [segments, setSegments] = useState<VoiceSegment[]>([]);
  const [decisions, setDecisions] = useState<VoiceIntentDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  let projectLabel = "Project";
  if (session !== null && session.projectName !== null) {
    projectLabel = session.projectName;
  } else if (props.projectId.length > 0) {
    projectLabel = props.projectId;
  }

  useEffect(() => {
    if (session === null) {
      return;
    }
    setLoading(true);
    void Promise.all([
      fetchVoiceSegments(session, props.projectId),
      fetchVoiceDecisions(session, props.projectId),
    ])
      .then(([segmentData, decisionData]) => {
        setSegments(segmentData.segments);
        setDecisions(decisionData.decisions);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "load failed");
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

  const listeningThisProject = voice.listening && voice.projectId === props.projectId;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        context={projectLabel}
        title="Voice"
        subtitle="Live transcript. Intent AI emits voice.intent only when you mean it."
        actions={
          <Button
            type="button"
            size="sm"
            variant={listeningThisProject ? "destructive" : "default"}
            onClick={() => {
              if (listeningThisProject) {
                voice.stop();
                return;
              }
              void voice.start(props.projectId).catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "mic failed");
              });
            }}
          >
            {listeningThisProject ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {listeningThisProject ? "Stop" : "Listen"}
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
            Loading history…
          </div>
        ) : null}
        <section className="panel-card space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Live</h2>
            <p
              className="text-xs font-medium text-muted-foreground"
              aria-live="polite"
            >
              {listeningThisProject ? "Listening" : "Idle"}
            </p>
          </div>
          <p className="min-h-[3rem] text-sm text-foreground">
            {voice.partialText.length > 0
              ? voice.partialText
              : listeningThisProject
                ? "Speak — partials appear here while the sidecar hears you."
                : "Mic is off. Press Listen to stream audio to the sidecar."}
          </p>
          {voice.lastDecision !== null ? (
            <p className="text-xs text-muted-foreground">
              Last scan: {voice.lastDecision.emit ? "emitted voice.intent" : "skipped"} —{" "}
              {voice.lastDecision.reason}
              {voice.lastDecision.emit ? (
                <>
                  {" "}
                  ·{" "}
                  <Link
                    className="underline underline-offset-2"
                    to={`/projects/${props.projectId}/events?type=voice.intent`}
                  >
                    Open Events
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
        </section>
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Transcript</h2>
          {loading !== true && segments.length === 0 ? (
            <div className="panel-card space-y-3 px-6 py-10 text-center">
              <p className="text-sm font-semibold">No utterances yet</p>
              <p className="text-sm text-muted-foreground">
                Final speech segments land here after the sidecar finishes an utterance.
              </p>
              {listeningThisProject !== true ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    void voice.start(props.projectId).catch((err: unknown) => {
                      setError(err instanceof Error ? err.message : "mic failed");
                    });
                  }}
                >
                  <Mic className="h-4 w-4" />
                  Listen
                </Button>
              ) : null}
            </div>
          ) : (
            <ul className="space-y-2">
              {segments.map((segment) => (
                <li key={segment.id} className="panel-card space-y-2 p-4">
                  <p className="text-sm">{segment.text}</p>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>{formatMillis(segment.createdAt)}</span>
                    {segment.audioPath.length > 0 ? (
                      <audio controls src={voiceSegmentAudioUrl(segment.id)} className="h-8" />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Intent decisions</h2>
            <Link
              className="text-[11px] text-muted-foreground underline underline-offset-2"
              to={`/projects/${props.projectId}/events?type=voice.intent`}
            >
              Voice intents on Events
            </Link>
          </div>
          {loading !== true && decisions.length === 0 ? (
            <div className="panel-card space-y-2 px-6 py-10 text-center">
              <p className="text-sm font-semibold">No scans yet</p>
              <p className="text-sm text-muted-foreground">
                After each final utterance, the agent runtime decides whether to emit{" "}
                <span className="font-medium text-foreground">voice.intent</span>.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {decisions.map((decision) => (
                <li key={decision.id} className="panel-card p-4 text-sm">
                  <p className="font-medium">
                    {decision.emit ? "Event" : "Skipped"}
                    {decision.title.length > 0 ? ` — ${decision.title}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{decision.reason}</p>
                  {decision.summary.length > 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">{decision.summary}</p>
                  ) : null}
                  {decision.emit ? (
                    <Link
                      className="mt-2 inline-block text-[11px] text-muted-foreground underline underline-offset-2"
                      to={`/projects/${props.projectId}/events?type=voice.intent`}
                    >
                      View on Events
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
