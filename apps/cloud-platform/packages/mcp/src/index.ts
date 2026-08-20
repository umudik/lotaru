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

function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

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
    "reactions_list",
    "List project reactions",
    { projectId: z.string() },
    async (args) =>
      textResult(
        await api("GET", `/api/v1/projects/${encodeURIComponent(args.projectId)}/reactions`),
      ),
  );

  server.tool(
    "reactions_create",
    "Create a create_task reaction",
    {
      projectId: z.string(),
      eventType: z.string(),
      titleTemplate: z.string(),
      repo: z.string().optional(),
      enabled: z.boolean().optional(),
    },
    async (args) => {
      let repo = "";
      if (args.repo !== undefined) {
        repo = args.repo;
      }
      let enabled = true;
      if (args.enabled !== undefined) {
        enabled = args.enabled;
      }
      return textResult(
        await api("POST", `/api/v1/projects/${encodeURIComponent(args.projectId)}/reactions`, {
          action: "create_task",
          eventType: args.eventType,
          titleTemplate: args.titleTemplate,
          repo,
          enabled,
        }),
      );
    },
  );

  server.tool(
    "reactions_delete",
    "Delete a reaction",
    { projectId: z.string(), reactionId: z.string() },
    async (args) =>
      textResult(
        await api(
          "DELETE",
          `/api/v1/projects/${encodeURIComponent(args.projectId)}/reactions/${encodeURIComponent(args.reactionId)}`,
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
    "voice_decisions",
    "List voice intent scanner decisions",
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
          `/api/voice/decisions?projectId=${encodeURIComponent(args.projectId)}&limit=${String(limit)}`,
        ),
      );
    },
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
    "Append a page to a note book",
    {
      bookId: z.string(),
      body: z.string(),
      title: z.string().optional(),
    },
    async (args) => {
      const payload: { body: string; title?: string } = { body: args.body };
      if (args.title !== undefined) {
        payload.title = args.title;
      }
      return textResult(
        await api("POST", `/api/note-books/${encodeURIComponent(args.bookId)}/pages`, payload),
      );
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
    "agents_run",
    "Manually run a Lotaru agent",
    { agentId: z.string() },
    async (args) =>
      textResult(await api("POST", `/api/agents/${encodeURIComponent(args.agentId)}/run`)),
  );

  server.tool(
    "agents_runs",
    "List recent runs for a Lotaru agent",
    { agentId: z.string() },
    async (args) =>
      textResult(await api("GET", `/api/agents/${encodeURIComponent(args.agentId)}/runs`)),
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
