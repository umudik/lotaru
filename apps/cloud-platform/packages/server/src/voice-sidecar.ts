import WebSocket from "ws";
import { z } from "zod";

const sidecarMessageSchema = z.object({
  kind: z.enum(["partial", "final", "error"]),
  text: z.string(),
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
});

export type SidecarTranscriptMessage = z.infer<typeof sidecarMessageSchema>;

export type VoiceSidecarHandle = {
  port: number;
  mode: "docker";
  sendPcm: (pcm: Buffer) => void;
  flush: () => void;
  close: () => void;
};

export type VoiceSidecarProbe = {
  reachable: boolean;
  url: string;
  model: string;
  language: string;
  device: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function resolveVoiceSidecarHttpBase(): string {
  const fromEnv = process.env.LOTARU_VOICE_SIDECAR_URL;
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    return fromEnv.trim().replace(/\/$/, "");
  }
  const portRaw = process.env.LOTARU_VOICE_SIDECAR_PORT;
  let port = 18765;
  if (portRaw !== undefined && portRaw.trim().length > 0) {
    const parsed = Number(portRaw);
    if (Number.isFinite(parsed) === true && parsed > 0) {
      port = Math.floor(parsed);
    }
  }
  return `http://127.0.0.1:${String(port)}`;
}

function httpBaseToWsBase(httpBase: string): string {
  if (httpBase.startsWith("https://")) {
    return `wss://${httpBase.slice("https://".length)}`;
  }
  if (httpBase.startsWith("http://")) {
    return `ws://${httpBase.slice("http://".length)}`;
  }
  return `ws://${httpBase}`;
}

async function waitForHealth(httpBase: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  let delay = 250;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${httpBase}/healthz`);
      if (res.ok) {
        return;
      }
    } catch {
    }
    await sleep(delay);
    delay = Math.min(delay * 2, 2000);
  }
  throw new Error(`Speech engine not reachable at ${httpBase}`);
}

export async function probeVoiceSidecar(): Promise<VoiceSidecarProbe> {
  const url = resolveVoiceSidecarHttpBase();
  try {
    const res = await fetch(`${url}/healthz`);
    if (res.ok !== true) {
      return { reachable: false, url, model: "", language: "", device: "" };
    }
    const body = (await res.json()) as {
      model?: string;
      language?: string;
      device?: string;
    };
    let model = "";
    let language = "";
    let device = "";
    if (typeof body.model === "string") {
      model = body.model;
    }
    if (typeof body.language === "string") {
      language = body.language;
    }
    if (typeof body.device === "string") {
      device = body.device;
    }
    return { reachable: true, url, model, language, device };
  } catch {
    return { reachable: false, url, model: "", language: "", device: "" };
  }
}

function attachSocketHandlers(
  socket: WebSocket,
  input: {
    onMessage: (message: SidecarTranscriptMessage) => void;
    onError: (message: string) => void;
    onClose: () => void;
  },
): void {
  socket.on("message", (data) => {
    const text = data.toString("utf8");
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      input.onError("sidecar non-json message");
      return;
    }
    const parsed = sidecarMessageSchema.safeParse(parsedJson);
    if (parsed.success !== true) {
      input.onError("sidecar invalid message");
      return;
    }
    input.onMessage(parsed.data);
  });
  socket.on("error", (err) => {
    input.onError(err.message);
  });
  socket.on("close", () => {
    input.onClose();
  });
}

async function connectSidecarSocket(wsUrl: string): Promise<WebSocket> {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    socket.once("open", () => {
      resolve(socket);
    });
    socket.once("error", (err) => {
      reject(err);
    });
  });
}

function portFromHttpBase(httpBase: string): number {
  try {
    const parsed = new URL(httpBase);
    const fromUrl = Number(parsed.port);
    if (Number.isFinite(fromUrl) === true && fromUrl > 0) {
      return fromUrl;
    }
  } catch {
  }
  return 18765;
}

export async function startVoiceSidecar(options: {
  onMessage: (message: SidecarTranscriptMessage) => void;
  onError: (message: string) => void;
  onClose: () => void;
  healthTimeoutMs?: number;
}): Promise<VoiceSidecarHandle> {
  const httpBase = resolveVoiceSidecarHttpBase();
  let healthTimeoutMs = 60_000;
  if (options.healthTimeoutMs !== undefined && options.healthTimeoutMs > 0) {
    healthTimeoutMs = options.healthTimeoutMs;
  }
  await waitForHealth(httpBase, healthTimeoutMs);
  const wsUrl = `${httpBaseToWsBase(httpBase)}/v1/stream`;
  const socket = await connectSidecarSocket(wsUrl);
  attachSocketHandlers(socket, options);
  const port = portFromHttpBase(httpBase);
  return {
    port,
    mode: "docker",
    sendPcm: (pcm: Buffer) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(pcm);
      }
    },
    flush: () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ op: "flush" }));
      }
    },
    close: () => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        try {
          socket.close();
        } catch {
        }
      }
    },
  };
}

export async function startVoiceSidecarWithRetry(options: {
  onMessage: (message: SidecarTranscriptMessage) => void;
  onError: (message: string) => void;
  onClose: () => void;
  shouldContinue: () => boolean;
  healthTimeoutMs?: number;
  maxAttempts?: number;
}): Promise<VoiceSidecarHandle> {
  let attempts = 0;
  let delayMs = 500;
  let maxAttempts = 0;
  if (options.maxAttempts !== undefined && options.maxAttempts > 0) {
    maxAttempts = options.maxAttempts;
  }
  let lastError: Error = new Error("Speech engine unavailable");
  while (options.shouldContinue()) {
    attempts += 1;
    if (maxAttempts > 0 && attempts > maxAttempts) {
      throw lastError;
    }
    try {
      return await startVoiceSidecar({
        onMessage: options.onMessage,
        onError: options.onError,
        onClose: options.onClose,
        healthTimeoutMs: options.healthTimeoutMs,
      });
    } catch (err) {
      if (err instanceof Error && err.message.length > 0) {
        lastError = err;
      } else {
        lastError = new Error("Speech engine unavailable");
      }
      options.onError(lastError.message);
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, 10_000);
    }
  }
  throw lastError;
}
