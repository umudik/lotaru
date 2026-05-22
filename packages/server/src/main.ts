import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore } from './db/index.js';
import { createBus } from './events/bus.js';
import { createWatcherManager } from './watcher/index.js';
import { createScheduler } from './scheduler/index.js';
import { createOrchestrator } from './orchestrator.js';
import { createHub } from './ws/hub.js';
import { registerRoutes } from './http/routes.js';

const DEFAULT_PORT = 4317;

interface StartOptions {
  port: number;
  dataDir: string;
  staticDir: string | null;
}

export async function start(opts: StartOptions): Promise<void> {
  mkdirSync(opts.dataDir, { recursive: true });
  const dbPath = join(opts.dataDir, 'lotaru.db');
  const logsDir = join(opts.dataDir, 'logs');
  mkdirSync(logsDir, { recursive: true });

  const store = openStore(dbPath);
  const bus = createBus();
  const scheduler = createScheduler();

  const orchRef: { current: ReturnType<typeof createOrchestrator> | null } = { current: null };
  const watchers = createWatcherManager((e) => {
    const cur = orchRef.current;
    if (cur === null) {
      return;
    }
    cur.handleWatchEvent(e);
  });

  const orch = createOrchestrator(store, bus, watchers, scheduler, logsDir);
  orchRef.current = orch;
  orch.loadAll();

  const app = Fastify({ logger: { level: 'info' } });

  await app.register(fastifyWebsocket);

  registerRoutes(app, store, bus, orch);

  const hub = createHub(bus);
  app.get('/api/v1/stream', { websocket: true }, (socket) => {
    hub.attach(socket);
  });

  if (opts.staticDir !== null && existsSync(opts.staticDir)) {
    await app.register(fastifyStatic, {
      root: opts.staticDir,
      prefix: '/',
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        void reply.code(404).send({ error: 'not found' });
        return;
      }
      void reply.sendFile('index.html');
    });
  }

  const shutdown = async (): Promise<void> => {
    app.log.info('shutting down');
    await orch.shutdown();
    store.close();
    await app.close();
  };

  process.on('SIGINT', () => {
    void shutdown().then(() => {
      process.exit(0);
    });
  });
  process.on('SIGTERM', () => {
    void shutdown().then(() => {
      process.exit(0);
    });
  });

  await app.listen({ port: opts.port, host: '127.0.0.1' });
  app.log.info(`lotaru ready on http://127.0.0.1:${String(opts.port)}`);
}

function defaultStaticDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = join(here, '..', 'public');
  if (existsSync(candidate)) {
    return candidate;
  }
  return null;
}

function isMainEntry(): boolean {
  const argvPath = process.argv[1];
  if (argvPath === undefined) {
    return false;
  }
  const url = import.meta.url.toLowerCase();
  const normalised = argvPath.replace(/\\/g, '/').toLowerCase();
  if (url.endsWith(normalised)) {
    return true;
  }
  if (url.endsWith(normalised.replace(/\.ts$/, '.js'))) {
    return true;
  }
  return false;
}

if (isMainEntry()) {
  let port = DEFAULT_PORT;
  const envPort = process.env['LOTARU_PORT'];
  if (typeof envPort === 'string' && envPort.length > 0) {
    const n = Number.parseInt(envPort, 10);
    if (Number.isFinite(n) && n > 0) {
      port = n;
    }
  }
  const dataDir = join(homedir(), '.lotaru');
  void start({ port, dataDir, staticDir: defaultStaticDir() }).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
