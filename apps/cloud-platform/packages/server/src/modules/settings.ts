import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TARGET_LANGUAGES, ttsPreviewLine } from "../note-language.js";
import {
  loadAppSettings,
  openSettingsDb,
  parseSettingsInput,
  saveAppSettings,
  type AppSettings,
  type TtsEngine,
} from "../app-settings.js";
import { listOllamaModels } from "../ollama.js";
import { synthesizeSpeech } from "../tts.js";
import { voicesForEngine } from "../tts-voices.js";
import { loadAgentProfile, openAgentDb, parseAgentProfileInput, saveAgentProfile } from "../agent-store.js";
import { probeAgentRuntime } from "../agent-probe.js";
import { requestGithubPoll } from "../github-poll.js";
import { ensureGithubSchema, loadGithubToken, saveGithubToken } from "../github-store.js";
import type { Identity } from "./identity.js";

type SettingsOptions = {
  databasePath: string;
  identity: Identity;
};

export async function registerSettingsModule(
  app: FastifyInstance,
  options: SettingsOptions,
): Promise<void> {
  const db = openSettingsDb(options.databasePath);
  const agentDb = openAgentDb(options.databasePath);
  ensureGithubSchema(db);

  app.get("/api/settings", async (request, reply) => {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return {
      settings: loadAppSettings(db),
      languages: TARGET_LANGUAGES,
    };
  });

  app.put("/api/settings", async (request, reply) => {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    try {
      const input = parseSettingsInput(request.body);
      const settings = saveAppSettings(db, input);
      return { settings, languages: TARGET_LANGUAGES };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid settings";
      return reply.code(400).send({ error: message });
    }
  });

  app.get<{ Querystring: { engine?: string } }>("/api/settings/voices", async (request, reply) => {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const settings = loadAppSettings(db);
    const parsedEngine = z.enum(["edge", "qwen"]).safeParse(request.query.engine);
    let engine: TtsEngine = settings.ttsEngine;
    if (parsedEngine.success) {
      engine = parsedEngine.data;
    }
    const voices = await voicesForEngine(engine);
    return { engine, voices };
  });

  app.get("/api/settings/ollama/models", async (request, reply) => {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const settings = loadAppSettings(db);
    try {
      const models = await listOllamaModels(settings.ollamaHost);
      return { models, reachable: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ollama is not reachable";
      return { models: [], reachable: false, error: message };
    }
  });

  app.post("/api/settings/speak-preview", async (request, reply) => {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const saved = loadAppSettings(db);
    let preview: AppSettings = saved;
    try {
      preview = parseSettingsInput(Object.assign({}, saved, request.body));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid settings";
      return reply.code(400).send({ error: message });
    }
    const line = ttsPreviewLine(preview.targetLanguage);
    try {
      const audio = await synthesizeSpeech(preview, line, preview.targetLanguage);
      return reply.type("audio/mpeg").send(audio);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Speech failed";
      return reply.code(502).send({ error: message });
    }
  });

  app.get("/api/settings/github", async (request, reply) => {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const token = loadGithubToken(db);
    return { connected: token.length > 0 };
  });

  app.put("/api/settings/github", async (request, reply) => {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = z.object({ token: z.string() }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid token" });
    }
    saveGithubToken(db, parsed.data.token);
    const token = loadGithubToken(db);
    if (token.length > 0) {
      requestGithubPoll();
    }
    return { connected: token.length > 0 };
  });

  app.get("/api/settings/agent", async (request, reply) => {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return { profile: loadAgentProfile(agentDb) };
  });

  app.put("/api/settings/agent", async (request, reply) => {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    try {
      const input = parseAgentProfileInput(request.body);
      return { profile: saveAgentProfile(agentDb, input) };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid agent profile";
      return reply.code(400).send({ error: message });
    }
  });

  app.post("/api/settings/agent/probe", async (request, reply) => {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    let profile = loadAgentProfile(agentDb);
    if (request.body !== undefined && request.body !== null) {
      try {
        profile = parseAgentProfileInput(request.body);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Invalid agent profile";
        return reply.code(400).send({ error: message });
      }
    }
    const settings = loadAppSettings(db);
    const probe = await probeAgentRuntime({ profile, settings });
    return probe;
  });

  app.addHook("onClose", async () => {
    db.close();
    agentDb.close();
  });
}
