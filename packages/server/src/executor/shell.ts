import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { LogStream } from '../types.js';

export interface ExecutionHandle {
  cancel(): void;
}

export interface ExecutorOptions {
  command: string;
  cwd: string;
  logPath: string;
  onLine(line: string, stream: LogStream): void;
  onExit(exitCode: number | null, cancelled: boolean): void;
}

function pickShell(): { cmd: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      cmd: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'],
    };
  }
  return { cmd: '/bin/sh', args: ['-c'] };
}

export function runShell(opts: ExecutorOptions): ExecutionHandle {
  mkdirSync(dirname(opts.logPath), { recursive: true });
  const logFile = createWriteStream(opts.logPath, { flags: 'a' });

  const shell = pickShell();
  const child: ChildProcess = spawn(shell.cmd, [...shell.args, opts.command], {
    cwd: opts.cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let cancelled = false;
  let killTimer: NodeJS.Timeout | null = null;

  function attachStream(stream: NodeJS.ReadableStream | null, kind: LogStream): void {
    if (stream === null) {
      return;
    }
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      buf += chunk;
      let idx = buf.indexOf('\n');
      while (idx !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        const clean = line.replace(/\r$/, '');
        logFile.write(`${kind}\t${clean}\n`);
        opts.onLine(clean, kind);
        idx = buf.indexOf('\n');
      }
    });
    stream.on('end', () => {
      if (buf.length > 0) {
        logFile.write(`${kind}\t${buf}\n`);
        opts.onLine(buf, kind);
        buf = '';
      }
    });
  }

  attachStream(child.stdout, 'out');
  attachStream(child.stderr, 'err');

  child.on('exit', (code, signal) => {
    if (killTimer !== null) {
      clearTimeout(killTimer);
      killTimer = null;
    }
    logFile.end();
    let exitCode: number | null = code;
    if (code === null && signal !== null) {
      exitCode = null;
    }
    opts.onExit(exitCode, cancelled);
  });

  child.on('error', (err) => {
    logFile.write(`err\t${String(err)}\n`);
    opts.onLine(String(err), 'err');
  });

  return {
    cancel(): void {
      if (cancelled) {
        return;
      }
      cancelled = true;
      if (child.pid === undefined) {
        return;
      }
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        return;
      }
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch (_e: unknown) {
          // process already gone
        }
      }, 1500);
    },
  };
}
