import type Database from "better-sqlite3";
import { z } from "zod";
import { connectedConnectorIds, loadConnectionSecret } from "./connection-store.js";
import { requireConnectorEvent, type ConnectorKind } from "./connector-catalog.js";
import { mapStripeWebhookType } from "./hook-ingest.js";
import {
  cutoffMsFrom,
  parseIsoMs,
  POLL_MAX_PAGES,
  POLL_OVERLAP_MS,
  nextPollWatermark,
} from "./poll-walk.js";
import {
  loadPollCursor,
  pollFingerprintSeen,
  rememberPollFingerprint,
  savePollCursor,
} from "./poll-store.js";

export type AdapterEmit = (event: {
  type: string;
  projectId: string;
  path: string;
  detail: string;
}) => void;

export type AdapterHttp = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; body: unknown; text: string }>;

async function defaultAdapterHttp(
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
): Promise<{ ok: boolean; status: number; body: unknown; text: string }> {
  const res = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body.length > 0 ? init.body : undefined,
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body, text };
}

function emitForProjects(
  emit: AdapterEmit,
  projectIds: readonly string[],
  connector: ConnectorKind,
  type: string,
  path: string,
  detail: string,
): void {
  if (projectIds.length === 0) {
    return;
  }
  requireConnectorEvent(connector, type);
  for (const projectId of projectIds) {
    emit({ type, projectId, path, detail });
  }
}

function finishCursor(
  db: Database.Database,
  connector: string,
  nowMs: number,
  error: string,
  lagged: boolean,
  resume: string,
): void {
  const previous = loadPollCursor(db, connector, "account");
  const watermark = nextPollWatermark({
    lastSuccessAt: previous.lastSuccessAt,
    nowMs,
    error,
    lagged,
  });
  let cursor = new Date(nowMs).toISOString();
  if (lagged && resume.length > 0) {
    cursor = resume;
  }
  savePollCursor(db, {
    connector,
    scope: "account",
    cursor,
    primed: true,
    lastSuccessAt: watermark,
    lastError: error,
    lagged: error.length === 0 ? lagged : previous.lagged,
  });
}

const notionPageSchema = z.object({
  id: z.string(),
  object: z.string(),
  created_time: z.string(),
  last_edited_time: z.string(),
});

const notionSearchSchema = z.object({
  results: z.array(z.unknown()),
  has_more: z.boolean().optional(),
  next_cursor: z.unknown().optional(),
});

function resumeTokenFrom(raw: unknown): string {
  const parsed = z.string().min(1).safeParse(raw);
  if (parsed.success !== true) {
    return "";
  }
  return parsed.data;
}

