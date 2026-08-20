import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import "@fastify/multipart";
import { config as loadDotenv } from "dotenv";
import Fastify from "fastify";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { registerTaskBridgeModule } from "../../../../task-bridge/apps/backend/dist/index.js";
import { registerObservability } from "../../../../task-bridge/apps/backend/dist/observability.js";
import { createIdentity } from "./modules/identity.js";
import { registerKnowledgeModule } from "./modules/knowledge.js";
import { registerKnowledgeTemplatesModule } from "./modules/knowledge-templates.js";
import { registerNotesModule } from "./modules/notes.js";
import { registerProjectsModule } from "./modules/projects.js";
import { registerScriptRunnerModule } from "./modules/script-runner.js";
import { registerSettingsModule } from "./modules/settings.js";
import { registerVoiceModule } from "./modules/voice.js";
import { lotaruDatabasePath } from "./lotaru-db.js";
import { shouldServeSpaIndex, spaFileHeaders } from "./spa-fallback.js";
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

function applyDataEnv(dataDirectory: string): string {
  mkdirSync(dataDirectory, { recursive: true });
  const dbPath = lotaruDatabasePath(dataDirectory);
  process.env.DATABASE_PATH = dbPath;
  process.env.SCRIPT_DATA_DIR = dataDirectory;
  return dbPath;
}

export async function start(opts: StartOptions): Promise<{ url: string }> {
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
  app.get("/healthz", async () => ({ status: "ok", service: "lotaru" }));

  const identity = await createIdentity({
    publicUrl,
    dataDir: dataDirectory,
  });

  await identity.register(app);
  await registerProjectsModule(app, identity);
  await registerSettingsModule(app, {
    databasePath: dbPath,
    identity,
  });
  await registerNotesModule(app, {
    databasePath: dbPath,
    identity,
  });
  await registerKnowledgeTemplatesModule(app, {
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
    dataDir: dataDirectory,
    databasePath: dbPath,
  });
  await registerVoiceModule(app, {
    identity,
    dataDir: dataDirectory,
    databasePath: dbPath,
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
      if (shouldServeSpaIndex(request.url) !== true) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  await app.listen({ host, port });
  const url = `http://${host}:${String(port)}`;
  app.log.info(`lotaru ready on ${url}`);
  return { url };
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
  void start(opts).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
