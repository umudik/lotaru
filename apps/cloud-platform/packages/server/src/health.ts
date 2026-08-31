import { loadAppSettings, openSettingsDb, type AppSettings } from "./app-settings.js";
import { listOllamaModels } from "./ollama.js";

export type HealthModuleFlags = {
  voice: boolean;
  scriptRunner: boolean;
  agents: boolean;
  voiceRules: boolean;
  notes: boolean;
  knowledge: boolean;
  knowledgeTemplates: boolean;
  terminal: boolean;
  settings: boolean;
  projects: boolean;
};

export type OllamaHealth = {
  reachable: boolean;
  modelConfigured: boolean;
  modelCount: number;
  reason: string;
};

export type HealthReport = {
  status: "ok" | "degraded";
  service: "lotaru";
  auth: "local";
  modules: HealthModuleFlags;
  ollama: OllamaHealth;
};

export async function probeOllamaHealth(settings: AppSettings): Promise<OllamaHealth> {
  const host = settings.ollamaHost.trim();
  const modelConfigured = settings.ollamaModel.trim().length > 0;
  if (host.length === 0) {
    return {
      reachable: false,
      modelConfigured,
      modelCount: 0,
      reason: "host not configured",
    };
  }
  try {
    const models = await listOllamaModels(host);
    return {
      reachable: true,
      modelConfigured,
      modelCount: models.length,
      reason: "",
    };
  } catch (err) {
    let reason = "unreachable";
    if (err instanceof Error && err.message.length > 0) {
      reason = err.message;
    }
    return {
      reachable: false,
      modelConfigured,
      modelCount: 0,
      reason,
    };
  }
}

export function healthStatusFromOllama(ollama: OllamaHealth): "ok" | "degraded" {
  if (ollama.reachable !== true) {
    return "degraded";
  }
  return "ok";
}

export async function buildHealthReport(input: {
  databasePath: string;
  modules: HealthModuleFlags;
}): Promise<HealthReport> {
  const settingsDb = openSettingsDb(input.databasePath);
  let settings = loadAppSettings(settingsDb);
  settingsDb.close();
  const ollama = await probeOllamaHealth(settings);
  return {
    status: healthStatusFromOllama(ollama),
    service: "lotaru",
    auth: "local",
    modules: input.modules,
    ollama,
  };
}
