import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { Loader2, Volume2, Languages, Cpu, Pause, Mic } from "lucide-react";
import { ConnectionsSettings } from "@/components/ConnectionsSettings";
import { ClockSchedulesSettings } from "@/components/ClockSchedulesSettings";
import { AiToolsSettings } from "@/components/AiToolsSettings";
import { WebhookTunnelSettings } from "@/components/WebhookTunnelSettings";
import { PageContent } from "@/components/layout/PageContent";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "@/hooks/useSession";
import {
  fetchAppSettings,
  fetchConnectors,
  saveConnectorSecret,
  fetchAiTools,
  fetchSpeakPreview,
  fetchTtsVoices,
  saveAppSettings,
  saveGithubSettings,
  type AppSettings,
  type AiToolRow,
  type ConnectorRow,
  type TargetLanguage,
  type TtsVoiceOption,
} from "@/lib/api";

function voiceInList(voices: TtsVoiceOption[], id: string): boolean {
  for (const voice of voices) {
    if (voice.id === id) {
      return true;
    }
  }
  return false;
}

function defaultVoiceId(
  voices: TtsVoiceOption[],
  language: string,
  current: string,
  engine: "edge" | "qwen",
): string {
  if (current.length > 0 && voiceInList(voices, current)) {
    return current;
  }
  for (const voice of voices) {
    if (voice.locale === language || voice.locale.startsWith(`${language}-`)) {
      return voice.id;
    }
  }
  if (engine === "qwen") {
    for (const voice of voices) {
      if (voice.id === "Aiden") {
        return voice.id;
      }
    }
  }
  const first = voices[0];
  if (first === undefined) {
    return "";
  }
  return first.id;
}

function voicesForGender(voices: TtsVoiceOption[], gender: string): TtsVoiceOption[] {
  const matched: TtsVoiceOption[] = [];
  for (const voice of voices) {
    if (voice.gender === gender) {
      matched.push(voice);
    }
  }
  return matched;
}

function localeGroups(voices: TtsVoiceOption[]): string[] {
  const locales: string[] = [];
  const seen = new Set<string>();
  for (const voice of voices) {
    if (seen.has(voice.locale)) {
      continue;
    }
    seen.add(voice.locale);
    locales.push(voice.locale);
  }
  return locales;
}

const SETTINGS_TAB_CLASS =
  "rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none";

function settingsTabFromHash(hash: string): "ai" | "voice" | "connections" | "clock" {
  let id = hash;
  if (hash.startsWith("#")) {
    id = hash.slice(1);
  }
  if (id === "voice" || id === "language") {
    return "voice";
  }
  if (id === "clock") {
    return "clock";
  }
  if (id === "ai" || id.length === 0 || id === "ai-tools") {
    return "ai";
  }
  const aiIds = [
    "ollama",
    "lmstudio",
    "llamacpp",
    "openai",
    "anthropic",
    "groq",
    "openrouter",
    "mistral",
    "deepseek",
    "gemini",
    "cursor",
    "claude",
    "codex",
  ];
  for (const listed of aiIds) {
    if (listed === id) {
      return "ai";
    }
  }
  return "connections";
}