async function pollNotion(
  db: Database.Database,
  token: string,
  projectIds: readonly string[],
  emit: AdapterEmit,
  http: AdapterHttp,
  nowMs: number,
): Promise<void> {
  const cursor = loadPollCursor(db, "notion", "account");
  const cutoffMs = cutoffMsFrom(cursor.lastSuccessAt, nowMs, POLL_OVERLAP_MS);
  let startCursor = cursor.lagged ? cursor.cursor : "";
  if (startCursor.includes("T") && startCursor.includes("Z")) {
    startCursor = "";
  }
  let lagged = false;
  let resume = "";
  let pages = 0;
  let httpCursor = startCursor;
  while (pages < POLL_MAX_PAGES) {
    pages += 1;
    const body: Record<string, string | number | { direction: string; timestamp: string }> = {
      page_size: 100,
      sort: { direction: "descending", timestamp: "last_edited_time" },
    };
    if (httpCursor.length > 0) {
      body.start_cursor = httpCursor;
    }
    const res = await http("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "notion-version": "2022-06-28",
        "content-type": "application/json",
        "user-agent": "Lotaru",
      },
      body: JSON.stringify(body),
    });
    if (res.ok !== true) {
      finishCursor(db, "notion", nowMs, `Notion poll ${String(res.status)}`, false, "");
      return;
    }
    const envelope = notionSearchSchema.safeParse(res.body);
    if (envelope.success !== true) {
      finishCursor(db, "notion", nowMs, "Notion poll returned an unexpected payload", false, "");
      return;
    }
    let anyFresh = false;
    for (const raw of envelope.data.results) {
      const page = notionPageSchema.safeParse(raw);
      if (page.success !== true || page.data.object !== "page") {
        continue;
      }
      const edited = parseIsoMs(page.data.last_edited_time);
      if (edited < cutoffMs) {
        continue;
      }
      anyFresh = true;
      const fingerprint = `page:${page.data.id}:${page.data.last_edited_time}`;
      const idKey = `page:${page.data.id}`;
      const seenExact = pollFingerprintSeen(db, "notion", "account", fingerprint);
      const known = pollFingerprintSeen(db, "notion", "account", idKey);
      rememberPollFingerprint(db, "notion", "account", idKey);
      rememberPollFingerprint(db, "notion", "account", fingerprint);
      if (seenExact || cursor.primed !== true) {
        continue;
      }
      const type = known ? "notion.page.updated" : "notion.page.added";
      emitForProjects(emit, projectIds, "notion", type, page.data.id, page.data.id);
    }
    const hasMore = envelope.data.has_more === true;
    const next = resumeTokenFrom(envelope.data.next_cursor);
    if (anyFresh !== true) {
      lagged = false;
      resume = "";
      break;
    }
    if (hasMore !== true || next.length === 0) {
      lagged = false;
      resume = "";
      break;
    }
    httpCursor = next;
    resume = next;
    lagged = true;
  }
  finishCursor(db, "notion", nowMs, "", lagged, resume);
}

const linearIssueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  title: z.string(),
});

const linearPayloadSchema = z.object({
  data: z.object({
    issues: z.object({
      nodes: z.array(linearIssueSchema),
      pageInfo: z
        .object({
          hasNextPage: z.boolean(),
          endCursor: z.unknown().optional(),
        })
        .optional(),
    }),
  }),
});

async function pollLinear(
  db: Database.Database,
  token: string,
  projectIds: readonly string[],
  emit: AdapterEmit,
  http: AdapterHttp,
  nowMs: number,
): Promise<void> {
  const cursor = loadPollCursor(db, "linear", "account");
  const cutoffMs = cutoffMsFrom(cursor.lastSuccessAt, nowMs, POLL_OVERLAP_MS);
  let httpCursor = cursor.lagged ? cursor.cursor : "";
  if (httpCursor.includes("T") && httpCursor.includes("Z")) {
    httpCursor = "";
  }
  let lagged = false;
  let resume = "";
  let pages = 0;
  while (pages < POLL_MAX_PAGES) {
    pages += 1;
    let query =
      "{ issues(first: 50, orderBy: updatedAt) { nodes { id identifier createdAt updatedAt title } pageInfo { hasNextPage endCursor } } }";
    if (httpCursor.length > 0) {
      query = `{ issues(first: 50, after: ${JSON.stringify(httpCursor)}, orderBy: updatedAt) { nodes { id identifier createdAt updatedAt title } pageInfo { hasNextPage endCursor } } }`;
    }
    const res = await http("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        authorization: token,
        "content-type": "application/json",
        "user-agent": "Lotaru",
      },
      body: JSON.stringify({ query }),
    });
    if (res.ok !== true) {
      finishCursor(db, "linear", nowMs, `Linear poll ${String(res.status)}`, false, "");
      return;
    }
    const parsed = linearPayloadSchema.safeParse(res.body);
    if (parsed.success !== true) {
      finishCursor(db, "linear", nowMs, "Linear poll returned an unexpected payload", false, "");
      return;
    }
    let anyFresh = false;
    for (const issue of parsed.data.data.issues.nodes) {
      const edited = parseIsoMs(issue.updatedAt);
      if (edited < cutoffMs) {
        continue;
      }
      anyFresh = true;
      const fingerprint = `issue:${issue.id}:${issue.updatedAt}`;
      const seenExact = pollFingerprintSeen(db, "linear", "account", fingerprint);
      rememberPollFingerprint(db, "linear", "account", fingerprint);
      if (seenExact || cursor.primed !== true) {
        continue;
      }
      emitForProjects(emit, projectIds, "linear", "linear.issue", issue.identifier, issue.title);
    }
    const pageInfo = parsed.data.data.issues.pageInfo;
    const hasNext = pageInfo !== undefined && pageInfo.hasNextPage === true;
    const next = pageInfo !== undefined ? resumeTokenFrom(pageInfo.endCursor) : "";
    if (anyFresh !== true) {
      lagged = false;
      resume = "";
      break;
    }
    if (hasNext !== true || next.length === 0) {
      lagged = false;
      resume = "";
      break;
    }
    httpCursor = next;
    resume = next;
    lagged = true;
  }
  finishCursor(db, "linear", nowMs, "", lagged, resume);
}

const stripeEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  created: z.number().int(),
});

const stripeListSchema = z.object({
  data: z.array(stripeEventSchema),
  has_more: z.boolean(),
});

async function pollStripe(
  db: Database.Database,
  token: string,
  projectIds: readonly string[],
  emit: AdapterEmit,
  http: AdapterHttp,
  nowMs: number,
): Promise<void> {
  const cursor = loadPollCursor(db, "stripe", "account");
  const cutoffMs = cutoffMsFrom(cursor.lastSuccessAt, nowMs, POLL_OVERLAP_MS);
  const createdGte = Math.floor(cutoffMs / 1000);
  let drainAfter = cursor.lagged ? cursor.cursor : "";
  if (drainAfter.includes("T") && drainAfter.includes("Z")) {
    drainAfter = "";
  }
  let lagged = false;
  let resume = "";
  let pages = 0;
  let startingAfter = "";
  let headDone = drainAfter.length === 0;
  while (pages < POLL_MAX_PAGES) {
    pages += 1;
    if (headDone !== true) {
      startingAfter = "";
      headDone = true;
    } else if (drainAfter.length > 0) {
      startingAfter = drainAfter;
      drainAfter = "";
    }
    let url = `https://api.stripe.com/v1/events?limit=100&created[gte]=${String(createdGte)}`;
    if (startingAfter.length > 0) {
      url = `${url}&starting_after=${encodeURIComponent(startingAfter)}`;
    }
    const res = await http(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        "user-agent": "Lotaru",
      },
      body: "",
    });
    if (res.ok !== true) {
      finishCursor(db, "stripe", nowMs, `Stripe poll ${String(res.status)}`, false, "");
      return;
    }
    const parsed = stripeListSchema.safeParse(res.body);
    if (parsed.success !== true) {
      finishCursor(db, "stripe", nowMs, "Stripe poll returned an unexpected payload", false, "");
      return;
    }
    let lastId = "";
    for (const row of parsed.data.data) {
      lastId = row.id;
      const fingerprint = `evt:${row.id}`;
      if (pollFingerprintSeen(db, "stripe", "account", fingerprint)) {
        continue;
      }
      rememberPollFingerprint(db, "stripe", "account", fingerprint);
      if (cursor.primed !== true) {
        continue;
      }
      const type = mapStripeWebhookType(row.type);
      if (type.length === 0) {
        continue;
      }
      emitForProjects(emit, projectIds, "stripe", type, row.id, row.type);
    }
    if (parsed.data.has_more !== true || lastId.length === 0) {
      lagged = false;
      resume = "";
      break;
    }
    startingAfter = lastId;
    resume = lastId;
    lagged = true;
  }
  finishCursor(db, "stripe", nowMs, "", lagged, resume);
}

function rssFingerprints(xml: string): string[] {
  const ids: string[] = [];
  const guidRe = /<guid[^>]*>([^<]+)<\/guid>/gi;
  const linkRe = /<link[^>]*>([^<]+)<\/link>/gi;
  let match = guidRe.exec(xml);
  while (match !== null) {
    const value = match[1];
    if (value !== undefined && value.trim().length > 0) {
      ids.push(value.trim());
    }
    match = guidRe.exec(xml);
  }
  if (ids.length > 0) {
    return ids;
  }
  match = linkRe.exec(xml);
  while (match !== null) {
    const value = match[1];
    if (value !== undefined && value.trim().length > 0) {
      ids.push(value.trim());
    }
    match = linkRe.exec(xml);
  }
  return ids;
}

