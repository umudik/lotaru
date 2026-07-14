#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_PORT = 4317;
const CONSOLE_URL = process.env['LOTARU_CONSOLE_URL'] ?? 'https://lotaru.fookiecloud.com';

interface StartOptions {
  port: number;
  dataDir: string;
  staticDir: string | null;
}

type StartFn = (opts: StartOptions) => Promise<void>;

function resolvePort(): number {
  const envPort = process.env['LOTARU_PORT'];
  if (typeof envPort !== 'string' || envPort.length === 0) {
    return DEFAULT_PORT;
  }
  const n = Number.parseInt(envPort, 10);
  if (Number.isFinite(n) && n > 0) {
    return n;
  }
  return DEFAULT_PORT;
}

function isOffline(): boolean {
  return process.env['LOTARU_OFFLINE'] === '1';
}

function resolveStaticDir(): string | null {
  if (!isOffline()) {
    return null;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, '..', 'public'), join(here, '..', '..', 'public')];
  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }
  return null;
}

async function loadStart(): Promise<StartFn> {
  const here = dirname(fileURLToPath(import.meta.url));
  const bundled = join(here, '..', 'dist-server', 'main.js');
  if (existsSync(bundled)) {
    const mod = (await import(pathToFileURL(bundled).href)) as { start: StartFn };
    return mod.start;
  }
  const mod = await import('@lotaru/server');
  return mod.start;
}

function openBrowser(url: string): void {
  let child: ReturnType<typeof spawn>;
  if (process.platform === 'win32') {
    child = spawn('cmd', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
  } else if (process.platform === 'darwin') {
    child = spawn('open', [url], { detached: true, stdio: 'ignore' });
  } else {
    child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  }
  child.unref();
}

async function main(): Promise<void> {
  const port = resolvePort();
  const dataDir = join(homedir(), '.lotaru');
  const offline = isOffline();
  const staticDir = resolveStaticDir();
  const start = await loadStart();
  await start({ port, dataDir, staticDir });
  if (offline) {
    const url = `http://127.0.0.1:${String(port)}`;
    console.log(`\n  lotaru ready (offline) — ${url}\n`);
    openBrowser(url);
    return;
  }
  console.log(`\n  lotaru agent ready — http://127.0.0.1:${String(port)}`);
  console.log(`  console → ${CONSOLE_URL}\n`);
  openBrowser(CONSOLE_URL);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
