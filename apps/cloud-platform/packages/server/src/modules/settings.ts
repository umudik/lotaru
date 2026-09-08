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
import {
  connectedConnectorIds,
  ensureConnectionSchema,
  loadConnectionSecret,
  saveConnectionSecret,
} from "../connection-store.js";
import { connectorKindSchema, listConnectors, type ConnectorKind } from "../connector-catalog.js";
import { aiToolIdSchema, requireAiTool } from "../ai-catalog.js";
import {
  connectionWithCliHealth,
  ensureAiToolSchema,
  saveAiToolConnection,
} from "../ai-store.js";
import {
  disconnectCliIfUnreachable,
  presentAiToolConnections,
  probeAiTool,
  probeCliTool,
} from "../ai-health.js";
import type { Identity } from "./identity.js";
import type { WebhookTunnel } from "../webhook-tunnel.js";
import { ensurePollSchema, hookTokenFor, listHookSync, listPollCursors, loadHookSync } from "../poll-store.js";
import { ingestAlarmFrom } from "../ingest-alarm.js";
import { NOTION_VERIFICATION_SCOPE } from "../hook-ingest.js";

const tunnelPutSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(["cloudflare", "ngrok"]),
    ngrokToken: z.string(),
  })
  .strict();

type SettingsOptions = {
  databasePath: string;
  identity: Identity;
  tunnel: WebhookTunnel;
};

export async function registerSettingsModule(
  app: FastifyInstance,
  options: SettingsOptions,
): Promise<void> {
  const db = openSettingsDb(options.databasePath);
  const agentDb = openAgentDb(options.databasePath);
  ensureGithubSchema(db);
  ensureConnectionSchema(db);
  ensurePollSchema(db);
  ensureAiToolSchema(db);

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

  app.get("/api/connectors", async (request, reply) => {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const connected = connectedConnectorIds(db);
    const connectors: {
      id: ConnectorKind;
      label: string;
      intake: string;
      connected: boolean;
      events: { type: string; label: string }[];
    }[] = [];
    for (const connector of listConnectors()) {
      let isConnected = false;
      for (const id of connected) {
        if (id === connector.id) {
          isConnected = true;
        }
      }
      const events: { type: string; label: string }[] = [];
      for (const listed of connector.events) {
        events.push({ type: listed.type, label: listed.label });
      }
      connectors.push({
        id: connector.id,
        label: connector.label,
        intake: connector.intake,
        connected: isConnected,
        events,
      });
    }
    return { connectors };
  });

  app.put<{ Params: { connectorId: string } }>("/api/connectors/:connectorId", async (request, reply) => {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const idParsed = connectorKindSchema.safeParse(request.params.connectorId);
    if (idParsed.success !== true) {
      return reply.code(404).send({ error: "unknown connector" });
    }
    const parsed = z.object({ secret: z.string() }).safeParse(request.body);
    if (parsed.success !== true) {
      return reply.code(400).send({ error: "Invalid secret" });
    }
    if (idParsed.data === "github") {
      saveGithubToken(db, parsed.data.secret);
      const token = loadGithubToken(db);
      if (token.length > 0) {
        requestGithubPoll();
      }
      return { connected: token.length > 0 };
    }
    saveConnectionSecret(db, idParsed.data, parsed.data.secret);
    return { connected: loadConnectionSecret(db, idParsed.data).length > 0 };
  });

  app.get("/api/ai-tools", async (request, reply) => {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return { tools: await presentAiToolConnections(db) };
  });

  app.put<{ Params: { toolId: string } }>("/api/ai-tools/:toolId", async (request, reply) => {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const idParsed = aiToolIdSchema.safeParse(request.params.toolId);
    if (idParsed.success !== true) {
      return reply.code(404).send({ error: "unknown AI tool" });
    }
    const parsed = z
      .object({
        secret: z.string(),
        baseUrl: z.string(),
        model: z.string(),
        disconnect: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (parsed.success !== true) {
      return reply.code(400).send({ error: "Invalid AI tool" });
    }
    try {
      const disconnect = parsed.data.disconnect === true;
      if (disconnect !== true) {
        const listed = requireAiTool(idParsed.data);
        if (listed.lane === "cli") {
          const health = await probeCliTool(idParsed.data);
          if (health.reachable !== true) {
            saveAiToolConnection(db, idParsed.data, {
              secret: "",
              baseUrl: "",
              model: "",
              disconnect: true,
            });
            return reply.code(400).send({ error: health.error });
          }
        }
      }
      const tool = saveAiToolConnection(db, idParsed.data, {
        secret: parsed.data.secret,
        baseUrl: parsed.data.baseUrl,
        model: parsed.data.model,
        disconnect,
      });
      if (tool.lane === "cli") {
        return { tool: connectionWithCliHealth(tool, true) };
      }
      return { tool };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid AI tool";
      return reply.code(400).send({ error: message });
    }
  });

  app.post<{ Params: { toolId: string } }>("/api/ai-tools/:toolId/health", async (request, reply) => {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const idParsed = aiToolIdSchema.safeParse(request.params.toolId);
    if (idParsed.success !== true) {
      return reply.code(404).send({ error: "unknown AI tool" });
    }
    const health = await probeAiTool(db, idParsed.data);
    const tool = disconnectCliIfUnreachable(db, idParsed.data, health.reachable);
    return { health, tool };
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

  app.get("/api/settings/tunnel", async (request, reply) => {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return { tunnel: options.tunnel.snapshot() };
  });

  app.put("/api/settings/tunnel", async (request, reply) => {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = tunnelPutSchema.safeParse(request.body);
    if (parsed.success !== true) {
      return reply.code(400).send({ error: "Invalid tunnel settings" });
    }
    const tunnel = await options.tunnel.apply(parsed.data);
    return { tunnel };
  });

  app.post("/api/settings/tunnel/restart", async (request, reply) => {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const tunnel = await options.tunnel.restart();
    return { tunnel };
  });

  app.get("/api/settings/ingest", async (request, reply) => {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const polls = listPollCursors(db);
    const connected = connectedConnectorIds(db);
    const hooks: { connectorId: ConnectorKind; token: string }[] = [];
    for (const id of connected) {
      hooks.push({ connectorId: id, token: hookTokenFor(db, id) });
    }
    const snap = options.tunnel.snapshot();
    const alarmPolls: { connector: string; lastError: string; lagged: boolean }[] = [];
    for (const row of polls) {
      alarmPolls.push({
        connector: row.connector,
        lastError: row.lastError,
        lagged: row.lagged,
      });
    }
    const hookSyncListed = listHookSync(db);
    const hookSync: { connector: string; repo: string; url: string; lastError: string }[] = [];
    for (const row of hookSyncListed) {
      hookSync.push({
        connector: row.connector,
        repo: row.repo,
        url: row.url,
        lastError: row.lastError,
      });
      if (row.lastError.length > 0) {
        alarmPolls.push({
          connector: row.connector,
          lastError: row.lastError,
          lagged: false,
        });
      }
    }
    const alarm = ingestAlarmFrom({
      polls: alarmPolls,
      tunnelEnabled: snap.enabled,
      tunnelState: snap.state,
    });
    const notionHandshake = loadHookSync(db, "notion", NOTION_VERIFICATION_SCOPE);
    return { polls, hooks, alarm, hookSync, notionVerificationToken: notionHandshake.url };
  });

  app.addHook("onClose", async () => {
    db.close();
    agentDb.close();
  });
}
