import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getAccessToken, isCloudHost } from "@/lib/auth";
import { downsampleTo16k, floatTo16BitPcm } from "@/lib/voice-pcm";
import type { VoiceIntentDecision, VoiceSegment } from "@/lib/api";

export type VoiceListenPhase =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "quiet"
  | "reconnecting";

type VoiceListenContextValue = {
  projectId: string;
  armed: boolean;
  listening: boolean;
  reconnecting: boolean;
  phase: VoiceListenPhase;
  level: number;
  partialText: string;
  error: string;
  lastDecision: VoiceIntentDecision | null;
  liveSegments: VoiceSegment[];
  mediaStream: MediaStream | null;
  start: (projectId: string) => Promise<void>;
  stop: () => void;
};

const VoiceListenContext = createContext<VoiceListenContextValue | null>(null);

const RECONNECT_BASE_MS = 800;
const RECONNECT_MAX_MS = 20_000;

function socketIsOpen(socket: WebSocket | null): boolean {
  if (socket === null) {
    return false;
  }
  return socket.readyState === WebSocket.OPEN;
}

function safeSend(socket: WebSocket | null, data: string | ArrayBuffer): void {
  if (socketIsOpen(socket) !== true || socket === null) {
    return;
  }
  try {
    socket.send(data);
  } catch {
  }
}

function pcmBufferForSend(pcm: Int16Array): ArrayBuffer {
  const copy = new ArrayBuffer(pcm.byteLength);
  const view = new Uint8Array(copy);
  const source = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  view.set(source);
  return copy;
}

function mediaStillLive(media: MediaStream | null): boolean {
  if (media === null) {
    return false;
  }
  const tracks = media.getAudioTracks();
  if (tracks.length === 0) {
    return false;
  }
  for (const track of tracks) {
    if (track.readyState !== "live") {
      return false;
    }
  }
  return true;
}

function nextBackoffMs(attempt: number): number {
  const exp = Math.min(RECONNECT_BASE_MS * 2 ** Math.min(attempt, 8), RECONNECT_MAX_MS);
  const jitter = exp * (0.2 * Math.random());
  return Math.floor(exp * 0.9 + jitter);
}

