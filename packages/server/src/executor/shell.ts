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
  env: Record<string, string>;
  onLine(line: string, stream: LogStream): void;
  onExit(exitCode: number | null, cancelled: boolean): void;
}

function utf8Preamble(): string {
  const enc = '[System.Text.UTF8Encoding]::new($false)';
  return (
    `[Console]::OutputEncoding = ${enc}; ` +
    `[Console]::InputEncoding = ${enc}; ` +
    '$OutputEncoding = [Console]::OutputEncoding; ' +
    'chcp 65001 | Out-Null; '
  );
}

function splitPowerShellArgs(rest: string): string[] {
  const trimmed = rest.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i] as string;
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) {
    args.push(current);
  }
  return args;
}

function tryParsePs1Invocation(command: string): { script: string; args: string[] } | null {
  const trimmed = command.trim();

  const fileFlag = trimmed.match(
    /^powershell(?:\.exe)?(?:\s+-NoProfile)?(?:\s+-NonInteractive)?(?:\s+-ExecutionPolicy\s+\S+)?\s+-File\s+["']?([^"'\r\n]+\.ps1)["']?(.*)$/is,
  );
  if (fileFlag) {
    return { script: fileFlag[1] as string, args: splitPowerShellArgs(fileFlag[2] ?? '') };
  }

  const callOperator = trimmed.match(/^&\s*["']([^"']+\.ps1)["'](.*)$/is);
  if (callOperator) {
    return { script: callOperator[1] as string, args: splitPowerShellArgs(callOperator[2] ?? '') };
  }

  const dotSource = trimmed.match(/^\.\\["']?([^"'\s]+\.ps1)["']?(.*)$/is);
  if (dotSource) {
    return { script: dotSource[1] as string, args: splitPowerShellArgs(dotSource[2] ?? '') };
  }

  const barePath = trimmed.match(/^["']?([^"'\s]+\.ps1)["']?\s*$/i);
  if (barePath) {
    return { script: barePath[1] as string, args: [] };
  }

  return null;
}

function quotePs1SingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildPs1FileCommand(script: string, args: string[]): string {
  const argSuffix =
    args.length > 0 ? ` ${args.map((a) => quotePs1SingleQuoted(a)).join(' ')}` : '';
  return `${utf8Preamble()}& ${quotePs1SingleQuoted(script)}${argSuffix}`;
}

function buildWindowsSpawn(command: string): { cmd: string; args: string[] } {
  const ps1 = tryParsePs1Invocation(command);
  if (ps1 !== null) {
    return {
      cmd: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        buildPs1FileCommand(ps1.script, ps1.args),
      ],
    };
  }

  const trimmed = command.trim();
  if (/^\s*param\s*\(/i.test(trimmed)) {
    return {
      cmd: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        utf8Preamble() + trimmed,
      ],
    };
  }

  return {
    cmd: 'powershell.exe',
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      utf8Preamble() + trimmed,
    ],
  };
}

function pickShell(command: string): { cmd: string; args: string[] } {
  if (process.platform === 'win32') {
    return buildWindowsSpawn(command);
  }
  return { cmd: '/bin/sh', args: ['-c', command] };
}

export function runShell(opts: ExecutorOptions): ExecutionHandle {
  mkdirSync(dirname(opts.logPath), { recursive: true });
  const logFile = createWriteStream(opts.logPath, { flags: 'a', encoding: 'utf8' });

  const shell = pickShell(opts.command);
  const child: ChildProcess = spawn(shell.cmd, shell.args, {
    cwd: opts.cwd,
    env: opts.env,
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
        } catch (_e: unknown) {}
      }, 1500);
    },
  };
}
