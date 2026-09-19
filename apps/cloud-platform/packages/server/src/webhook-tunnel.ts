import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { locateCliBinary } from "./agent-probe.js";
import {
  clipLogTail,
  cloudflaredAssetName,
  cloudflaredDownloadUrl,
  installCloudflaredBytes,
  parseTunnelPublicUrl,
  redactSecret,
  tunnelBinaryFileName,
} from "./tunnel-parse.js";
import {
  loadTunnelSettings,
  saveTunnelSettings,
  tunnelDatabase,
  type TunnelProvider,
  type TunnelSettings,
} from "./tunnel-store.js";

export type TunnelState = "off" | "starting" | "up" | "missing_binary" | "error";

export type TunnelSnapshot = {
  enabled: boolean;
  provider: TunnelProvider;
  ngrokConfigured: boolean;
  state: TunnelState;
  publicUrl: string;
  detail: string;
};

export type TunnelPutInput = {
  enabled: boolean;
  provider: TunnelProvider;
  ngrokToken: string;
};

export type TunnelChild = {
  readonly pid?: number;
  readonly stdout: { on(event: "data", listener: (chunk: Buffer) => void): void } | null;
  readonly stderr: { on(event: "data", listener: (chunk: Buffer) => void): void } | null;
  on(event: "error", listener: (err: Error) => void): void;
  on(event: "close", listener: (code: number | null) => void): void;
  once(event: "close", listener: () => void): void;
  kill(signal?: NodeJS.Signals): boolean;
};

export type SpawnTunnel = (
  command: string,
  args: readonly string[],
  options: {
    env?: NodeJS.ProcessEnv;
    stdio: ["ignore", "pipe", "pipe"];
    windowsHide: boolean;
  },
) => TunnelChild;

export type WebhookTunnel = {
  snapshot(): TunnelSnapshot;
  apply(input: TunnelPutInput): Promise<TunnelSnapshot>;
  restart(): Promise<TunnelSnapshot>;
  boot(): Promise<void>;
  stop(): Promise<void>;
};

export type WebhookTunnelOptions = {
  databasePath: string;
  dataDir: string;
  localOrigin: string;
  spawnProcess?: SpawnTunnel;
  locateBinary?: (command: string) => Promise<string[]>;
  fetchBinary?: (url: string) => Promise<Uint8Array>;
  killChild?: (child: TunnelChild) => void;
  platform?: string;
  arch?: string;
  readyTimeoutMs?: number;
};

type RuntimeView = {
  state: TunnelState;
  publicUrl: string;
  detail: string;
};

const spawnErrorSchema = z.object({ code: z.string() });

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: {
    env?: NodeJS.ProcessEnv;
    stdio: ["ignore", "pipe", "pipe"];
    windowsHide: boolean;
  },
): TunnelChild {
  const launched: ChildProcess = spawn(command, args.slice(), options);
  return launched;
}

