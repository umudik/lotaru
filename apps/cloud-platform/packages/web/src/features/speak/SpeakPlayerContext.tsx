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
import { matchPath, useLocation } from "react-router-dom";
import { useSession } from "@/hooks/useSession";
import {
  fetchSpeakAudio,
  fetchSpeakPlayable,
  fetchSpeakUtterance,
  markSpeakPlayed,
  type SpeakUtterance,
} from "@/lib/api";

type SpeakPlayerContextValue = {
  projectId: string;
  armed: boolean;
  speaking: boolean;
  error: string;
  current: SpeakUtterance | null;
  arm: () => void;
  disarm: () => void;
  playUtterance: (utteranceId: string) => Promise<void>;
};

const SpeakPlayerContext = createContext<SpeakPlayerContextValue | null>(null);

function projectIdFromPath(pathname: string): string {
  const match = matchPath("/projects/:projectId/*", pathname);
  if (match === null) {
    return "";
  }
  const id = match.params.projectId;
  if (id === undefined) {
    return "";
  }
  if (id.length === 0) {
    return "";
  }
  return id;
}

function exceptionName(err: unknown): string {
  if (err instanceof DOMException) {
    return err.name;
  }
  if (err instanceof Error) {
    return err.name;
  }
  return "Error";
}

function playFailureMessage(err: unknown): string {
  if (err instanceof Error) {
    const text = err.message.trim();
    if (text.length > 0) {
      return text;
    }
  }
  return "Speech failed";
}

export function SpeakPlayerProvider(props: { children: ReactNode }): React.JSX.Element {
  const session = useSession();
  const { pathname } = useLocation();
  const projectId = projectIdFromPath(pathname);
  const [armed, setArmed] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState<SpeakUtterance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const playingRef = useRef(false);
  const playGenRef = useRef(0);

  const releaseElement = useCallback(() => {
    if (audioRef.current !== null) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (objectUrlRef.current !== null) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const stopAudio = useCallback(() => {
    playGenRef.current += 1;
    releaseElement();
    playingRef.current = false;
    setSpeaking(false);
    setCurrent(null);
  }, [releaseElement]);

  const playUtterance = useCallback(
    async (utteranceId: string): Promise<void> => {
      const id = utteranceId.trim();
      if (id.length === 0) {
        return;
      }
      const gen = playGenRef.current + 1;
      playGenRef.current = gen;
      setArmed(true);
      setError("");
      playingRef.current = true;
      try {
        const utterance = await fetchSpeakUtterance(session, id);
        if (playGenRef.current !== gen) {
          return;
        }
        setCurrent(utterance);
        setSpeaking(true);
        const blob = await fetchSpeakAudio(session, id);
        if (playGenRef.current !== gen) {
          return;
        }
        releaseElement();
        playingRef.current = true;
        setSpeaking(true);
        const url = URL.createObjectURL(blob);
        if (playGenRef.current !== gen) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          if (playGenRef.current !== gen) {
            return;
          }
          void (async () => {
            try {
              await markSpeakPlayed(session, id);
            } catch (err) {
              if (playGenRef.current !== gen) {
                return;
              }
              setError(playFailureMessage(err));
            } finally {
              if (playGenRef.current !== gen) {
                return;
              }
              playingRef.current = false;
              setSpeaking(false);
              setCurrent(null);
            }
          })();
        };
        audio.onerror = () => {
          if (playGenRef.current !== gen) {
            return;
          }
          playingRef.current = false;
          setSpeaking(false);
          setCurrent(null);
          setError("Speech failed");
        };
        await audio.play();
      } catch (err) {
        if (playGenRef.current !== gen) {
          return;
        }
        playingRef.current = false;
        setSpeaking(false);
        setCurrent(null);
        const name = exceptionName(err);
        if (name === "AbortError") {
          return;
        }
        if (name === "NotAllowedError") {
          setArmed(false);
        }
        setError(playFailureMessage(err));
      }
    },
    [session, releaseElement],
  );

  useEffect(() => {
    if (armed !== true) {
      return;
    }
    if (projectId.length === 0) {
      return;
    }
    let cancelled = false;
    let timer = 0;
    const tick = async (): Promise<void> => {
      if (cancelled) {
        return;
      }
      const pollBusy = playingRef.current === true;
      if (pollBusy !== true) {
        try {
          const data = await fetchSpeakPlayable(session, projectId);
          const next = data.utterances[0];
          if (cancelled) {
            return;
          }
          const playBusy = playingRef.current === true;
          if (next !== undefined && playBusy !== true) {
            setCurrent(next);
            await playUtterance(next.id);
          }
        } catch (err) {
          if (cancelled) {
            return;
          }
          setError(playFailureMessage(err));
        }
      }
      if (cancelled) {
        return;
      }
      timer = window.setTimeout(() => {
        void tick();
      }, 2000);
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [armed, projectId, playUtterance, session]);

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, [stopAudio]);

  const arm = useCallback(() => {
    setArmed(true);
    setError("");
  }, []);

  const disarm = useCallback(() => {
    setArmed(false);
    stopAudio();
    setError("");
  }, [stopAudio]);

  const value = useMemo(
    () => ({
      projectId,
      armed,
      speaking,
      error,
      current,
      arm,
      disarm,
      playUtterance,
    }),
    [projectId, armed, speaking, error, current, arm, disarm, playUtterance],
  );

  return <SpeakPlayerContext.Provider value={value}>{props.children}</SpeakPlayerContext.Provider>;
}

export function useSpeakPlayer(): SpeakPlayerContextValue {
  const value = useContext(SpeakPlayerContext);
  if (value === null) {
    throw new Error("SpeakPlayerProvider missing");
  }
  return value;
}
