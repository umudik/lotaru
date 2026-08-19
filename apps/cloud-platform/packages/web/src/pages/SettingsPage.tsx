import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Volume2, Languages, Cpu, Pause, Github, Bot } from "lucide-react";
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
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [languages, setLanguages] = useState<TargetLanguage[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [voices, setVoices] = useState<TtsVoiceOption[]>([]);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [ollamaError, setOllamaError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [githubToken, setGithubToken] = useState("");
  const [githubConnected, setGithubConnected] = useState(false);
  const [savingGithub, setSavingGithub] = useState(false);
  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [savingAgent, setSavingAgent] = useState(false);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const voiceUrlRef = useRef<string | null>(null);
  const previewGen = useRef(0);

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
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load settings");
      } finally {
        setLoading(false);
      }
    })();
  }, [session]);

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
      if (voiceAudioRef.current !== null) {
        voiceAudioRef.current.pause();
      }
      if (voiceUrlRef.current !== null) {
        URL.revokeObjectURL(voiceUrlRef.current);
      }
    };
  }, []);

  async function handleEngineChange(engine: "edge" | "qwen"): Promise<void> {
    if (settings === null) {
      return;
    }
    stopVoicePreview();
    const next = Object.assign({}, settings, { ttsEngine: engine, ttsVoice: "" });
    const withVoices = await loadVoicesFor(engine, next);
    setSettings(withVoices);
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

  async function handleSave(): Promise<void> {
    if (settings === null) {
      return;
    }
    setSaving(true);
    try {
      const saved = await saveAppSettings(session, settings);
      setSettings(saved.settings);
      toast.success("Settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
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

  async function handleSaveAgent(): Promise<void> {
    if (agent === null) {
      return;
    }
    setSavingAgent(true);
    try {
      const saved = await saveAgentSettings(session, agent);
      setAgent(saved.profile);
      toast.success("Agent profile saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save agent");
    } finally {
      setSavingAgent(false);
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
    <div className="note-desk flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-10">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Ollama sits above every project. Knowledge asks an agent to propose docs and
            diagrams — Cursor, Claude Code, Codex, or local Ollama. Lotaru does not store API
            keys; log in to the CLI yourself.
          </p>
        </div>

        {agent !== null ? (
          <section className="panel-card space-y-5 p-6">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary">
                <Bot className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Agent</h2>
                <p className="text-xs text-muted-foreground">
                  Knowledge proposals run this runtime. No API keys in Lotaru.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-kind">Runtime</Label>
              <Select
                id="agent-kind"
                value={agent.kind}
                onChange={(event) => {
                  const kind = event.target.value;
                  if (
                    kind === "ollama" ||
                    kind === "cursor" ||
                    kind === "claude" ||
                    kind === "codex"
                  ) {
                    setAgent(Object.assign({}, agent, { kind }));
                  }
                }}
              >
                <option value="ollama">Local — Ollama</option>
                <option value="cursor">Cursor Agent CLI (`agent`)</option>
                <option value="claude">Claude Code (`claude`)</option>
                <option value="codex">Codex CLI (`codex`)</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-mode">Mode</Label>
              <Select
                id="agent-mode"
                value={agent.mode}
                onChange={(event) => {
                  const mode = event.target.value;
                  if (mode === "ask" || mode === "plan" || mode === "execute") {
                    setAgent(Object.assign({}, agent, { mode }));
                  }
                }}
              >
                <option value="ask">Ask</option>
                <option value="plan">Plan</option>
                <option value="execute">Execute</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-command">Command override</Label>
              <Input
                id="agent-command"
                value={agent.command}
                placeholder="leave empty for agent / claude / codex"
                onChange={(event) => {
                  setAgent(Object.assign({}, agent, { command: event.target.value }));
                }}
              />
            </div>
            <Button type="button" disabled={savingAgent} onClick={() => void handleSaveAgent()}>
              {savingAgent ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save agent
            </Button>
          </section>
        ) : null}

        <section className="panel-card space-y-5 p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary">
              <Cpu className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Ollama</h2>
              <p className="text-xs text-muted-foreground">
                Local model for translate, polish, and summary
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
                onChange={(event) =>
                  setSettings(Object.assign({}, current, { ollamaHost: event.target.value }))
                }
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
              onChange={(event) =>
                setSettings(Object.assign({}, current, { ollamaModel: event.target.value }))
              }
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
        </section>

        <section className="panel-card space-y-5 p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary">
              <Languages className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Language</h2>
              <p className="text-xs text-muted-foreground">
                Target for note translation and the default read-aloud voice
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="target-language">Target language</Label>
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
                setSettings(Object.assign({}, current, { targetLanguage, ttsVoice }));
              }}
            >
              {languages.map((lang) => (
                <option key={lang.id} value={lang.id}>
                  {lang.label}
                </option>
              ))}
            </Select>
          </div>
        </section>

        <section className="panel-card space-y-5 p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary">
              <Volume2 className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Read aloud</h2>
              <p className="text-xs text-muted-foreground">
                Microsoft neural voices from Edge TTS, or the nine Qwen3-TTS CustomVoice speakers.
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
                    setSettings(Object.assign({}, current, { ttsVoice: event.target.value }));
                  }}
                >
                  {voices.length === 0 ? (
                    <option value="">{loadingVoices ? "Loading voices…" : "No voices"}</option>
                  ) : current.ttsEngine === "qwen" ? (
                    voices.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.label}
                      </option>
                    ))
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
                Hear a short sample in the target language. You do not need to save first.
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
                onChange={(event) =>
                  setSettings(Object.assign({}, current, { qwenTtsUrl: event.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to keep using Microsoft neural voices until a Qwen server is running.
              </p>
            </div>
          ) : null}
        </section>

        <section className="panel-card space-y-5 p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary">
              <Github className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold">GitHub</h2>
              <p className="text-xs text-muted-foreground">
                Token used only to poll pull requests after you add a reaction
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
                Paste a personal access token here. Lotaru does not sign in to GitHub until you do.
              </p>
          </div>
        </section>

        <div className="flex justify-end">
          <Button type="button" disabled={saving} onClick={() => void handleSave()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
