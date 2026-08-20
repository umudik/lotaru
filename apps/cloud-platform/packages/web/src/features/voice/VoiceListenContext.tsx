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

type VoiceListenContextValue = {
  projectId: string;
  listening: boolean;
  partialText: string;
  error: string;
  lastDecision: VoiceIntentDecision | null;
  liveSegments: VoiceSegment[];
  start: (projectId: string) => Promise<void>;
  stop: () => void;
};

const VoiceListenContext = createContext<VoiceListenContextValue | null>(null);

export function VoiceListenProvider(props: { children: ReactNode }): React.JSX.Element {
  const [projectId, setProjectId] = useState("");
  const [listening, setListening] = useState(false);
  const [partialText, setPartialText] = useState("");
  const [error, setError] = useState("");
  const [lastDecision, setLastDecision] = useState<VoiceIntentDecision | null>(null);
  const [liveSegments, setLiveSegments] = useState<VoiceSegment[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const stop = useCallback(() => {
    const socket = wsRef.current;
    if (socket !== null) {
      try {
        socket.send(JSON.stringify({ op: "flush" }));
      } catch {
        // ignore
      }
      socket.close();
      wsRef.current = null;
    }
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
    const media = mediaRef.current;
    if (media !== null) {
      for (const track of media.getTracks()) {
        track.stop();
      }
      mediaRef.current = null;
    }
    setListening(false);
    setPartialText("");
  }, []);

  const start = useCallback(
    async (nextProjectId: string): Promise<void> => {
      stop();
      setError("");
      setProjectId(nextProjectId);
      setLiveSegments([]);
      setLastDecision(null);
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
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => {
          resolve();
        };
        socket.onerror = () => {
          reject(new Error("voice websocket failed"));
        };
      });
      socket.onmessage = (event) => {
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
        if (record.kind === "error" && typeof record.text === "string") {
          setError(record.text);
        }
      };
      socket.onclose = () => {
        setListening(false);
      };
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaRef.current = media;
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(media);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      processor.onaudioprocess = (audioEvent) => {
        if (wsRef.current === null || wsRef.current.readyState !== WebSocket.OPEN) {
          return;
        }
        const input = audioEvent.inputBuffer.getChannelData(0);
        const down = downsampleTo16k(input, audioCtx.sampleRate);
        const pcm = floatTo16BitPcm(down);
        wsRef.current.send(pcm.buffer);
      };
      source.connect(processor);
      const mute = audioCtx.createGain();
      mute.gain.value = 0;
      processor.connect(mute);
      mute.connect(audioCtx.destination);
      setListening(true);
    },
    [stop],
  );

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  const value = useMemo(
    () => ({
      projectId,
      listening,
      partialText,
      error,
      lastDecision,
      liveSegments,
      start,
      stop,
    }),
    [projectId, listening, partialText, error, lastDecision, liveSegments, start, stop],
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