async function pollRss(
  db: Database.Database,
  feedUrl: string,
  projectIds: readonly string[],
  emit: AdapterEmit,
  http: AdapterHttp,
  nowMs: number,
): Promise<void> {
  if (feedUrl.startsWith("http://") !== true && feedUrl.startsWith("https://") !== true) {
    finishCursor(db, "rss", nowMs, "RSS connection must be a feed URL", false, "");
    return;
  }
  const cursor = loadPollCursor(db, "rss", "account");
  const res = await http(feedUrl, {
    method: "GET",
    headers: { "user-agent": "Lotaru" },
    body: "",
  });
  if (res.ok !== true) {
    finishCursor(db, "rss", nowMs, `RSS poll ${String(res.status)}`, false, "");
    return;
  }
  const ids = rssFingerprints(res.text);
  for (const id of ids) {
    const fingerprint = `item:${id}`;
    if (pollFingerprintSeen(db, "rss", "account", fingerprint)) {
      continue;
    }
    rememberPollFingerprint(db, "rss", "account", fingerprint);
    if (cursor.primed !== true) {
      continue;
    }
    emitForProjects(emit, projectIds, "rss", "rss.triggered", feedUrl, id);
  }
  finishCursor(db, "rss", nowMs, "", false, "");
}

export type JiraSecret = {
  site: string;
  email: string;
  token: string;
};

export function parseJiraSecret(secret: string): JiraSecret[] {
  const trimmed = secret.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 3) {
    return [];
  }
  const siteRaw = parts[0];
  const emailRaw = parts[1];
  const tokenRaw = parts[2];
  if (siteRaw === undefined || emailRaw === undefined || tokenRaw === undefined) {
    return [];
  }
  const siteUrl = z.string().url().safeParse(siteRaw);
  const email = z.string().email().safeParse(emailRaw);
  const token = z.string().min(8).safeParse(tokenRaw);
  if (siteUrl.success !== true || email.success !== true || token.success !== true) {
    return [];
  }
  if (siteUrl.data.startsWith("https://") !== true) {
    return [];
  }
  const host = new URL(siteUrl.data).hostname;
  if (host.endsWith(".atlassian.net") !== true) {
    return [];
  }
  const site = siteUrl.data.endsWith("/") ? siteUrl.data.slice(0, -1) : siteUrl.data;
  return [{ site, email: email.data, token: token.data }];
}

function jiraJqlStamp(ms: number): string {
  const iso = new Date(ms).toISOString();
  const day = iso.slice(0, 10);
  const clock = iso.slice(11, 16);
  if (day.length !== 10) {
    return "";
  }
  if (clock.length !== 5) {
    return "";
  }
  return `${day} ${clock}`;
}

const jiraIssueSchema = z.object({
  id: z.string(),
  key: z.string(),
  fields: z.object({
    summary: z.string(),
    updated: z.string(),
    created: z.string(),
  }),
});

const jiraSearchSchema = z.object({
  issues: z.array(z.unknown()),
  isLast: z.boolean().optional(),
  nextPageToken: z.unknown().optional(),
});

