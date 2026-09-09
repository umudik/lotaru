#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { Request, Response } from "express";
import { z } from "zod";

const LOTARU_URL = (process.env.LOTARU_URL || "http://127.0.0.1:11222").replace(/\/$/, "");
const LOTARU_API_KEY = process.env.LOTARU_API_KEY || "";

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (LOTARU_API_KEY.length > 0) {
    headers.Authorization = `Bearer ${LOTARU_API_KEY}`;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${LOTARU_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (res.ok !== true) {
    throw new Error(`${method} ${path} -> ${String(res.status)}: ${text.slice(0, 400)}`);
  }
  return data;
}

async function apiBinary(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const headers: Record<string, string> = {
    Accept: "audio/mpeg, application/json",
  };
  if (LOTARU_API_KEY.length > 0) {
    headers.Authorization = `Bearer ${LOTARU_API_KEY}`;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${LOTARU_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.ok !== true) {
    const text = await res.text();
    let detail = text.slice(0, 400);
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error !== undefined) {
        detail = parsed.error;
      }
    } catch {
      detail = text.slice(0, 400);
    }
    throw new Error(`${method} ${path} -> ${String(res.status)}: ${detail}`);
  }
  const rawType = res.headers.get("content-type");
  let contentType = "audio/mpeg";
  if (rawType !== null && rawType.length > 0) {
    contentType = rawType;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, contentType };
}

async function loadSpeakMpeg(utteranceId: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const id = utteranceId.trim();
  if (id.length === 0) {
    throw new Error("speak utterance missing");
  }
  const spoken = await apiBinary(
    "GET",
    `/api/speak/${encodeURIComponent(id)}/audio`,
  );
  if (spoken.bytes.byteLength === 0) {
    throw new Error("Speech failed");
  }
  return spoken;
}

function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function speakAudioResult(input: {
  bytes: Uint8Array;
  contentType: string;
  meta: Record<string, unknown>;
}) {
  const mimeParts = input.contentType.split(";");
  let mimeType = "audio/mpeg";
  if (mimeParts.length > 0 && mimeParts[0].trim().length > 0) {
    mimeType = mimeParts[0].trim();
  }
  const base64 = Buffer.from(input.bytes).toString("base64");
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(input.meta, null, 2) },
      { type: "audio" as const, data: base64, mimeType },
    ],
  };
}

function noteSpeakResult(input: {
  pageId: string;
  variant: "original" | "translated" | "polished" | "summary";
  bytes: Uint8Array;
  contentType: string;
  page?: unknown;
}) {
  const meta: Record<string, unknown> = {
    pageId: input.pageId,
    variant: input.variant,
    byteLength: input.bytes.byteLength,
    hint: "MCP audio is Lotaru TTS (Settings → Voice). Speak and notes share the same queue.",
  };
  if (input.page !== undefined) {
    meta.page = input.page;
  }
  return speakAudioResult({
    bytes: input.bytes,
    contentType: input.contentType,
    meta,
  });
}

const createdNotePageIdSchema = z.object({
  id: z.string().min(1),
  speakId: z.string().optional(),
});