export function SettingsPage(): React.JSX.Element {
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const settingsTab = settingsTabFromHash(location.hash);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [languages, setLanguages] = useState<TargetLanguage[]>([]);
  const [voices, setVoices] = useState<TtsVoiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [githubToken, setGithubToken] = useState("");
  const [savingGithub, setSavingGithub] = useState(false);
  const [connectorSecrets, setConnectorSecrets] = useState<Record<string, string>>({});
  const [savingConnectorId, setSavingConnectorId] = useState("idle");
  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [aiTools, setAiTools] = useState<AiToolRow[]>([]);
  const [savingAiToolId, setSavingAiToolId] = useState("idle");
  const [probingAiToolId, setProbingAiToolId] = useState("idle");
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceUrlRef = useRef<string | null>(null);
  const previewGen = useRef(0);
  const saveGen = useRef(0);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | 0>(0);

  async function loadVoicesFor(engine: "edge" | "qwen", next: AppSettings): Promise<AppSettings> {
    setLoadingVoices(true);
    try {
      const data = await fetchTtsVoices(session, engine);
      setVoices(data.voices);
      const ttsVoice = defaultVoiceId(data.voices, next.targetLanguage, next.ttsVoice, engine);
      return Object.assign({}, next, { ttsVoice });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load voices");
      return next;
    } finally {
      setLoadingVoices(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const data = await fetchAppSettings(session);
        const withVoices = await loadVoicesFor(data.settings.ttsEngine, data.settings);
        setSettings(withVoices);
        setLanguages(data.languages);
        const connectorData = await fetchConnectors(session);
        setConnectors(connectorData.connectors);
        const aiData = await fetchAiTools(session);
        setAiTools(aiData.tools);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load settings");
      } finally {
        setLoading(false);
      }
    })();
  }, [session]);

  useEffect(() => {
    if (loading || settings === null) {
      return;
    }
    const hashTarget = location.hash.slice(1);
    if (hashTarget.length === 0) {
      return;
    }
    if (hashTarget === "ai" || hashTarget === "voice" || hashTarget === "connections" || hashTarget === "clock") {
      return;
    }
    const section = document.getElementById(hashTarget);
    if (section === null) {
      return;
    }
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [loading, settings, location.hash, connectors, settingsTab]);

  function stopVoicePreview(): void {
    previewGen.current += 1;
    if (voiceAudioRef.current !== null) {
      voiceAudioRef.current.pause();
      voiceAudioRef.current = null;
    }
    if (voiceUrlRef.current !== null) {
      URL.revokeObjectURL(voiceUrlRef.current);
      voiceUrlRef.current = null;
    }
    setVoicePlaying(false);
    setTestingVoice(false);
  }

  useEffect(() => {
    return () => {
      if (persistTimer.current !== 0) {
        clearTimeout(persistTimer.current);
      }
      if (voiceAudioRef.current !== null) {
        voiceAudioRef.current.pause();
      }
      if (voiceUrlRef.current !== null) {
        URL.revokeObjectURL(voiceUrlRef.current);
      }
    };
  }, []);

  async function persistSettings(next: AppSettings): Promise<void> {
    const gen = saveGen.current + 1;
    saveGen.current = gen;
    try {
      const saved = await saveAppSettings(session, next);
      if (saveGen.current !== gen) {
        return;
      }
      setSettings(saved.settings);
    } catch (err) {
      if (saveGen.current === gen) {
        toast.error(err instanceof Error ? err.message : "Failed to save");
      }
    }
  }

  function applySettings(next: AppSettings): AppSettings {
    setSettings(next);
    return next;
  }

  function saveNow(next: AppSettings): void {
    if (persistTimer.current !== 0) {
      clearTimeout(persistTimer.current);
      persistTimer.current = 0;
    }
    void persistSettings(next);
  }

  function saveSoon(next: AppSettings): void {
    if (persistTimer.current !== 0) {
      clearTimeout(persistTimer.current);
    }
    persistTimer.current = setTimeout(() => {
      persistTimer.current = 0;
      void persistSettings(next);
    }, 400);
  }

  async function handleEngineChange(engine: "edge" | "qwen"): Promise<void> {
    if (settings === null) {
      return;
    }
    stopVoicePreview();
    const next = Object.assign({}, settings, { ttsEngine: engine, ttsVoice: "" });
    const withVoices = await loadVoicesFor(engine, next);
    applySettings(withVoices);
    saveNow(withVoices);
  }

  async function handleTestVoice(): Promise<void> {
    if (settings === null) {
      return;
    }
    if (testingVoice || voicePlaying) {
      stopVoicePreview();
      return;
    }
    const gen = previewGen.current + 1;
    previewGen.current = gen;
    setTestingVoice(true);
    try {
      const blob = await fetchSpeakPreview(session, settings);
      if (previewGen.current !== gen) {
        return;
      }
      if (voiceAudioRef.current !== null) {
        voiceAudioRef.current.pause();
        voiceAudioRef.current = null;
      }
      if (voiceUrlRef.current !== null) {
        URL.revokeObjectURL(voiceUrlRef.current);
      }
      const url = URL.createObjectURL(blob);
      voiceUrlRef.current = url;
      const audio = new Audio(url);
      voiceAudioRef.current = audio;
      audio.onended = () => {
        setVoicePlaying(false);
      };
      setVoicePlaying(true);
      await audio.play();
    } catch (err) {
      if (previewGen.current === gen) {
        setVoicePlaying(false);
        toast.error(err instanceof Error ? err.message : "Speech failed");
      }
    } finally {
      if (previewGen.current === gen) {
        setTestingVoice(false);
      }
    }
  }

  async function handleSaveGithub(): Promise<void> {
    setSavingGithub(true);
    try {
      const saved = await saveGithubSettings(session, githubToken);
      setGithubToken("");
      const connectorData = await fetchConnectors(session);
      setConnectors(connectorData.connectors);
      if (saved.connected) {
        toast.success("GitHub token saved");
      } else {
        toast.success("GitHub token cleared");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save GitHub token");
    } finally {
      setSavingGithub(false);
    }
  }

  async function handleSaveConnector(connectorId: ConnectorRow["id"]): Promise<void> {
    if (connectorId === "github") {
      return;
    }
    setSavingConnectorId(connectorId);
    try {
      const draft = connectorSecrets[connectorId];
      const secret = draft === undefined ? "" : draft;
      const saved = await saveConnectorSecret(session, connectorId, secret);
      setConnectorSecrets(Object.assign({}, connectorSecrets, { [connectorId]: "" }));
      const connectorData = await fetchConnectors(session);
      setConnectors(connectorData.connectors);
      const named = connectors.find((row) => row.id === connectorId);
      const title = named === undefined ? connectorId : named.label;
      if (saved.connected) {
        toast.success(`${title} connected`);
      } else {
        toast.success(`${title} disconnected`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save connection");
    } finally {
      setSavingConnectorId("idle");
    }
  }

  function handleSettingsTab(next: string): void {
    if (next !== "ai" && next !== "voice" && next !== "connections" && next !== "clock") {
      return;
    }
    navigate({ pathname: "/settings", hash: next }, { replace: true });
  }

  if (loading || settings === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading settings…
      </div>
    );
  }

  const current = settings;
  const grouped = localeGroups(voices);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Settings" />
      <Tabs
        value={settingsTab}
        onValueChange={handleSettingsTab}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="shrink-0 border-b border-white/[0.06] px-5">
          <TabsList className="h-10 bg-transparent p-0">
            <TabsTrigger value="ai" className={SETTINGS_TAB_CLASS}>
              AI
            </TabsTrigger>
            <TabsTrigger value="voice" className={SETTINGS_TAB_CLASS}>
              Voice
            </TabsTrigger>
            <TabsTrigger value="clock" className={SETTINGS_TAB_CLASS}>
              Clock
            </TabsTrigger>
            <TabsTrigger value="connections" className={SETTINGS_TAB_CLASS}>
              Connections
            </TabsTrigger>
          </TabsList>
        </div>
      <PageContent className="overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        {settingsTab === "clock" ? <ClockSchedulesSettings /> : null}

        {settingsTab === "connections" ? (
        <>
        <WebhookTunnelSettings />
        <ConnectionsSettings
          connectors={connectors}
          githubToken={githubToken}
          githubSaving={savingGithub}
          onGithubToken={setGithubToken}
          onSaveGithub={() => {
            void handleSaveGithub();
          }}
          secrets={connectorSecrets}
          savingId={savingConnectorId}
          onSecret={(id, secret) => {
            setConnectorSecrets(Object.assign({}, connectorSecrets, { [id]: secret }));
          }}
          onSave={(id) => {
            void handleSaveConnector(id);
          }}
          focusId={location.hash.slice(1)}
        />
        </>
        ) : null}

        {settingsTab === "ai" ? (
          <>
          <section id="ai" className="panel-card space-y-3 p-6">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary">
                <Cpu className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold">AI</h2>
                <p className="text-xs text-muted-foreground">
                  Connect tools on this machine. Event responders, Notes, and templates each pick
                  one from Connected. Log in to each CLI locally. Keys stay here; cloud calls leave
                  from this Lotaru process.
                </p>
              </div>
            </div>
          </section>
          <AiToolsSettings
            tools={aiTools}
            savingId={savingAiToolId}
            probingId={probingAiToolId}
            focusId={location.hash.slice(1)}
            onTools={setAiTools}
            onSaving={setSavingAiToolId}
            onProbing={setProbingAiToolId}
            onOllamaSaved={() => {
              void fetchAppSettings(session).then((data) => {
                setSettings(data.settings);
              });
            }}
          />
        </>
        ) : null}

        {settingsTab === "voice" ? (
        <section id="voice" className="panel-card space-y-6 p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary">
              <Mic className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Voice AI</h2>
              <p className="text-xs text-muted-foreground">
                Local only: Whisper sidecar for speech-to-text,{" "}
                <Link to="/settings#ollama" className="underline underline-offset-2">
                  Ollama
                </Link>{" "}
                for intent scanning, and read-aloud voices below.
              </p>
            </div>
          </div>
          <div id="language" className="space-y-5 border-t border-border/60 pt-5">
            <div className="flex items-center gap-3">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-secondary">
                <Languages className="h-3.5 w-3.5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Language</h3>
                <p className="text-xs text-muted-foreground">
                  Notes translate into this language. Speech uses a matching voice. Event
                  responders follow the language of your prompt; they use this only when the
                  prompt does not pick one.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="target-language">Default language</Label>
              <Select
                id="target-language"
                value={current.targetLanguage}
                onChange={(event) => {
                  const targetLanguage = event.target.value;
                  const ttsVoice = defaultVoiceId(
                    voices,
                    targetLanguage,
                    current.ttsVoice,
                    current.ttsEngine,
                  );
                  stopVoicePreview();
                  const next = applySettings(Object.assign({}, current, { targetLanguage, ttsVoice }));
                  saveNow(next);
                }}
              >
                {languages.map((lang) => (
                  <option key={lang.id} value={lang.id}>
                    {lang.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="space-y-5 border-t border-border/60 pt-5">
            <div className="flex items-center gap-3">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-secondary">
                <Volume2 className="h-3.5 w-3.5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Read aloud</h3>
                <p className="text-xs text-muted-foreground">
                  Microsoft neural voices, or Qwen3-TTS speakers. Male and female are listed
                  separately.
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tts-engine">Engine</Label>
              <Select
                id="tts-engine"
                value={current.ttsEngine}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "edge" || value === "qwen") {
                    void handleEngineChange(value);
                  }
                }}
              >
                <option value="edge">Microsoft neural</option>
                <option value="qwen">Qwen TTS</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tts-voice">Voice</Label>
              <div className="flex gap-2">
                <Select
                  id="tts-voice"
                  className="min-w-0 flex-1"
                  value={current.ttsVoice}
                  disabled={loadingVoices || voices.length === 0}
                  onChange={(event) => {
                    stopVoicePreview();
                    const next = applySettings(
                      Object.assign({}, current, { ttsVoice: event.target.value }),
                    );
                    saveNow(next);
                  }}
                >
                  {voices.length === 0 ? (
                    <option value="">{loadingVoices ? "Loading voices…" : "No voices"}</option>
                  ) : current.ttsEngine === "qwen" ? (
                    [
                      <optgroup key="male" label="Male">
                        {voicesForGender(voices, "male").map((voice) => (
                          <option key={voice.id} value={voice.id}>
                            {voice.label}
                          </option>
                        ))}
                      </optgroup>,
                      <optgroup key="female" label="Female">
                        {voicesForGender(voices, "female").map((voice) => (
                          <option key={voice.id} value={voice.id}>
                            {voice.label}
                          </option>
                        ))}
                      </optgroup>,
                    ]
                  ) : (
                    grouped.map((locale) => (
                      <optgroup key={locale} label={locale}>
                        {voices
                          .filter((voice) => voice.locale === locale)
                          .map((voice) => (
                            <option key={voice.id} value={voice.id}>
                              {voice.label}
                            </option>
                          ))}
                      </optgroup>
                    ))
                  )}
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  disabled={loadingVoices || voices.length === 0 || current.ttsVoice.length === 0}
                  onClick={() => void handleTestVoice()}
                >
                  {testingVoice ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {!testingVoice && voicePlaying ? <Pause className="h-4 w-4" /> : null}
                  {testingVoice ? "Testing…" : voicePlaying ? "Stop" : "Test"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Ryan and Aiden are male English voices.
              </p>
            </div>
          </div>
          {current.ttsEngine === "qwen" ? (
            <div className="space-y-2">
              <Label htmlFor="qwen-url">Qwen TTS URL</Label>
              <Input
                id="qwen-url"
                value={current.qwenTtsUrl}
                placeholder="http://127.0.0.1:8880"
                onChange={(event) => {
                  const next = applySettings(Object.assign({}, current, { qwenTtsUrl: event.target.value }));
                  saveSoon(next);
                }}
                onBlur={() => {
                  saveNow(current);
                }}
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to keep using Microsoft neural voices until a Qwen server is running.
              </p>
            </div>
          ) : null}
          </div>
        </section>
        ) : null}
      </div>
      </PageContent>
      </Tabs>
    </div>
  );
}