export function VoiceListenProvider(props: { children: ReactNode }): React.JSX.Element {
  const [projectId, setProjectId] = useState("");
  const [armed, setArmed] = useState(false);
  const [listening, setListening] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [phase, setPhase] = useState<VoiceListenPhase>("idle");
  const [partialText, setPartialText] = useState("");
  const [error, setError] = useState("");
  const [lastDecision, setLastDecision] = useState<VoiceIntentDecision | null>(null);
  const [liveSegments, setLiveSegments] = useState<VoiceSegment[]>([]);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [level, setLevel] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const intentionalCloseRef = useRef(false);
  const wantListenRef = useRef(false);
  const sessionRef = useRef(0);
  const projectIdRef = useRef("");
  const reconnectTimerRef = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const levelRafRef = useRef(0);
  const phaseRef = useRef<VoiceListenPhase>("idle");
  const lastLevelEmitRef = useRef(0);
  const startRef = useRef<(nextProjectId: string, mode: "user" | "reconnect") => Promise<void>>(
    async () => undefined,
  );
  const scheduleReconnectRef = useRef<(reason: string) => void>(() => undefined);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== 0) {
      window.clearTimeout(reconnectTimerRef.current);
    }
    reconnectTimerRef.current = 0;
  }, []);

  const stopLevelLoop = useCallback(() => {
    if (levelRafRef.current !== 0) {
      window.cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = 0;
    }
    analyserRef.current = null;
    lastLevelEmitRef.current = 0;
    setLevel(0);
  }, []);

  const teardownAudioGraph = useCallback(() => {
    stopLevelLoop();
    const processor = processorRef.current;
    if (processor !== null) {
      processor.disconnect();
      processorRef.current = null;
    }
    const audioCtx = audioCtxRef.current;
    if (audioCtx !== null) {
      void audioCtx.close();
      audioCtxRef.current = null;
    }
  }, [stopLevelLoop]);

  const teardownMedia = useCallback(() => {
    teardownAudioGraph();
    const media = mediaRef.current;
    if (media !== null) {
      for (const track of media.getTracks()) {
        track.onended = null;
        track.stop();
      }
      mediaRef.current = null;
    }
    setMediaStream(null);
  }, [teardownAudioGraph]);

  const stop = useCallback(() => {
    wantListenRef.current = false;
    intentionalCloseRef.current = true;
    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    setArmed(false);
    setReconnecting(false);
    setPhase("idle");
    phaseRef.current = "idle";
    const socket = wsRef.current;
    if (socket !== null) {
      safeSend(socket, JSON.stringify({ op: "flush" }));
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        try {
          socket.close();
        } catch {
        }
      }
      wsRef.current = null;
    }
    teardownMedia();
    setListening(false);
    setPartialText("");
  }, [clearReconnectTimer, teardownMedia]);

  const scheduleReconnect = useCallback(
    (reason: string): void => {
      if (wantListenRef.current !== true || intentionalCloseRef.current === true) {
        return;
      }
      if (projectIdRef.current.length === 0) {
        return;
      }
      clearReconnectTimer();
      setArmed(true);
      setReconnecting(true);
      phaseRef.current = "reconnecting";
      setPhase("reconnecting");
      setListening(false);
      if (reason.length > 0) {
        setError(reason);
      }
      const delay = nextBackoffMs(reconnectAttemptRef.current);
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = 0;
        if (wantListenRef.current !== true) {
          return;
        }
        void startRef.current(projectIdRef.current, "reconnect").catch(() => {
          scheduleReconnectRef.current("Speech engine unavailable — retrying…");
        });
      }, delay);
    },
    [clearReconnectTimer],
  );

  scheduleReconnectRef.current = scheduleReconnect;

  const startLevelLoop = useCallback((analyser: AnalyserNode) => {
    stopLevelLoop();
    analyserRef.current = analyser;
    const bins = new Uint8Array(analyser.fftSize);
    let speakingUntil = 0;

    function tick(): void {
      const live = analyserRef.current;
      if (live === null) {
        return;
      }
      live.getByteTimeDomainData(bins);
      let energy = 0;
      for (let i = 0; i < bins.length; i += 1) {
        const sample = bins[i];
        if (sample === undefined) {
          continue;
        }
        const centered = (sample - 128) / 128;
        energy += centered * centered;
      }
      energy = Math.sqrt(energy / bins.length);
      const now = performance.now();
      let nextPhase: VoiceListenPhase = "listening";
      if (energy > 0.035) {
        speakingUntil = now + 450;
        nextPhase = "speaking";
      } else if (now < speakingUntil) {
        nextPhase = "quiet";
      }
      if (phaseRef.current !== nextPhase) {
        phaseRef.current = nextPhase;
        setPhase(nextPhase);
      }
      if (now - lastLevelEmitRef.current >= 50) {
        lastLevelEmitRef.current = now;
        const nextLevel = Math.min(1, energy * 10);
        setLevel(nextLevel);
      }
      levelRafRef.current = window.requestAnimationFrame(tick);
    }
    levelRafRef.current = window.requestAnimationFrame(tick);
  }, [stopLevelLoop]);

  const bindMediaPipeline = useCallback(
    async (session: number, reuseMedia: MediaStream | null): Promise<MediaStream> => {
      let media: MediaStream;
      if (mediaStillLive(reuseMedia) === true && reuseMedia !== null) {
        media = reuseMedia;
      } else {
        teardownMedia();
        media = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
      }
      if (sessionRef.current !== session) {
        if (reuseMedia === null || media !== reuseMedia) {
          for (const track of media.getTracks()) {
            track.stop();
          }
        }
        throw new Error("Listen session replaced");
      }
      mediaRef.current = media;
      setMediaStream(media);
      for (const track of media.getAudioTracks()) {
        track.onended = () => {
          if (sessionRef.current !== session) {
            return;
          }
          if (wantListenRef.current !== true) {
            return;
          }
          teardownMedia();
          scheduleReconnectRef.current("Microphone ended — reconnecting…");
        };
      }
      teardownAudioGraph();
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(media);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      processor.onaudioprocess = (audioEvent) => {
        if (sessionRef.current !== session) {
          return;
        }
        const live = wsRef.current;
        if (socketIsOpen(live) !== true) {
          return;
        }
        const input = audioEvent.inputBuffer.getChannelData(0);
        const down = downsampleTo16k(input, audioCtx.sampleRate);
        const pcm = floatTo16BitPcm(down);
        safeSend(live, pcmBufferForSend(pcm));
      };
      source.connect(analyser);
      analyser.connect(processor);
      const mute = audioCtx.createGain();
      mute.gain.value = 0;
      processor.connect(mute);
      mute.connect(audioCtx.destination);
      startLevelLoop(analyser);
      return media;
    },
    [startLevelLoop, teardownAudioGraph, teardownMedia],
  );

  const start = useCallback(
    async (nextProjectId: string, mode: "user" | "reconnect" = "user"): Promise<void> => {
      clearReconnectTimer();
      if (mode === "user") {
        wantListenRef.current = true;
        reconnectAttemptRef.current = 0;
        setArmed(true);
        setReconnecting(false);
      }
      intentionalCloseRef.current = false;
      const session = sessionRef.current + 1;
      sessionRef.current = session;
      projectIdRef.current = nextProjectId;
      setError("");
      setProjectId(nextProjectId);
      setPartialText("");
      setPhase(mode === "reconnect" ? "reconnecting" : "connecting");
      phaseRef.current = mode === "reconnect" ? "reconnecting" : "connecting";
      const previousSocket = wsRef.current;
      if (previousSocket !== null) {
        previousSocket.onclose = null;
        previousSocket.onerror = null;
        previousSocket.onopen = null;
        previousSocket.onmessage = null;
        try {
          previousSocket.close();
        } catch {
        }
        wsRef.current = null;
      }
      if (mode === "user") {
        teardownMedia();
      } else {
        teardownAudioGraph();
      }
      setListening(false);
      const keepMedia = mode === "reconnect" ? mediaRef.current : null;
      try {
        let proto = "ws";
        if (window.location.protocol === "https:") {
          proto = "wss";
        }
        const url = new URL(`${proto}://${window.location.host}/api/v1/voice/stream`);
        url.searchParams.set("projectId", nextProjectId);
        const token = isCloudHost() ? getAccessToken() : null;
        const socket =
          token !== null
            ? new WebSocket(url.toString(), ["bearer", token])
            : new WebSocket(url.toString());
        wsRef.current = socket;
        socket.binaryType = "arraybuffer";
        let dropReason = "Connection lost — reconnecting…";
        let opened = false;
        socket.onmessage = (event) => {
          if (sessionRef.current !== session) {
            return;
          }
          if (typeof event.data !== "string") {
            return;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(event.data);
          } catch {
            return;
          }
          if (typeof parsed !== "object" || parsed === null) {
            return;
          }
          const record = parsed as {
            kind?: string;
            text?: string;
            status?: string;
            segment?: VoiceSegment;
            decision?: VoiceIntentDecision;
          };
          if (record.kind === "partial" && typeof record.text === "string") {
            setPartialText(record.text);
          }
          if (record.kind === "segment" && record.segment !== undefined) {
            setPartialText("");
            setLiveSegments((prev) => [record.segment as VoiceSegment, ...prev]);
          }
          if (record.kind === "decision" && record.decision !== undefined) {
            setLastDecision(record.decision);
          }
          if (record.kind === "sidecar" && record.status === "ready") {
            setError("");
          }
          if (record.kind === "error" && typeof record.text === "string") {
            dropReason = record.text;
            setError(record.text);
          }
        };
        socket.onclose = () => {
          if (sessionRef.current !== session) {
            return;
          }
          wsRef.current = null;
          setListening(false);
          setPartialText("");
          if (intentionalCloseRef.current === true || wantListenRef.current !== true) {
            setReconnecting(false);
            setArmed(false);
            phaseRef.current = "idle";
            setPhase("idle");
            return;
          }
          scheduleReconnectRef.current(dropReason);
        };
        await new Promise<void>((resolve, reject) => {
          socket.onopen = () => {
            opened = true;
            resolve();
          };
          socket.onerror = () => {
            if (opened) {
              return;
            }
            reject(new Error("Speech engine unavailable — retrying…"));
          };
        });
        if (sessionRef.current !== session) {
          socket.close();
          return;
        }
        await bindMediaPipeline(session, keepMedia);
        if (sessionRef.current !== session) {
          return;
        }
        reconnectAttemptRef.current = 0;
        setListening(true);
        setReconnecting(false);
        setArmed(true);
        phaseRef.current = "listening";
        setPhase("listening");
        setError("");
      } catch (err: unknown) {
        if (wantListenRef.current === true) {
          const message =
            err instanceof Error && err.message.length > 0
              ? err.message
              : "Could not start Listen.";
          scheduleReconnectRef.current(`${message} — retrying…`);
          return;
        }
        stop();
        if (err instanceof Error && err.message.length > 0) {
          setError(err.message);
          throw err;
        }
        setError("Could not start Listen.");
        throw new Error("Could not start Listen.");
      }
    },
    [bindMediaPipeline, clearReconnectTimer, stop, teardownAudioGraph, teardownMedia],
  );

  startRef.current = start;

  useEffect(() => {
    function kickIfArmed(): void {
      if (wantListenRef.current !== true) {
        return;
      }
      if (projectIdRef.current.length === 0) {
        return;
      }
      if (socketIsOpen(wsRef.current)) {
        return;
      }
      scheduleReconnectRef.current("Network back — reconnecting…");
    }
    function onOnline(): void {
      kickIfArmed();
    }
    function onVisible(): void {
      if (document.visibilityState === "visible") {
        kickIfArmed();
      }
    }
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  const value = useMemo(
    () => ({
      projectId,
      armed,
      listening,
      reconnecting,
      phase,
      level,
      partialText,
      error,
      lastDecision,
      liveSegments,
      mediaStream,
      start: (nextProjectId: string) => start(nextProjectId, "user"),
      stop,
    }),
    [
      projectId,
      armed,
      listening,
      reconnecting,
      phase,
      level,
      partialText,
      error,
      lastDecision,
      liveSegments,
      mediaStream,
      start,
      stop,
    ],
  );

  return <VoiceListenContext.Provider value={value}>{props.children}</VoiceListenContext.Provider>;
}

export function useVoiceListen(): VoiceListenContextValue {
  const value = useContext(VoiceListenContext);
  if (value === null) {
    throw new Error("VoiceListenProvider missing");
  }
  return value;
}
