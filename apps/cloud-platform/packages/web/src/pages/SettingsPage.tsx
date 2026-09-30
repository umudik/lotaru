import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation, useNavigate } from "react-router-dom";
import { Languages, Cpu } from "lucide-react";
import { ConnectionsSettings } from "@/components/ConnectionsSettings";
import { ClockSchedulesSettings } from "@/components/ClockSchedulesSettings";
import { AiToolsSettings } from "@/components/AiToolsSettings";
import { WebhookTunnelSettings } from "@/components/WebhookTunnelSettings";
import { PageContent } from "@/components/layout/PageContent";
import { PageHeader } from "@/components/layout/PageHeader";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "@/hooks/useSession";
import {
  fetchAppSettings,
  fetchConnectors,
  saveConnectorSecret,
  fetchAiTools,
  saveAppSettings,
  saveGithubSettings,
  type AppSettings,
  type AiToolRow,
  type ConnectorRow,
  type TargetLanguage,
} from "@/lib/api";

const SETTINGS_TAB_CLASS =
  "rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none";

function settingsTabFromHash(hash: string): "ai" | "language" | "connections" | "clock" {
  let id = hash;
  if (hash.startsWith("#")) {
    id = hash.slice(1);
  }
  if (id === "voice" || id === "language") {
    return "language";
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
  const [loading, setLoading] = useState(true);
  const [githubToken, setGithubToken] = useState("");
  const [savingGithub, setSavingGithub] = useState(false);
  const [connectorSecrets, setConnectorSecrets] = useState<Record<string, string>>({});
  const [savingConnectorId, setSavingConnectorId] = useState("idle");
  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [aiTools, setAiTools] = useState<AiToolRow[]>([]);
  const [savingAiToolId, setSavingAiToolId] = useState("idle");
  const [probingAiToolId, setProbingAiToolId] = useState("idle");
  const saveGen = useRef(0);

  useEffect(() => {
    void (async () => {
      try {
        const data = await fetchAppSettings(session);
        setSettings(data.settings);
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
    if (hashTarget === "ai" || hashTarget === "voice" || hashTarget === "language" || hashTarget === "connections" || hashTarget === "clock") {
      return;
    }
    const section = document.getElementById(hashTarget);
    if (section === null) {
      return;
    }
    section.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [loading, settings, location.hash, connectors, settingsTab]);

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
    void persistSettings(next);
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
    if (next !== "ai" && next !== "language" && next !== "connections" && next !== "clock") {
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Settings" />
      <Tabs
        value={settingsTab}
        onValueChange={handleSettingsTab}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="shrink-0 border-b border-white/[0.06] px-8">
          <TabsList className="h-10 bg-transparent p-0">
            <TabsTrigger value="ai" className={SETTINGS_TAB_CLASS}>
              AI
            </TabsTrigger>
            <TabsTrigger value="language" className={SETTINGS_TAB_CLASS}>
              Language
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

        {settingsTab === "language" ? (
        <section id="language" className="panel-card space-y-5 p-6">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary">
              <Languages className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Language</h2>
              <p className="text-xs text-muted-foreground">
                Notes translate into this language. Event responders follow the language of
                your prompt, and use this only when the prompt does not pick one.
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
                const next = applySettings(Object.assign({}, current, { targetLanguage }));
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
        </section>
        ) : null}
      </div>
      </PageContent>
      </Tabs>
    </div>
  );
}