function createLotaruMcpServer(): McpServer {
  const server = new McpServer({
    name: "lotaru-local",
    version: "0.1.0",
  });

  server.tool(
    "events_list",
    "List Lotaru project events",
    {
      projectId: z.string(),
      limit: z.number().int().positive().optional(),
    },
    async (args) => {
      let limit = 50;
      if (args.limit !== undefined) {
        limit = args.limit;
      }
      return textResult(
        await api(
          "GET",
          `/api/v1/projects/${encodeURIComponent(args.projectId)}/events?limit=${String(limit)}`,
        ),
      );
    },
  );

  server.tool(
    "events_replay",
    "Replay a stored Lotaru event",
    {
      projectId: z.string(),
      eventId: z.string(),
    },
    async (args) =>
      textResult(
        await api(
          "POST",
          `/api/v1/projects/${encodeURIComponent(args.projectId)}/events/${encodeURIComponent(args.eventId)}/replay`,
        ),
      ),
  );


  server.tool(
    "scripts_list",
    "List project scripts",
    { projectId: z.string() },
    async (args) =>
      textResult(
        await api("GET", `/api/v1/projects/${encodeURIComponent(args.projectId)}/scripts`),
      ),
  );

  server.tool(
    "script_snapshot",
    "Project script snapshot (settings, scripts, recent executions)",
    {
      projectId: z.string(),
      limit: z.number().int().positive().optional(),
    },
    async (args) => {
      let limit = 20;
      if (args.limit !== undefined) {
        limit = args.limit;
      }
      return textResult(
        await api(
          "GET",
          `/api/v1/projects/${encodeURIComponent(args.projectId)}/script-snapshot?limit=${String(limit)}`,
        ),
      );
    },
  );

  server.tool(
    "scripts_run",
    "Manually run a Lotaru script by id (POST /api/v1/scripts/:id/run)",
    { scriptId: z.string() },
    async (args) =>
      textResult(await api("POST", `/api/v1/scripts/${encodeURIComponent(args.scriptId)}/run`)),
  );

  server.tool(
    "script_execution_log",
    "Read a script execution log by execution id",
    { executionId: z.string() },
    async (args) =>
      textResult(
        await api("GET", `/api/v1/executions/${encodeURIComponent(args.executionId)}/log`),
      ),
  );

  server.tool(
    "tasks_list",
    "List Task Bridge inbox/tasks for a project",
    { projectId: z.string() },
    async (args) =>
      textResult(
        await api("GET", `/api/tasks?projectId=${encodeURIComponent(args.projectId)}`),
      ),
  );

  server.tool(
    "pipeline_get",
    "Get project pipeline/workflow",
    { projectId: z.string() },
    async (args) =>
      textResult(await api("GET", `/api/projects/${encodeURIComponent(args.projectId)}/workflow`)),
  );

  server.tool(
    "voice_segments",
    "List voice transcript segments for a project",
    {
      projectId: z.string(),
      limit: z.number().int().positive().optional(),
    },
    async (args) => {
      let limit = 50;
      if (args.limit !== undefined) {
        limit = args.limit;
      }
      return textResult(
        await api(
          "GET",
          `/api/voice/segments?projectId=${encodeURIComponent(args.projectId)}&limit=${String(limit)}`,
        ),
      );
    },
  );

  server.tool(
    "voice_rules",
    "List the project voice rules and their recent matches",
    { projectId: z.string() },
    async (args) =>
      textResult(
        await api("GET", `/api/voice-rules?projectId=${encodeURIComponent(args.projectId)}`),
      ),
  );

  server.tool(
    "voice_rules_scan",
    "Scan pending voice transcript lines against the project rules now",
    { projectId: z.string() },
    async (args) =>
      textResult(await api("POST", "/api/voice-rules/scan", { projectId: args.projectId })),
  );

  server.tool(
    "voice_rules_test",
    "Dry-run the project voice rules against a transcript without emitting events",
    { projectId: z.string(), transcript: z.string() },
    async (args) =>
      textResult(
        await api("POST", "/api/voice-rules/test", {
          projectId: args.projectId,
          transcript: args.transcript,
        }),
      ),
  );

  server.tool(
    "voice_status",
    "Voice listen / sidecar status",
    { projectId: z.string() },
    async (args) =>
      textResult(
        await api("GET", `/api/voice/status?projectId=${encodeURIComponent(args.projectId)}`),
      ),
  );

  server.tool("projects_list", "List Lotaru projects", {}, async () =>
    textResult(await api("GET", "/api/projects")),
  );

  server.tool(
    "note_books_list",
    "List note books for a project",
    { projectId: z.string() },
    async (args) =>
      textResult(
        await api("GET", `/api/note-books?projectId=${encodeURIComponent(args.projectId)}`),
      ),
  );

  server.tool(
    "note_book_get",
    "Get a note book with its pages",
    { bookId: z.string() },
    async (args) =>
      textResult(await api("GET", `/api/note-books/${encodeURIComponent(args.bookId)}`)),
  );

  server.tool(
    "note_book_create",
    "Create a note book in a project",
    {
      projectId: z.string(),
      title: z.string(),
    },
    async (args) =>
      textResult(
        await api("POST", "/api/note-books", {
          projectId: args.projectId,
          title: args.title,
        }),
      ),
  );

  server.tool(
    "note_page_append",
    "Append a page to a note book. Lotaru queues it on Speak (same TTS as the Speak page). Pass speak false to skip audio.",
    {
      bookId: z.string(),
      body: z.string(),
      title: z.string().optional(),
      speak: z.boolean().optional(),
    },
    async (args) => {
      const payload: { body: string; title?: string } = { body: args.body };
      if (args.title !== undefined) {
        payload.title = args.title;
      }
      const created = await api(
        "POST",
        `/api/note-books/${encodeURIComponent(args.bookId)}/pages`,
        payload,
      );
      let shouldSpeak = true;
      if (args.speak === false) {
        shouldSpeak = false;
      }
      if (shouldSpeak !== true) {
        return textResult(created);
      }
      const parsed = createdNotePageIdSchema.safeParse(created);
      if (parsed.success !== true) {
        return textResult(created);
      }
      let speakId = "";
      if (parsed.data.speakId !== undefined && parsed.data.speakId.length > 0) {
        speakId = parsed.data.speakId;
      }
      try {
        if (speakId.length === 0) {
          return textResult(created);
        }
        const spoken = await loadSpeakMpeg(speakId);
        return noteSpeakResult({
          pageId: parsed.data.id,
          variant: "original",
          bytes: spoken.bytes,
          contentType: spoken.contentType,
          page: created,
        });
      } catch {
        return textResult(created);
      }
    },
  );

  server.tool(
    "speak",
    "Queue text for Lotaru to read aloud (Settings → Voice). Plays in the Lotaru UI when Speak is on. Returns MCP audio/mpeg.",
    {
      projectId: z.string(),
      text: z.string(),
    },
    async (args) => {
      const created = await api("POST", "/api/speak", {
        projectId: args.projectId,
        text: args.text,
        source: "mcp",
      });
      const parsed = z.object({ id: z.string().min(1) }).safeParse(created);
      if (parsed.success !== true) {
        return textResult(created);
      }
      try {
        const spoken = await loadSpeakMpeg(parsed.data.id);
        return speakAudioResult({
          bytes: spoken.bytes,
          contentType: spoken.contentType,
          meta: {
            utteranceId: parsed.data.id,
            byteLength: spoken.bytes.byteLength,
            hint: "Turn Speak on in the Lotaru sidebar so this also plays on the machine.",
          },
        });
      } catch {
        return textResult(created);
      }
    },
  );

  server.tool(
    "note_page_speak",
    "Read a note page aloud via Lotaru TTS (Edge or Qwen). Returns MCP audio/mpeg plus metadata.",
    {
      pageId: z.string(),
      variant: z.enum(["original", "translated", "polished", "summary"]).optional(),
    },
    async (args) => {
      let variant: "original" | "translated" | "polished" | "summary" = "original";
      if (args.variant !== undefined) {
        variant = args.variant;
      }
      const spoken = await apiBinary(
        "POST",
        `/api/note-pages/${encodeURIComponent(args.pageId)}/speak`,
        { variant },
      );
      return noteSpeakResult({
        pageId: args.pageId,
        variant,
        bytes: spoken.bytes,
        contentType: spoken.contentType,
      });
    },
  );

  server.tool(
    "agents_list",
    "List Lotaru agents for a project",
    { projectId: z.string() },
    async (args) =>
      textResult(await api("GET", `/api/agents?projectId=${encodeURIComponent(args.projectId)}`)),
  );

  server.tool(
    "agents_create",
    "Create a Lotaru agent (schedule or event). action \"event\" publishes the reply on the bus as agent.out.<slug>.",
    {
      projectId: z.string(),
      title: z.string(),
      prompt: z.string(),
      trigger: z.enum(["event", "schedule"]),
      eventType: z.string().optional(),
      scheduleHour: z.number().int().min(0).max(23).optional(),
      scheduleMinute: z.number().int().min(0).max(59).optional(),
      scheduleCron: z.string().optional(),
      includeVoice: z.boolean().optional(),
      action: z.enum(["none", "note", "task", "event"]).optional(),
      noteBookTitle: z.string().optional(),
      enabled: z.boolean().optional(),
    },
    async (args) => {
      const body: Record<string, string | number | boolean> = {
        projectId: args.projectId,
        title: args.title,
        prompt: args.prompt,
        trigger: args.trigger,
      };
      if (args.eventType !== undefined) {
        body.eventType = args.eventType;
      }
      if (args.scheduleHour !== undefined) {
        body.scheduleHour = args.scheduleHour;
      }
      if (args.scheduleMinute !== undefined) {
        body.scheduleMinute = args.scheduleMinute;
      }
      if (args.scheduleCron !== undefined) {
        body.scheduleCron = args.scheduleCron;
      }
      if (args.includeVoice !== undefined) {
        body.includeVoice = args.includeVoice;
      }
      if (args.action !== undefined) {
        body.action = args.action;
      }
      if (args.noteBookTitle !== undefined) {
        body.noteBookTitle = args.noteBookTitle;
      }
      if (args.enabled !== undefined) {
        body.enabled = args.enabled;
      }
      return textResult(await api("POST", "/api/agents", body));
    },
  );

  server.tool(
    "agents_run",
    "Manually run a Lotaru agent",
    { agentId: z.string() },
    async (args) =>
      textResult(await api("POST", `/api/agents/${encodeURIComponent(args.agentId)}/run`)),
  );

  server.tool(
    "agents_patch",
    "Update a Lotaru agent",
    {
      agentId: z.string(),
      title: z.string().optional(),
      prompt: z.string().optional(),
      trigger: z.enum(["event", "schedule"]).optional(),
      eventType: z.string().optional(),
      scheduleHour: z.number().int().min(0).max(23).optional(),
      scheduleMinute: z.number().int().min(0).max(59).optional(),
      scheduleCron: z.string().optional(),
      includeVoice: z.boolean().optional(),
      action: z.enum(["none", "note", "task", "event"]).optional(),
      noteBookTitle: z.string().optional(),
      enabled: z.boolean().optional(),
    },
    async (args) => {
      const body: Record<string, string | number | boolean> = {};
      if (args.title !== undefined) {
        body.title = args.title;
      }
      if (args.prompt !== undefined) {
        body.prompt = args.prompt;
      }
      if (args.trigger !== undefined) {
        body.trigger = args.trigger;
      }
      if (args.eventType !== undefined) {
        body.eventType = args.eventType;
      }
      if (args.scheduleHour !== undefined) {
        body.scheduleHour = args.scheduleHour;
      }
      if (args.scheduleMinute !== undefined) {
        body.scheduleMinute = args.scheduleMinute;
      }
      if (args.scheduleCron !== undefined) {
        body.scheduleCron = args.scheduleCron;
      }
      if (args.includeVoice !== undefined) {
        body.includeVoice = args.includeVoice;
      }
      if (args.action !== undefined) {
        body.action = args.action;
      }
      if (args.noteBookTitle !== undefined) {
        body.noteBookTitle = args.noteBookTitle;
      }
      if (args.enabled !== undefined) {
        body.enabled = args.enabled;
      }
      return textResult(
        await api("PATCH", `/api/agents/${encodeURIComponent(args.agentId)}`, body),
      );
    },
  );

  server.tool(
    "agents_delete",
    "Delete a Lotaru agent",
    { agentId: z.string() },
    async (args) =>
      textResult(await api("DELETE", `/api/agents/${encodeURIComponent(args.agentId)}`)),
  );

  server.tool(
    "agents_runs",
    "List recent runs for a Lotaru agent",
    { agentId: z.string() },
    async (args) =>
      textResult(await api("GET", `/api/agents/${encodeURIComponent(args.agentId)}/runs`)),
  );

  server.tool("settings_get", "Get Lotaru app settings (Ollama, TTS, language)", {}, async () =>
    textResult(await api("GET", "/api/settings")),
  );

  server.tool(
    "settings_put",
    "Update Lotaru app settings (Ollama host/model, TTS, language)",
    {
      ollamaHost: z.string(),
      ollamaModel: z.string(),
      translationEnabled: z.boolean(),
      targetLanguage: z.string(),
      ttsEngine: z.enum(["edge", "qwen"]),
      qwenTtsUrl: z.string(),
      ttsVoice: z.string(),
    },
    async (args) =>
      textResult(
        await api("PUT", "/api/settings", {
          ollamaHost: args.ollamaHost,
          ollamaModel: args.ollamaModel,
          translationEnabled: args.translationEnabled,
          targetLanguage: args.targetLanguage,
          ttsEngine: args.ttsEngine,
          qwenTtsUrl: args.qwenTtsUrl,
          ttsVoice: args.ttsVoice,
        }),
      ),
  );

  server.tool("settings_agent_get", "Get global AI provider profile (ollama/cursor/claude/codex)", {}, async () =>
    textResult(await api("GET", "/api/settings/agent")),
  );

  server.tool(
    "settings_agent_set",
    "Set global AI provider profile",
    {
      kind: z.enum(["ollama", "cursor", "claude", "codex"]),
      mode: z.enum(["ask", "plan", "execute"]),
      command: z.string().optional(),
    },
    async (args) => {
      let command = "";
      if (args.command !== undefined) {
        command = args.command;
      }
      return textResult(
        await api("PUT", "/api/settings/agent", {
          kind: args.kind,
          mode: args.mode,
          command,
        }),
      );
    },
  );

  server.tool(
    "knowledge_templates_list",
    "List knowledge templates for a project",
    {
      projectId: z.string(),
      kind: z.enum(["document", "diagram"]),
    },
    async (args) =>
      textResult(
        await api(
          "GET",
          `/api/knowledge/templates?projectId=${encodeURIComponent(args.projectId)}&kind=${encodeURIComponent(args.kind)}`,
        ),
      ),
  );

  server.tool(
    "knowledge_artifacts_list",
    "List knowledge artifacts for a project",
    {
      projectId: z.string(),
      kind: z.enum(["document", "diagram"]),
    },
    async (args) =>
      textResult(
        await api(
          "GET",
          `/api/knowledge/artifacts?projectId=${encodeURIComponent(args.projectId)}&kind=${encodeURIComponent(args.kind)}`,
        ),
      ),
  );


  return server;
}