function defaultKill(child: TunnelChild): void {
  const pid = child.pid;
  if (process.platform === "win32" && pid !== undefined) {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  child.kill("SIGTERM");
}

async function defaultFetchBinary(url: string): Promise<Uint8Array> {
  const res = await fetch(url, {
    headers: { "user-agent": "Lotaru" },
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  });
  if (res.ok !== true) {
    throw new Error(`cloudflared download failed (${String(res.status)})`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength < 1_000_000) {
    throw new Error("cloudflared download was too small");
  }
  return bytes;
}

function envHasNgrokToken(): boolean {
  const raw = process.env.NGROK_AUTHTOKEN;
  if (raw === undefined) {
    return false;
  }
  return raw.trim().length > 0;
}

function resolvedNgrokToken(stored: string): string {
  if (stored.trim().length > 0) {
    return stored.trim();
  }
  const raw = process.env.NGROK_AUTHTOKEN;
  if (raw === undefined) {
    return "";
  }
  return raw.trim();
}

function appendLog(current: string, chunk: Buffer): string {
  const next = `${current}${chunk.toString("utf8")}`;
  return clipLogTail(next, 32_768);
}

export function createWebhookTunnel(options: WebhookTunnelOptions): WebhookTunnel {
  const db = tunnelDatabase(options.databasePath);
  const spawnProcess = options.spawnProcess !== undefined ? options.spawnProcess : defaultSpawn;
  const locateBinary = options.locateBinary !== undefined ? options.locateBinary : locateCliBinary;
  const fetchBinary = options.fetchBinary !== undefined ? options.fetchBinary : defaultFetchBinary;
  const killChild = options.killChild !== undefined ? options.killChild : defaultKill;
  const platform = options.platform !== undefined ? options.platform : process.platform;
  const arch = options.arch !== undefined ? options.arch : process.arch;
  const readyTimeoutMs = options.readyTimeoutMs !== undefined ? options.readyTimeoutMs : 45_000;
  let runtime: RuntimeView = {
    state: "off",
    publicUrl: "",
    detail: "",
  };
  let childRef: TunnelChild | null = null;
  let generation = 0;
  let gate: Promise<void> = Promise.resolve();

  function enqueue(work: () => Promise<void>): Promise<void> {
    const run = gate.then(work, work);
    gate = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function snapshot(): TunnelSnapshot {
    const stored = loadTunnelSettings(db);
    return {
      enabled: stored.enabled,
      provider: stored.provider,
      ngrokConfigured: stored.ngrokToken.length > 0 || envHasNgrokToken(),
      state: runtime.state,
      publicUrl: runtime.publicUrl,
      detail: runtime.detail,
    };
  }

  async function stopChild(): Promise<void> {
    generation += 1;
    const child = childRef;
    childRef = null;
    if (child === null) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 3_000);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      killChild(child);
    });
  }

  async function resolveBinary(stored: TunnelSettings): Promise<{ path: string; detail: string }> {
    const fileName = tunnelBinaryFileName(stored.provider, platform);
    const command = stored.provider === "ngrok" ? "ngrok" : "cloudflared";
    const located = await locateBinary(command);
    if (located.length > 0) {
      return { path: located[0], detail: "" };
    }
    const bundled = join(options.dataDir, "bin", fileName);
    if (existsSync(bundled)) {
      return { path: bundled, detail: "" };
    }
    if (stored.provider === "ngrok") {
      return {
        path: "",
        detail: "ngrok is not installed. Install the ngrok CLI, paste an authtoken, then Restart.",
      };
    }
    const url = cloudflaredDownloadUrl(platform, arch);
    if (url.length === 0) {
      return {
        path: "",
        detail: "Install cloudflared for this platform, then Restart.",
      };
    }
    runtime = {
      state: "starting",
      publicUrl: "",
      detail: "Downloading cloudflared…",
    };
    try {
      const bytes = await fetchBinary(url);
      installCloudflaredBytes(bytes, bundled, cloudflaredAssetName(platform, arch), platform);
    } catch (err) {
      let message = "Could not download cloudflared.";
      if (err instanceof Error && err.message.length > 0) {
        message = err.message;
      }
      return {
        path: "",
        detail: `${message} Install Cloudflare’s tunnel client, then Restart.`,
      };
    }
    if (existsSync(bundled) !== true) {
      return {
        path: "",
        detail: "cloudflared download did not write a binary. Install it, then Restart.",
      };
    }
    return { path: bundled, detail: "" };
  }

  async function startChild(): Promise<void> {
    const stored = loadTunnelSettings(db);
    if (stored.enabled !== true) {
      runtime = { state: "off", publicUrl: "", detail: "" };
      return;
    }
    await stopChild();
    const gen = generation;
    runtime = {
      state: "starting",
      publicUrl: "",
      detail: "Starting webhook tunnel…",
    };
    if (stored.provider === "ngrok") {
      const token = resolvedNgrokToken(stored.ngrokToken);
      if (token.length === 0) {
        runtime = {
          state: "error",
          publicUrl: "",
          detail: "Paste an ngrok authtoken, then Restart.",
        };
        return;
      }
    }
    const binary = await resolveBinary(stored);
    if (gen !== generation) {
      return;
    }
    if (binary.path.length === 0) {
      runtime = {
        state: "missing_binary",
        publicUrl: "",
        detail: binary.detail,
      };
      return;
    }
    const args: string[] =
      stored.provider === "ngrok"
        ? ["http", options.localOrigin]
        : ["tunnel", "--url", options.localOrigin, "--no-autoupdate"];
    let spawnOpts: {
      env?: NodeJS.ProcessEnv;
      stdio: ["ignore", "pipe", "pipe"];
      windowsHide: boolean;
    } = {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    };
    const ngrokToken = resolvedNgrokToken(stored.ngrokToken);
    if (stored.provider === "ngrok") {
      spawnOpts = Object.assign({}, spawnOpts, {
        env: Object.assign({}, process.env, { NGROK_AUTHTOKEN: ngrokToken }),
      });
    }
    let child: TunnelChild;
    try {
      child = spawnProcess(binary.path, args, spawnOpts);
    } catch (err) {
      let message = "Tunnel process failed to start.";
      if (err instanceof Error && err.message.length > 0) {
        message = err.message;
      }
      runtime = { state: "error", publicUrl: "", detail: message };
      return;
    }
    childRef = child;
    await new Promise<void>((resolve) => {
      let log = "";
      let finished = false;
      const finish = (): void => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        if (gen !== generation) {
          finish();
          return;
        }
        runtime = {
          state: "error",
          publicUrl: "",
          detail: "Tunnel did not publish a URL in time.",
        };
        killChild(child);
        finish();
      }, readyTimeoutMs);
      const onChunk = (chunk: Buffer): void => {
        log = appendLog(log, chunk);
        const url = parseTunnelPublicUrl(log);
        if (url.length === 0) {
          return;
        }
        if (gen !== generation) {
          finish();
          return;
        }
        runtime = { state: "up", publicUrl: url, detail: "" };
        finish();
      };
      if (child.stdout !== null) {
        child.stdout.on("data", onChunk);
      }
      if (child.stderr !== null) {
        child.stderr.on("data", onChunk);
      }
      child.on("error", (err) => {
        if (gen !== generation) {
          finish();
          return;
        }
        const parsed = spawnErrorSchema.safeParse(err);
        if (parsed.success === true && parsed.data.code === "ENOENT") {
          runtime = {
            state: "missing_binary",
            publicUrl: "",
            detail:
              stored.provider === "ngrok"
                ? "ngrok is not installed. Install the ngrok CLI, paste an authtoken, then Restart."
                : "cloudflared is not installed. Install Cloudflare’s tunnel client, then Restart.",
          };
          finish();
          return;
        }
        let message = "Tunnel process failed to start.";
        if (err instanceof Error && err.message.length > 0) {
          message = err.message;
        }
        runtime = { state: "error", publicUrl: "", detail: message };
        finish();
      });
      child.on("close", () => {
        if (gen !== generation) {
          finish();
          return;
        }
        if (childRef === child) {
          childRef = null;
        }
        if (runtime.state === "up" || runtime.state === "starting") {
          const tail = clipLogTail(redactSecret(log, ngrokToken), 280);
          let detail = "Webhook tunnel stopped unexpectedly.";
          if (tail.length > 0) {
            detail = tail;
          }
          runtime = {
            state: "error",
            publicUrl: "",
            detail,
          };
        }
        finish();
      });
    });
  }

  return {
    snapshot,
    async apply(input: TunnelPutInput): Promise<TunnelSnapshot> {
      await enqueue(async () => {
        const previous = loadTunnelSettings(db);
        let token = previous.ngrokToken;
        if (input.ngrokToken.trim().length > 0) {
          token = input.ngrokToken.trim();
        }
        saveTunnelSettings(db, {
          enabled: input.enabled,
          provider: input.provider,
          ngrokToken: token,
        });
        if (input.enabled !== true) {
          await stopChild();
          runtime = { state: "off", publicUrl: "", detail: "" };
          return;
        }
        await startChild();
      });
      return snapshot();
    },
    async restart(): Promise<TunnelSnapshot> {
      await enqueue(async () => {
        const stored = loadTunnelSettings(db);
        if (stored.enabled !== true) {
          await stopChild();
          runtime = { state: "off", publicUrl: "", detail: "" };
          return;
        }
        await startChild();
      });
      return snapshot();
    },
    async boot(): Promise<void> {
      await enqueue(async () => {
        const stored = loadTunnelSettings(db);
        if (stored.enabled !== true) {
          runtime = { state: "off", publicUrl: "", detail: "" };
          return;
        }
        await startChild();
      });
    },
    async stop(): Promise<void> {
      await enqueue(async () => {
        await stopChild();
        runtime = { state: "off", publicUrl: "", detail: "" };
      });
    },
  };
}
