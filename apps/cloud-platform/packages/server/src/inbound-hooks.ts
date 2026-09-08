import type Database from "better-sqlite3";
import { z } from "zod";
import { hookSyncShouldSkip, hookTokenFromIngestUrl, hookUrlHasToken } from "./github-hooks.js";
import { loadHookSync, saveHookSync } from "./poll-store.js";

export const HOOK_ACCOUNT_SCOPE = "account";

export type InboundHookHttp = (
  url: string,
  init: { method: string; token: string; body: string },
) => Promise<{ ok: boolean; status: number; body: unknown }>;

type LinearHookView = {
  id: string;
  url: string;
  enabled: boolean;
};

type StripeHookView = {
  id: string;
  url: string;
  status: string;
};

const linearNodeSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  enabled: z.boolean().optional(),
});

const linearListSchema = z.object({
  errors: z.array(z.object({ message: z.string() })).optional(),
  data: z
    .object({
      webhooks: z.object({
        nodes: z.array(z.unknown()),
        pageInfo: z
          .object({
            hasNextPage: z.boolean(),
            endCursor: z.unknown().optional(),
          })
          .optional(),
      }),
    })
    .optional(),
});

const linearMutateSchema = z.object({
  errors: z.array(z.object({ message: z.string() })).optional(),
  data: z
    .object({
      webhookCreate: z
        .object({
          success: z.boolean(),
          webhook: z.object({ id: z.string().min(1) }).optional(),
        })
        .optional(),
      webhookUpdate: z
        .object({
          success: z.boolean(),
          webhook: z.object({ id: z.string().min(1) }).optional(),
        })
        .optional(),
    })
    .optional(),
});

const stripeEndpointSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  status: z.string().min(1),
});

const stripeListSchema = z.object({
  data: z.array(z.unknown()),
  has_more: z.boolean(),
});

const stripeErrorSchema = z.object({
  error: z.object({
    message: z.string().min(1),
  }),
});

function catchHookMessage(failure: unknown, fallback: string): string {
  if (failure instanceof Error && failure.message.length > 0) {
    return failure.message;
  }
  return fallback;
}

function graphqlErrorMessage(errors: readonly { message: string }[] | undefined): string {
  if (errors === undefined || errors.length === 0) {
    return "";
  }
  const first = errors[0];
  if (first === undefined) {
    return "";
  }
  if (first.message.length === 0) {
    return "";
  }
  return first.message;
}

function cursorText(raw: unknown): string {
  const parsed = z.string().min(1).safeParse(raw);
  if (parsed.success !== true) {
    return "";
  }
  return parsed.data;
}

async function readJson(res: Response): Promise<{ ok: boolean; status: number; body: unknown }> {
  const text = await res.text();
  if (text.length === 0) {
    return { ok: res.ok, status: res.status, body: [] };
  }
  try {
    return { ok: res.ok, status: res.status, body: JSON.parse(text) };
  } catch {
    return { ok: res.ok, status: res.status, body: [] };
  }
}

export async function defaultLinearHookHttp(
  url: string,
  init: { method: string; token: string; body: string },
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const posted = await fetch(url, {
    method: init.method,
    headers: {
      authorization: init.token,
      "content-type": "application/json",
      "user-agent": "Lotaru",
    },
    body: init.body,
  });
  return readJson(posted);
}

export async function defaultStripeHookHttp(
  url: string,
  init: { method: string; token: string; body: string },
): Promise<{ ok: boolean; status: number; body: unknown }> {
  if (init.body.length > 0) {
    const posted = await fetch(url, {
      method: init.method,
      headers: {
        authorization: `Bearer ${init.token}`,
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "Lotaru",
      },
      body: init.body,
    });
    return readJson(posted);
  }
  const listed = await fetch(url, {
    method: init.method,
    headers: {
      authorization: `Bearer ${init.token}`,
      "user-agent": "Lotaru",
    },
  });
  return readJson(listed);
}

function stripeForm(pairs: readonly { key: string; value: string }[]): string {
  const parts: string[] = [];
  for (const pair of pairs) {
    parts.push(`${encodeURIComponent(pair.key)}=${encodeURIComponent(pair.value)}`);
  }
  return parts.join("&");
}

function linearListQuery(after: string): string {
  if (after.length === 0) {
    return "query { webhooks(first: 50) { nodes { id url enabled } pageInfo { hasNextPage endCursor } } }";
  }
  return `query { webhooks(first: 50, after: ${JSON.stringify(after)}) { nodes { id url enabled } pageInfo { hasNextPage endCursor } } }`;
}

function linearCreateBody(ingestUrl: string): string {
  return JSON.stringify({
    query:
      "mutation($input: WebhookCreateInput!) { webhookCreate(input: $input) { success webhook { id } } }",
    variables: {
      input: {
        url: ingestUrl,
        allPublicTeams: true,
        enabled: true,
        label: "Lotaru",
        resourceTypes: ["Issue", "Comment", "IssueLabel", "Project", "Cycle", "Reaction"],
      },
    },
  });
}