function wantsHttp(): boolean {
  if (process.argv.includes("--http")) {
    return true;
  }
  const flag = process.env.LOTARU_MCP_HTTP;
  if (flag === undefined) {
    return false;
  }
  const normalized = flag.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function listenPort(): number {
  const raw = process.env.LOTARU_MCP_PORT;
  if (raw === undefined || raw.trim().length === 0) {
    return 18766;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) !== true || parsed < 1 || parsed > 65535) {
    return 18766;
  }
  return parsed;
}

function listenHost(): string {
  const raw = process.env.LOTARU_MCP_HOST;
  if (raw === undefined || raw.trim().length === 0) {
    return "0.0.0.0";
  }
  return raw.trim();
}

async function startHttp(): Promise<void> {
  const host = listenHost();
  const port = listenPort();
  const app = createMcpExpressApp({
    host,
    allowedHosts: ["127.0.0.1", "localhost", "lotaru-mcp", "[::1]"],
  });

  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    const server = createLotaruMcpServer();
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      if (res.headersSent !== true) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });

  app.delete("/mcp", (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  });

  await new Promise<void>((resolve, reject) => {
    const httpServer = app.listen(port, host, (err?: Error) => {
      if (err !== undefined) {
        reject(err);
        return;
      }
      resolve();
    });
    httpServer.on("error", reject);
  });
  process.stderr.write(`lotaru-mcp http://${host}:${String(port)}/mcp -> ${LOTARU_URL}\n`);
}

async function startStdio(): Promise<void> {
  const server = createLotaruMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (wantsHttp()) {
  await startHttp();
} else {
  await startStdio();
}
