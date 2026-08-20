#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const LOTARU_URL = (process.env.LOTARU_URL || "http://127.0.0.1:4317").replace(/\/$/, "");
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

const transport = new StdioServerTransport();
await server.connect(transport);
