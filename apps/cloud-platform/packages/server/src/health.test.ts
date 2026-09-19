import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { openSettingsDb, saveAppSettings } from "./app-settings.js";
import {
  buildHealthReport,
  healthStatusFromOllama,
  probeOllamaHealth,
  type HealthModuleFlags,
} from "./health.js";

const moduleFlags: HealthModuleFlags = {
  voice: true,
  scriptRunner: true,
  agents: true,
  voiceRules: true,
  notes: true,
  knowledge: true,
  knowledgeTemplates: true,
  terminal: true,
  settings: true,
  projects: true,
};

describe("healthStatusFromOllama", () => {
  it("marks degraded when Ollama is unreachable", () => {
    assert.equal(
      healthStatusFromOllama({
        reachable: false,
        modelConfigured: true,
        modelCount: 0,
        reason: "connection refused",
      }),
      "degraded",
    );
  });

  it("marks ok when Ollama responds", () => {
    assert.equal(
      healthStatusFromOllama({
        reachable: true,
        modelConfigured: false,
        modelCount: 2,
        reason: "",
      }),
      "ok",
    );
  });
});

describe("probeOllamaHealth", () => {
  it("fail-closes when the host is empty", async () => {
    const result = await probeOllamaHealth({
      ollamaHost: "",
      ollamaModel: "llama3",
      translationEnabled: false,
      targetLanguage: "tr",
      ttsEngine: "edge",
      qwenTtsUrl: "",
      ttsVoice: "",
    });
    assert.equal(result.reachable, false);
    assert.match(result.reason, /host/i);
  });
});

describe("buildHealthReport", () => {
  it("returns module flags and an Ollama probe result", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-health-"));
    const databasePath = join(dir, "app.sqlite");
    const settingsDb = openSettingsDb(databasePath);
    saveAppSettings(settingsDb, {
      ollamaHost: "http://127.0.0.1:59999",
      ollamaModel: "",
      translationEnabled: false,
      targetLanguage: "tr",
      ttsEngine: "edge",
      qwenTtsUrl: "",
      ttsVoice: "",
    });
    settingsDb.close();
    const report = await buildHealthReport({
      databasePath,
      modules: moduleFlags,
    });
    assert.equal(report.service, "lotaru");
    assert.equal(report.auth, "local");
    assert.equal(report.modules.scriptRunner, true);
    assert.equal(report.ollama.reason, "not probed at boot");
    assert.equal(report.status, "ok");
  });
});