function linearUpdateBody(id: string, ingestUrl: string): string {
  return JSON.stringify({
    query:
      "mutation($id: String!, $input: WebhookUpdateInput!) { webhookUpdate(id: $id, input: $input) { success webhook { id } } }",
    variables: {
      id,
      input: {
        url: ingestUrl,
        enabled: true,
      },
    },
  });
}

function stripeStatusDetail(status: number, body: unknown): string {
  const parsed = stripeErrorSchema.safeParse(body);
  if (parsed.success === true) {
    return parsed.data.error.message;
  }
  return `Stripe webhook ${String(status)}`;
}

function linearStatusDetail(status: number): string {
  return `Linear webhook ${String(status)}`;
}

function parseLinearNodes(raw: readonly unknown[]): LinearHookView[] {
  const listed: LinearHookView[] = [];
  for (const row of raw) {
    const parsed = linearNodeSchema.safeParse(row);
    if (parsed.success !== true) {
      continue;
    }
    listed.push({
      id: parsed.data.id,
      url: parsed.data.url,
      enabled: parsed.data.enabled !== false,
    });
  }
  return listed;
}

async function listLinearHooks(
  http: InboundHookHttp,
  apiToken: string,
  hookToken: string,
): Promise<LinearHookView[]> {
  const matched: LinearHookView[] = [];
  let after = "";
  for (let page = 1; page <= 3; page += 1) {
    const res = await http("https://api.linear.app/graphql", {
      method: "POST",
      token: apiToken,
      body: JSON.stringify({ query: linearListQuery(after) }),
    });
    if (res.ok !== true) {
      throw new Error(linearStatusDetail(res.status));
    }
    const envelope = linearListSchema.safeParse(res.body);
    if (envelope.success !== true) {
      throw new Error("Linear webhook invalid list");
    }
    const gqlError = graphqlErrorMessage(envelope.data.errors);
    if (gqlError.length > 0) {
      throw new Error(gqlError);
    }
    if (envelope.data.data === undefined) {
      throw new Error("Linear webhook invalid list");
    }
    const rows = parseLinearNodes(envelope.data.data.webhooks.nodes);
    for (const row of rows) {
      if (hookUrlHasToken(row.url, hookToken)) {
        matched.push(row);
      }
    }
    const pageInfo = envelope.data.data.webhooks.pageInfo;
    const hasNext = pageInfo !== undefined && pageInfo.hasNextPage === true;
    const next = pageInfo !== undefined ? cursorText(pageInfo.endCursor) : "";
    if (hasNext !== true || next.length === 0) {
      return matched;
    }
    after = next;
  }
  return matched;
}

function requireLinearSuccess(body: unknown, field: "webhookCreate" | "webhookUpdate"): void {
  const parsed = linearMutateSchema.safeParse(body);
  if (parsed.success !== true) {
    throw new Error("Linear webhook invalid payload");
  }
  const gqlError = graphqlErrorMessage(parsed.data.errors);
  if (gqlError.length > 0) {
    throw new Error(gqlError);
  }
  if (parsed.data.data === undefined) {
    throw new Error("Linear webhook invalid payload");
  }
  if (field === "webhookCreate") {
    const created = parsed.data.data.webhookCreate;
    if (created === undefined || created.success !== true) {
      throw new Error("Linear webhook create failed");
    }
    return;
  }
  const updated = parsed.data.data.webhookUpdate;
  if (updated === undefined || updated.success !== true) {
    throw new Error("Linear webhook update failed");
  }
}

async function writeLinearHook(
  http: InboundHookHttp,
  apiToken: string,
  ingestUrl: string,
  existing: LinearHookView[],
): Promise<void> {
  const first = existing[0];
  if (first === undefined) {
    const created = await http("https://api.linear.app/graphql", {
      method: "POST",
      token: apiToken,
      body: linearCreateBody(ingestUrl),
    });
    if (created.ok !== true) {
      throw new Error(linearStatusDetail(created.status));
    }
    requireLinearSuccess(created.body, "webhookCreate");
    return;
  }
  if (first.url === ingestUrl && first.enabled === true) {
    return;
  }
  const updated = await http("https://api.linear.app/graphql", {
    method: "POST",
    token: apiToken,
    body: linearUpdateBody(first.id, ingestUrl),
  });
  if (updated.ok !== true) {
    throw new Error(linearStatusDetail(updated.status));
  }
  requireLinearSuccess(updated.body, "webhookUpdate");
}

