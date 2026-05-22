#!/usr/bin/env node
import { start } from '@lotaru/server';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = 4317;

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

function resolveStaticDir(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, '..', 'public'), join(here, '..', '..', 'public')];
  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }
  return null;
}

async function main(): Promise<void> {
  const port = resolvePort();
  const dataDir = join(homedir(), '.lotaru');
  const staticDir = resolveStaticDir();
  await start({ port, dataDir, staticDir });
  console.log(`\n  lotaru ready — open http://127.0.0.1:${String(port)}\n`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
