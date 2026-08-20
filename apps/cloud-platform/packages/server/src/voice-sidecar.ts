import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { z } from "zod";

const sidecarMessageSchema = z.object({
  kind: z.enum(["partial", "final", "error"]),
  text: z.string(),
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
  pcmB64: z.string().optional(),
});

export type SidecarTranscriptMessage = z.infer<typeof sidecarMessageSchema>;

export type VoiceSidecarHandle = {
  port: number;
  sendPcm: (pcm: Buffer) => void;
  flush: () => void;
  close: () => void;
};

function sidecarRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "voice-sidecar");
}

function pythonCommand(): string {
  const fromEnv = process.env.LOTARU_VOICE_PYTHON;
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  return "python";
}

function resolvePort(): number {
  const portRaw = process.env.LOTARU_VOICE_SIDECAR_PORT;
  if (portRaw === undefined || portRaw.trim().length === 0) {
    return 18765;
  }
  const parsed = Number(portRaw);
  if (Number.isFinite(parsed) !== true || parsed <= 0) {
    return 18765;
  }
  return Math.floor(parsed);
}

export async function startVoiceSidecar(options: {
  onMessage: (message: SidecarTranscriptMessage) => void;
  onError: (message: string) => void;
  mock?: boolean;
}): Promise<VoiceSidecarHandle> {
  const mockEnv = process.env.LOTARU_VOICE_MOCK;
  let useMock = options.mock === true;
  if (mockEnv === "1" || mockEnv === "true") {
    useMock = true;
  }
  try {
    return await openSidecarSession({
      useMock,
      onMessage: options.onMessage,
      onError: options.onError,
    });
  } catch (err) {
    if (useMock === true) {
      throw err;
    }
    const message = err instanceof Error ? err.message : "sidecar failed";
    options.onError(`voice sidecar failed (${message}); falling back to mock`);
    return await openSidecarSession({
      useMock: true,
      onMessage: options.onMessage,
      onError: options.onError,
    });
  }
}

async function openSidecarSession(input: {
  useMock: boolean;
  onMessage: (message: SidecarTranscriptMessage) => void;
  onError: (message: string) => void;
}): Promise<VoiceSidecarHandle> {
  const port = resolvePort();
  const root = sidecarRoot();
  const script = join(root, "server.py");
  if (existsSync(script) !== true) {
    throw new Error("voice sidecar missing");
  }
  const env = Object.assign({}, process.env, {
    LOTARU_VOICE_MOCK: input.useMock ? "1" : "0",
  });
  const child: ChildProcess = spawn(pythonCommand(), [script, "--host", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    input.onError(chunk.toString("utf8"));
  });
  let exitedEarly = false;
  child.once("exit", () => {
    exitedEarly = true;
  });
  try {
    await waitForHealth(port, 20000);
  } catch (err) {
    child.kill();
    throw err;
  }
  if (exitedEarly) {
    throw new Error("voice sidecar exited before healthy");
  }
  const socket = await connectSidecar(port);
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
  return {
    port,
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
      try {
        socket.close();
      } catch {
        // ignore
      }
      child.kill();
    },
  };
}

async function waitForHealth(port: number, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${String(port)}/healthz`);
      if (res.ok) {
        return;
      }
    } catch {
      // retry
    }
    await sleep(200);
  }
  throw new Error("voice sidecar did not become healthy");
}

async function connectSidecar(port: number): Promise<WebSocket> {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/v1/stream`);
    socket.once("open", () => {
      resolve(socket);
    });
    socket.once("error", (err) => {
      reject(err);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