async function listStripeHooks(
  http: InboundHookHttp,
  apiToken: string,
  hookToken: string,
): Promise<StripeHookView[]> {
  const matched: StripeHookView[] = [];
  let after = "";
  for (let page = 1; page <= 3; page += 1) {
    let url = "https://api.stripe.com/v1/webhook_endpoints?limit=100";
    if (after.length > 0) {
      url = `${url}&starting_after=${encodeURIComponent(after)}`;
    }
    const res = await http(url, { method: "GET", token: apiToken, body: "" });
    if (res.ok !== true) {
      throw new Error(stripeStatusDetail(res.status, res.body));
    }
    const envelope = stripeListSchema.safeParse(res.body);
    if (envelope.success !== true) {
      throw new Error("Stripe webhook invalid list");
    }
    let lastId = "";
    for (const row of envelope.data.data) {
      const parsed = stripeEndpointSchema.safeParse(row);
      if (parsed.success !== true) {
        continue;
      }
      lastId = parsed.data.id;
      if (hookUrlHasToken(parsed.data.url, hookToken)) {
        matched.push({
          id: parsed.data.id,
          url: parsed.data.url,
          status: parsed.data.status,
        });
      }
    }
    if (envelope.data.has_more !== true || lastId.length === 0) {
      return matched;
    }
    after = lastId;
  }
  return matched;
}

async function writeStripeHook(
  http: InboundHookHttp,
  apiToken: string,
  ingestUrl: string,
  existing: StripeHookView[],
): Promise<void> {
  const first = existing[0];
  if (first === undefined) {
    const created = await http("https://api.stripe.com/v1/webhook_endpoints", {
      method: "POST",
      token: apiToken,
      body: stripeForm([
        { key: "url", value: ingestUrl },
        { key: "enabled_events[]", value: "*" },
        { key: "description", value: "Lotaru" },
      ]),
    });
    if (created.ok !== true) {
      throw new Error(stripeStatusDetail(created.status, created.body));
    }
    return;
  }
  if (first.url === ingestUrl && first.status === "enabled") {
    return;
  }
  const pairs: { key: string; value: string }[] = [{ key: "url", value: ingestUrl }];
  if (first.status !== "enabled") {
    pairs.push({ key: "disabled", value: "false" });
  }
  const patched = await http(`https://api.stripe.com/v1/webhook_endpoints/${first.id}`, {
    method: "POST",
    token: apiToken,
    body: stripeForm(pairs),
  });
  if (patched.ok !== true) {
    throw new Error(stripeStatusDetail(patched.status, patched.body));
  }
}

async function syncAccountHook(input: {
  db: Database.Database;
  connector: "linear" | "stripe";
  token: string;
  ingestUrl: string;
  nowMs: number;
  tunnelLive: boolean;
  http: InboundHookHttp;
}): Promise<void> {
  if (input.tunnelLive !== true) {
    return;
  }
  if (input.token.length === 0) {
    return;
  }
  if (input.ingestUrl.length === 0) {
    return;
  }
  const stored = loadHookSync(input.db, input.connector, HOOK_ACCOUNT_SCOPE);
  if (hookSyncShouldSkip(stored, input.ingestUrl, input.nowMs)) {
    return;
  }
  const hookToken = hookTokenFromIngestUrl(input.ingestUrl);
  const fallback = input.connector === "linear" ? "Linear webhook request failed" : "Stripe webhook request failed";
  try {
    if (input.connector === "linear") {
      const matched = await listLinearHooks(input.http, input.token, hookToken);
      await writeLinearHook(input.http, input.token, input.ingestUrl, matched);
    } else {
      const matched = await listStripeHooks(input.http, input.token, hookToken);
      await writeStripeHook(input.http, input.token, input.ingestUrl, matched);
    }
    saveHookSync(input.db, {
      connector: input.connector,
      repo: HOOK_ACCOUNT_SCOPE,
      url: input.ingestUrl,
      lastError: "",
      lastAttemptAt: input.nowMs,
    });
  } catch (failure) {
    saveHookSync(input.db, {
      connector: input.connector,
      repo: HOOK_ACCOUNT_SCOPE,
      url: stored.url,
      lastError: catchHookMessage(failure, fallback),
      lastAttemptAt: input.nowMs,
    });
  }
}

export async function syncLinearInboundHook(input: {
  db: Database.Database;
  token: string;
  ingestUrl: string;
  nowMs: number;
  tunnelLive: boolean;
  http?: InboundHookHttp;
}): Promise<void> {
  const http = input.http !== undefined ? input.http : defaultLinearHookHttp;
  await syncAccountHook({
    db: input.db,
    connector: "linear",
    token: input.token,
    ingestUrl: input.ingestUrl,
    nowMs: input.nowMs,
    tunnelLive: input.tunnelLive,
    http,
  });
}

export async function syncStripeInboundHook(input: {
  db: Database.Database;
  token: string;
  ingestUrl: string;
  nowMs: number;
  tunnelLive: boolean;
  http?: InboundHookHttp;
}): Promise<void> {
  const http = input.http !== undefined ? input.http : defaultStripeHookHttp;
  await syncAccountHook({
    db: input.db,
    connector: "stripe",
    token: input.token,
    ingestUrl: input.ingestUrl,
    nowMs: input.nowMs,
    tunnelLive: input.tunnelLive,
    http,
  });
}
