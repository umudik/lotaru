import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation, Link } from "react-router-dom";
import { Loader2, Volume2, Languages, Cpu, Pause, Github, Mic } from "lucide-react";
import { PageContent } from "@/components/layout/PageContent";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useSession } from "@/hooks/useSession";
import {
  fetchAppSettings,
  fetchGithubSettings,
  fetchOllamaModels,
  fetchSpeakPreview,
  fetchTtsVoices,
  fetchAgentSettings,
  saveAppSettings,
  saveGithubSettings,
  saveAgentSettings,
  probeAgentSettings,
  type AgentProfile,
  type AppSettings,
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

export function SettingsPage(): React.JSX.Element {
  const session = useSession();
  const location = useLocation();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [languages, setLanguages] = useState<TargetLanguage[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [voices, setVoices] = useState<TtsVoiceOption[]>([]);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [ollamaError, setOllamaError] = useState("");
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [githubToken, setGithubToken] = useState("");
  const [githubConnected, setGithubConnected] = useState(false);
  const [savingGithub, setSavingGithub] = useState(false);
  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [agentReachable, setAgentReachable] = useState<boolean | null>(null);
  const [agentProbeError, setAgentProbeError] = useState("");
  const [agentProbeDetail, setAgentProbeDetail] = useState("");
  const [probingAgent, setProbingAgent] = useState(false);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceUrlRef = useRef<string | null>(null);
  const previewGen = useRef(0);
  const saveGen = useRef(0);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | 0>(0);
  const agentGen = useRef(0);
  const agentTimer = useRef<ReturnType<typeof setTimeout> | 0>(0);

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

  async function probeOllama(next: AppSettings): Promise<void> {
    setProbing(true);
    try {
      await saveAppSettings(session, next);
      const result = await fetchOllamaModels(session);
      setModels(result.models);
      setReachable(result.reachable);
      if (result.reachable) {
        setOllamaError("");
      } else if (typeof result.error === "string") {
        setOllamaError(result.error);
      } else {
        setOllamaError("Ollama is not reachable");
      }
    } catch (err) {
      setReachable(false);
      setOllamaError(err instanceof Error ? err.message : "Ollama is not reachable");
    } finally {
      setProbing(false);
    }
  }

  async function probeAgent(next: AgentProfile): Promise<void> {
    setProbingAgent(true);
    try {
      await saveAgentSettings(session, next);
      const result = await probeAgentSettings(session, next);
      setAgentReachable(result.reachable);
      setAgentProbeDetail(result.detail);
      if (result.reachable) {
        setAgentProbeError("");
      } else if (result.error.length > 0) {
        setAgentProbeError(result.error);
      } else {
        setAgentProbeError("Agent runtime is not available");
      }
    } catch (err) {
      setAgentReachable(false);
      setAgentProbeDetail("");
      setAgentProbeError(err instanceof Error ? err.message : "Agent runtime is not available");
    } finally {
      setProbingAgent(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const data = await fetchAppSettings(session);
        const withVoices = await loadVoicesFor(data.settings.ttsEngine, data.settings);
        setSettings(withVoices);
        setLanguages(data.languages);
        await probeOllama(withVoices);
        const github = await fetchGithubSettings(session);
        setGithubConnected(github.connected);
        const agentData = await fetchAgentSettings(session);
        setAgent(agentData.profile);
        await probeAgent(agentData.profile);
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
    if (
      location.hash !== "#github" &&
      location.hash !== "#ai" &&
      location.hash !== "#voice" &&
      location.hash !== "#language"
    ) {
      return;
    }
    const section = document.getElementById(location.hash.slice(1));
    if (section === null) {
      return;
    }
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [loading, settings, location.hash]);

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
      if (agentTimer.current !== 0) {
        clearTimeout(agentTimer.current);
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

  async function persistAgent(next: AgentProfile): Promise<void> {
    const gen = agentGen.current + 1;
    agentGen.current = gen;
    try {
      const saved = await saveAgentSettings(session, next);
      if (agentGen.current !== gen) {
        return;
      }
      setAgent(saved.profile);
    } catch (err) {
      if (agentGen.current === gen) {
        toast.error(err instanceof Error ? err.message : "Failed to save AI settings");
      }
    }
  }

  function saveAgentNow(next: AgentProfile): void {
    if (agentTimer.current !== 0) {
      clearTimeout(agentTimer.current);
      agentTimer.current = 0;
    }
    void persistAgent(next);
  }

  function saveAgentSoon(next: AgentProfile): void {
    if (agentTimer.current !== 0) {
      clearTimeout(agentTimer.current);
    }
    agentTimer.current = setTimeout(() => {
      agentTimer.current = 0;
      void persistAgent(next);
    }, 400);
  }

  function applyAgent(next: AgentProfile): AgentProfile {
    setAgent(next);
    return next;
  }

  async function handleSaveGithub(): Promise<void> {
    setSavingGithub(true);
    try {
      const saved = await saveGithubSettings(session, githubToken);
      setGithubConnected(saved.connected);
      setGithubToken("");
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

  if (loading || settings === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading settings…
      </div>
    );
  }

  const current = settings;
  const modelChoices = models.slice();
  if (current.ollamaModel.length > 0 && !modelChoices.includes(current.ollamaModel)) {
    modelChoices.push(current.ollamaModel);
  }
  const grouped = localeGroups(voices);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Settings" />
      <PageContent className="overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <section id="github" className="panel-card space-y-5 p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary">
              <Github className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold">GitHub</h2>
              <p className="text-xs text-muted-foreground">
                Token used to record pull request events from this machine’s project remotes
              </p>
            </div>
            {githubConnected ? (
              <span className="ml-auto text-xs text-success">Connected</span>
            ) : (
              <span className="ml-auto text-xs text-muted-foreground">Not connected</span>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="github-token">Token</Label>
            <div className="flex gap-2">
              <Input
                id="github-token"
                type="password"
                value={githubToken}
                placeholder={githubConnected ? "Paste a new token to replace" : "ghp_…"}
                onChange={(event) => {
                  setGithubToken(event.target.value);
                }}
              />
              <Button type="button" variant="outline" disabled={savingGithub} onClick={() => void handleSaveGithub()}>
                {savingGithub ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </div>
              <p className="text-xs text-muted-foreground">
                Token used to record pull request events from this machine’s project remotes.
              </p>
          </div>
        </section>

        {agent !== null ? (
          <section id="ai" className="panel-card space-y-6 p-6">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary">
                <Cpu className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold">AI</h2>
                <p className="text-xs text-muted-foreground">
                  Single runtime for Chat, Event responders, Notes translate/polish/summary, and Knowledge.
                  Chat always runs in ask mode. Log in to each CLI on this machine.
                </p>
              </div>
            </div>
            <div className="space-y-5 border-t border-border/60 pt-5">
              <div className="flex items-center gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Default runtime</h3>
                  <p className="text-xs text-muted-foreground">
                    Provider used by Chat, Event responders, Notes jobs, and Knowledge. Chat always runs in
                    ask mode.
                  </p>
                </div>
                {agentReachable === true ? (
                  <span className="ml-auto text-xs text-success">Connected</span>
                ) : agentReachable === false ? (
                  <span className="ml-auto text-xs text-destructive">Offline</span>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-kind">Provider</Label>
                <div className="flex gap-2">
                  <Select
                    id="agent-kind"
                    className="min-w-0 flex-1"
                    value={agent.kind}
                    onChange={(event) => {
                      const kind = event.target.value;
                      if (
                        kind === "ollama" ||
                        kind === "cursor" ||
                        kind === "claude" ||
                        kind === "codex"
                      ) {
                        const next = applyAgent(Object.assign({}, agent, { kind }));
                        saveAgentNow(next);
                        void probeAgent(next);
                      }
                    }}
                  >
                    <option value="ollama">Local — Ollama</option>
                    <option value="cursor">Cursor Agent CLI (`agent`)</option>
                    <option value="claude">Claude Code (`claude`)</option>
                    <option value="codex">Codex CLI (`codex`)</option>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={probingAgent}
                    onClick={() => void probeAgent(agent)}
                  >
                    {probingAgent ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Test
                  </Button>
                </div>
                {agentProbeError.length > 0 ? (
                  <p className="text-xs text-destructive">{agentProbeError}</p>
                ) : agentProbeDetail.length > 0 ? (
                  <p className="text-xs text-muted-foreground">{agentProbeDetail}</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-mode">Default mode</Label>
                <Select
                  id="agent-mode"
                  value={agent.mode}
                  onChange={(event) => {
                    const mode = event.target.value;
                    if (mode === "ask" || mode === "plan" || mode === "execute") {
                      saveAgentNow(applyAgent(Object.assign({}, agent, { mode })));
                    }
                  }}
                >
                  <option value="ask">Ask</option>
                  <option value="plan">Plan</option>
                  <option value="execute">Execute</option>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-command">CLI binary override</Label>
                <Input
                  id="agent-command"
                  value={agent.command}
                  placeholder="leave empty for agent / claude / codex"
                  onChange={(event) => {
                    saveAgentSoon(applyAgent(Object.assign({}, agent, { command: event.target.value })));
                  }}
                  onBlur={(event) => {
                    const next = applyAgent(
                      Object.assign({}, agent, { command: event.target.value }),
                    );
                    saveAgentNow(next);
                    void probeAgent(next);
                  }}
                />
              </div>
            </div>
            <div className="space-y-5 border-t border-border/60 pt-5">
              <div className="flex items-center gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Local Ollama</h3>
                  <p className="text-xs text-muted-foreground">
                    Endpoint for AI when provider is Ollama. Voice intent scanning always
                    uses this local model. In Docker use http://host.docker.internal:11434 (Ollama
                    must listen on 0.0.0.0).
                  </p>
                </div>
                {reachable === true ? (
                  <span className="ml-auto text-xs text-success">Connected</span>
                ) : reachable === false ? (
                  <span className="ml-auto text-xs text-destructive">Offline</span>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ollama-host">Host</Label>
                <div className="flex gap-2">
                  <Input
                    id="ollama-host"
                    value={current.ollamaHost}
                    onChange={(event) => {
                      const next = applySettings(Object.assign({}, current, { ollamaHost: event.target.value }));
                      saveSoon(next);
                    }}
                    onBlur={() => {
                      saveNow(current);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={probing}
                    onClick={() => void probeOllama(current)}
                  >
                    {probing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Test
                  </Button>
                </div>
                {ollamaError.length > 0 ? (
                  <p className="text-xs text-destructive">{ollamaError}</p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ollama-model">Model</Label>
                <Select
                  id="ollama-model"
                  value={current.ollamaModel}
                  disabled={modelChoices.length === 0}
                  onChange={(event) => {
                    const next = applySettings(Object.assign({}, current, { ollamaModel: event.target.value }));
                    saveNow(next);
                  }}
                >
                  <option value="">
                    {probing ? "Loading models…" : "Choose a model"}
                  </option>
                  {modelChoices.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </Select>
                {modelChoices.length === 0 && !probing ? (
                  <p className="text-xs text-muted-foreground">
                    Start Ollama, then press Test to load the installed models.
                  </p>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        <section id="voice" className="panel-card space-y-6 p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary">
              <Mic className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Voice AI</h2>
              <p className="text-xs text-muted-foreground">
                Local only: Whisper sidecar for speech-to-text,{" "}
                <Link to="/settings#ai" className="underline underline-offset-2">
                  Local Ollama
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
      </div>
      </PageContent>
    </div>
  );
}
