import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import "@fastify/multipart";
import { config as loadDotenv } from "dotenv";
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { registerTaskBridgeModule } from "../../../../task-bridge/apps/backend/dist/index.js";
import { registerObservability } from "../../../../task-bridge/apps/backend/dist/observability.js";
import { createIdentity } from "./modules/identity.js";
import { registerAgentsModule } from "./modules/agents.js";
import { registerTerminalModule } from "./modules/terminal.js";
import { registerKnowledgeModule } from "./modules/knowledge.js";
import { registerKnowledgeTemplatesModule } from "./modules/knowledge-templates.js";
import { registerNotesModule } from "./modules/notes.js";
import { registerSpeakModule } from "./modules/speak.js";
import { registerProjectsModule } from "./modules/projects.js";
import { registerGithubAuthModule } from "./modules/github-auth.js";
import { registerGitProjectsModule } from "./modules/git-projects.js";
import { registerGitProvidersModule } from "./git-providers.js";
import { registerScriptRunnerModule } from "./modules/script-runner.js";
import { registerSettingsModule } from "./modules/settings.js";
import { registerClockSchedulesModule } from "./modules/clock-schedules.js";
import { registerMarketplaceModule } from "./modules/marketplace.js";
import { createWebhookTunnel } from "./webhook-tunnel.js";
import { registerVoiceModule } from "./modules/voice.js";
import { registerVoiceRulesModule } from "./modules/voice-rules.js";
import { lotaruDatabasePath } from "./lotaru-db.js";
import { closeCachedSqlite } from "./sqlite-cache.js";
import { buildHealthReport, type HealthModuleFlags } from "./health.js";
import { shouldServeSpaIndex, spaFileHeaders, apiRouteMissingBody, apiPath } from "./spa-fallback.js";
import { resolveStartOptions, type StartOptions } from "./start-options.js";

loadDotenv();

export type { StartOptions };
export { resolveStartOptions };

function publicUrlFor(host: string, port: number): string {
  const value = process.env.PUBLIC_URL;
  if (value !== undefined) {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed.replace(/\/$/, "");
    }
  }
  return `http://${host}:${String(port)}`;
}