async function pollJira(
  db: Database.Database,
  secret: string,
  projectIds: readonly string[],
  emit: AdapterEmit,
  http: AdapterHttp,
  nowMs: number,
): Promise<void> {
  const parsedSecret = parseJiraSecret(secret);
  const cred = parsedSecret[0];
  if (cred === undefined) {
    finishCursor(db, "jira", nowMs, "Jira connection needs site email and API token", false, "");
    return;
  }
  const cursor = loadPollCursor(db, "jira", "account");
  const cutoffMs = cutoffMsFrom(cursor.lastSuccessAt, nowMs, POLL_OVERLAP_MS);
  const stamp = jiraJqlStamp(cutoffMs);
  if (stamp.length === 0) {
    finishCursor(db, "jira", nowMs, "Jira poll cutoff is invalid", false, "");
    return;
  }
  let httpCursor = cursor.lagged ? cursor.cursor : "";
  if (httpCursor.includes("T") && httpCursor.includes("Z")) {
    httpCursor = "";
  }
  const basic = Buffer.from(`${cred.email}:${cred.token}`).toString("base64");
  let lagged = false;
  let resume = "";
  let pages = 0;
  while (pages < POLL_MAX_PAGES) {
    pages += 1;
    const body: Record<string, string | number | string[]> = {
      jql: `updated >= "${stamp}" ORDER BY updated DESC`,
      maxResults: 100,
      fields: ["summary", "updated", "created"],
    };
    if (httpCursor.length > 0) {
      body.nextPageToken = httpCursor;
    }
    const res = await http(`${cred.site}/rest/api/3/search/jql`, {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "Lotaru",
      },
      body: JSON.stringify(body),
    });
    if (res.ok !== true) {
      finishCursor(db, "jira", nowMs, `Jira poll ${String(res.status)}`, false, "");
      return;
    }
    const envelope = jiraSearchSchema.safeParse(res.body);
    if (envelope.success !== true) {
      finishCursor(db, "jira", nowMs, "Jira poll returned an unexpected payload", false, "");
      return;
    }
    let anyFresh = false;
    for (const raw of envelope.data.issues) {
      const issue = jiraIssueSchema.safeParse(raw);
      if (issue.success !== true) {
        continue;
      }
      const edited = parseIsoMs(issue.data.fields.updated);
      if (edited < cutoffMs) {
        continue;
      }
      anyFresh = true;
      const fingerprint = `issue:${issue.data.key}:${issue.data.fields.updated}`;
      const idKey = `issue:${issue.data.key}`;
      const seenExact = pollFingerprintSeen(db, "jira", "account", fingerprint);
      const known = pollFingerprintSeen(db, "jira", "account", idKey);
      rememberPollFingerprint(db, "jira", "account", idKey);
      rememberPollFingerprint(db, "jira", "account", fingerprint);
      if (seenExact || cursor.primed !== true) {
        continue;
      }
      const created = parseIsoMs(issue.data.fields.created);
      const type = known !== true && created >= cutoffMs ? "jira.issue.created" : "jira.issue.updated";
      emitForProjects(emit, projectIds, "jira", type, issue.data.key, issue.data.fields.summary);
    }
    const next = resumeTokenFrom(envelope.data.nextPageToken);
    const lastPage = envelope.data.isLast === true || next.length === 0;
    if (anyFresh !== true || lastPage) {
      lagged = false;
      resume = "";
      break;
    }
    httpCursor = next;
    resume = next;
    lagged = true;
  }
  finishCursor(db, "jira", nowMs, "", lagged, resume);
}

export async function pollConnectedAdapters(
  db: Database.Database,
  projectIds: readonly string[],
  emit: AdapterEmit,
  options: { http?: AdapterHttp; nowMs?: number } = {},
): Promise<void> {
  const http = options.http !== undefined ? options.http : defaultAdapterHttp;
  const nowMs = options.nowMs !== undefined ? options.nowMs : Date.now();
  const connected = connectedConnectorIds(db);
  for (const id of connected) {
    const secret = loadConnectionSecret(db, id);
    if (secret.length === 0) {
      continue;
    }
    if (id === "notion") {
      await pollNotion(db, secret, projectIds, emit, http, nowMs);
    }
    if (id === "linear") {
      await pollLinear(db, secret, projectIds, emit, http, nowMs);
    }
    if (id === "stripe") {
      await pollStripe(db, secret, projectIds, emit, http, nowMs);
    }
    if (id === "rss") {
      await pollRss(db, secret, projectIds, emit, http, nowMs);
    }
    if (id === "jira") {
      await pollJira(db, secret, projectIds, emit, http, nowMs);
    }
  }
}