function githubTokenKeyFromEnv(env: NodeJS.ProcessEnv): Buffer | null {
  const raw = env.GITHUB_TOKEN_KEY;
  if (raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const key = Buffer.from(trimmed, "base64");
  if (key.length !== 32) {
    return null;
  }
  return key;
}

function envOrNull(env: NodeJS.ProcessEnv, name: string): string | null {
  const raw = env[name];
  if (raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
}

function applyDataEnv(dataDirectory: string): string {
  mkdirSync(dataDirectory, { recursive: true });
  const dbPath = lotaruDatabasePath(dataDirectory);
  process.env.DATABASE_PATH = dbPath;
  process.env.SCRIPT_DATA_DIR = dataDirectory;
  return dbPath;
}

export async function start(opts: StartOptions): Promise<{ url: string; app: FastifyInstance }> {
  process.env.FOOKIE_SELF_HOST = "1";
  process.env.FOOKIE_MODE = "1";

  applyDataEnv(opts.dataDir);
  const dataDirectory = opts.dataDir;
  const dbPath = lotaruDatabasePath(dataDirectory);
  const port = opts.port;
  const host = opts.host;
  const publicUrl = publicUrlFor(host, port);

  const app = Fastify({ logger: true, trustProxy: true });

  await app.register(fastifyWebsocket);
  registerObservability(app);

  const identity = await createIdentity({
    publicUrl,
    dataDir: dataDirectory,
  });

  await identity.register(app);
  const github = await registerGithubAuthModule(app, {
    identity,
    dataDir: dataDirectory,
    publicUrl,
    clientId: envOrNull(process.env, "GITHUB_CLIENT_ID"),
    clientSecret: envOrNull(process.env, "GITHUB_CLIENT_SECRET"),
    tokenKey: githubTokenKeyFromEnv(process.env),
  });
  const projectPaths = {
    dataDir: dataDirectory,
    workspacesHostDir: envOrNull(process.env, "LOTARU_WORKSPACES_HOST_DIR"),
  };
  await registerProjectsModule(app, {
    identity,
    github,
    dataDir: dataDirectory,
    workspacesHostDir: projectPaths.workspacesHostDir,
    databasePath: dbPath,
  });
  await registerGitProvidersModule(app, {
    identity,
    github,
    databasePath: dbPath,
  });
  await registerGitProjectsModule(app, {
    identity,
    github,
    dataDir: dataDirectory,
    workspacesHostDir: projectPaths.workspacesHostDir,
    databasePath: dbPath,
  });
  const tunnel = createWebhookTunnel({
    databasePath: dbPath,
    dataDir: dataDirectory,
    localOrigin: `http://127.0.0.1:${String(port)}`,
  });
  await registerSettingsModule(app, {
    databasePath: dbPath,
    identity,
    tunnel,
  });
  await registerClockSchedulesModule(app, {
    databasePath: dbPath,
    identity,
  });
  await registerNotesModule(app, {
    databasePath: dbPath,
    identity,
  });
  await registerSpeakModule(app, {
    databasePath: dbPath,
    identity,
  });
  await registerAgentsModule(app, {
    databasePath: dbPath,
    identity,
  });
  await registerTerminalModule(app, {
    identity,
  });
  await registerKnowledgeTemplatesModule(app, {
    databasePath: dbPath,
    identity,
  });
  await registerMarketplaceModule(app, {
    databasePath: dbPath,
    identity,
  });
  await registerKnowledgeModule(app, {
    databasePath: dbPath,
    identity,
  });
  await registerTaskBridgeModule(app, {
    verifyAccessToken: identity.verifyAccessToken,
    registerProjectRoutes: false,
  });
  await registerScriptRunnerModule(app, {
    identity,
    github,
    dataDir: dataDirectory,
    databasePath: dbPath,
    tunnelSnapshot: () => {
      const snap = tunnel.snapshot();
      return { enabled: snap.enabled, state: snap.state, publicUrl: snap.publicUrl };
    },
  });
  await registerVoiceModule(app, {
    identity,
    dataDir: dataDirectory,
    databasePath: dbPath,
  });
  await registerVoiceRulesModule(app, {
    databasePath: dbPath,
    identity,
  });

  // The event bus reuses long-lived SQLite handles; hand them back on shutdown.
  app.addHook("onClose", async () => {
    await tunnel.stop();
    closeCachedSqlite();
  });

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

  app.get("/healthz", async (_request, reply) => {
    const report = await buildHealthReport({
      databasePath: dbPath,
      modules: moduleFlags,
    });
    if (report.status === "degraded") {
      return reply.code(503).send(report);
    }
    return report;
  });

  let webRoot = resolve(join(process.cwd(), "packages", "web", "dist"));
  if (opts.staticDir !== null) {
    webRoot = resolve(opts.staticDir);
  } else {
    const envWeb = process.env.WEB_DIST_DIR;
    if (envWeb !== undefined && envWeb.trim().length > 0) {
      webRoot = resolve(envWeb.trim());
    }
  }
  if (!existsSync(join(webRoot, "index.html"))) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(`web bundle missing at ${webRoot}`);
    }
    app.log.warn({ webRoot }, "web bundle missing; SPA hosting disabled");
  } else {
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: "/",
      wildcard: true,
      cacheControl: false,
      setHeaders: spaFileHeaders,
    });
    app.setNotFoundHandler((request, reply) => {
      if (apiPath(request.url)) {
        return reply.code(404).send(apiRouteMissingBody());
      }
      if (shouldServeSpaIndex(request.url) !== true) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  await app.listen({ host, port });
  const url = `http://${host}:${String(port)}`;
  app.log.info(`lotaru ready on ${url}`);
  void tunnel.boot().catch((err: unknown) => {
    app.log.error({ err }, "webhook tunnel failed to start");
  });
  return { url, app };
}

const SHUTDOWN_FORCE_MS = 30_000;

function bindGracefulShutdown(app: FastifyInstance): void {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    app.log.info({ signal }, "lotaru shutting down");
    const forceTimer = setTimeout(() => {
      app.log.error("lotaru forced exit after shutdown timeout");
      process.exit(1);
    }, SHUTDOWN_FORCE_MS);
    forceTimer.unref();
    void app
      .close()
      .then(() => {
        clearTimeout(forceTimer);
        app.log.info("lotaru stopped");
        process.exit(0);
      })
      .catch((err: unknown) => {
        clearTimeout(forceTimer);
        app.log.error({ err }, "lotaru shutdown failed");
        process.exit(1);
      });
  };

  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
}

function isMainEntry(): boolean {
  const argvPath = process.argv[1];
  if (argvPath === undefined) {
    return false;
  }
  const url = import.meta.url.toLowerCase();
  const normalised = argvPath.replace(/\\/g, "/").toLowerCase();
  if (url.endsWith(normalised)) {
    return true;
  }
  if (url.endsWith(normalised.replace(/\.ts$/, ".js"))) {
    return true;
  }
  return false;
}

if (isMainEntry()) {
  const opts = resolveStartOptions(process.argv.slice(2), process.env, homedir());
  void start(opts)
    .then(({ app }) => {
      bindGracefulShutdown(app);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
