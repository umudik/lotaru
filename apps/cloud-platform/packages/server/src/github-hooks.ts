import type Database from "better-sqlite3";
import { z } from "zod";
import { POLL_DRAIN_MS } from "./poll-walk.js";
import { splitGithubRepo } from "./github-pulls.js";
import { loadHookSync, saveHookSync } from "./poll-store.js";

export const HOOK_RETRY_MS = 30_000;

export type GithubHookHttp = (
  url: string,
  init: { method: string; token: string; body: string },
) => Promise<{ ok: boolean; status: number; body: unknown }>;

type GithubHookView = {
  id: number;
  url: string;
  active: boolean;
};

const githubHookRowSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  active: z.boolean().optional(),
  config: z.object({
    url: z.string().min(1),
  }),
});

export function ingestHookUrl(publicUrl: string, token: string): string {
  const trimmed = publicUrl.trim();
  if (trimmed.length === 0) {
    return "";
  }
  if (token.length === 0) {
    return "";
  }
  const base = trimmed.endsWith("/") ? trimmed.slice(0, trimmed.length - 1) : trimmed;
  return `${base}/api/ingest/hooks/${token}`;
}

export function hookTokenFromIngestUrl(ingestUrl: string): string {
  const marker = "/api/ingest/hooks/";
  const at = ingestUrl.lastIndexOf(marker);
  if (at < 0) {
    return "";
  }
  const token = ingestUrl.slice(at + marker.length).trim();
  if (token.includes("/")) {
    return "";
  }
  return token;
}

export function hookUrlHasToken(url: string, token: string): boolean {
  if (token.length === 0) {
    return false;
  }
  const path = `/api/ingest/hooks/${token}`;
  if (url.includes(path) !== true) {
    return false;
  }
  return true;
}

export function uniqueGithubRepos(watches: readonly { repo: string }[]): string[] {
  const listed: string[] = [];
  const seen = new Set<string>();
  for (const watch of watches) {
    const repo = watch.repo.trim();
    if (repo.length === 0) {
      continue;
    }
    if (seen.has(repo)) {
      continue;
    }
    seen.add(repo);
    listed.push(repo);
  }
  return listed;
}

export function hookSyncShouldSkip(row: { url: string; lastError: string; lastAttemptAt: number }, ingestUrl: string, nowMs: number): boolean {
  if (row.url === ingestUrl && row.lastError.length === 0) {
    return true;
  }
  if (row.lastError.length === 0) {
    return false;
  }
  if (row.lastAttemptAt < 1) {
    return false;
  }
  if (nowMs - row.lastAttemptAt < HOOK_RETRY_MS) {
    return true;
  }
  return false;
}

async function readGithubJson(res: Response): Promise<{ ok: boolean; status: number; body: unknown }> {
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

export function pollDelayWithHookWait(pollDelayMs: number, waitForTunnel: boolean): number {
  if (waitForTunnel !== true) {
    return pollDelayMs;
  }
  if (Number.isFinite(pollDelayMs) !== true) {
    return POLL_DRAIN_MS;
  }
  if (pollDelayMs < 1) {
    return POLL_DRAIN_MS;
  }
  if (pollDelayMs <= POLL_DRAIN_MS) {
    return pollDelayMs;
  }
  return POLL_DRAIN_MS;
}

export async function defaultGithubHookHttp(
  url: string,
  init: { method: string; token: string; body: string },
): Promise<{ ok: boolean; status: number; body: unknown }> {
  if (init.body.length > 0) {
    const posted = await fetch(url, {
      method: init.method,
      headers: {
        authorization: `Bearer ${init.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "Lotaru",
        "content-type": "application/json",
      },
      body: init.body,
    });
    return readGithubJson(posted);
  }
  const listed = await fetch(url, {
    method: init.method,
    headers: {
      authorization: `Bearer ${init.token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "Lotaru",
    },
  });
  return readGithubJson(listed);
}

function hookStatusDetail(status: number): string {
  if (status === 403) {
    return "GitHub webhook 403";
  }
  if (status === 404) {
    return "GitHub webhook 404";
  }
  if (status === 422) {
    return "GitHub webhook 422";
  }
  return `GitHub webhook ${String(status)}`;
}

function parseGithubHookList(body: unknown): GithubHookView[] {
  const asList = z.array(z.unknown()).safeParse(body);
  if (asList.success !== true) {
    throw new Error("GitHub webhook invalid list");
  }
  const listed: GithubHookView[] = [];
  for (const row of asList.data) {
    const parsed = githubHookRowSchema.safeParse(row);
    if (parsed.success !== true) {
      continue;
    }
    listed.push({
      id: parsed.data.id,
      url: parsed.data.config.url,
      active: parsed.data.active !== false,
    });
  }
  return listed;
}

function createHookBody(ingestUrl: string): string {
  return JSON.stringify({
    name: "web",
    active: true,
    events: ["pull_request", "issues", "push"],
    config: {
      url: ingestUrl,
      content_type: "json",
      insecure_ssl: "0",
    },
  });
}

function configHookBody(ingestUrl: string): string {
  return JSON.stringify({
    url: ingestUrl,
    content_type: "json",
    insecure_ssl: "0",
  });
}

function catchHookMessage(failure: unknown): string {
  if (failure instanceof Error && failure.message.length > 0) {
    return failure.message;
  }
  return "GitHub webhook request failed";
}

async function listLotaruHooks(
  http: GithubHookHttp,
  apiToken: string,
  owner: string,
  name: string,
  hookToken: string,
): Promise<GithubHookView[]> {
  const matched: GithubHookView[] = [];
  for (let page = 1; page <= 3; page += 1) {
    const url = `https://api.github.com/repos/${owner}/${name}/hooks?per_page=100&page=${String(page)}`;
    const res = await http(url, { method: "GET", token: apiToken, body: "" });
    if (res.ok !== true) {
      throw new Error(hookStatusDetail(res.status));
    }
    const rows = parseGithubHookList(res.body);
    for (const row of rows) {
      if (hookUrlHasToken(row.url, hookToken)) {
        matched.push(row);
      }
    }
    if (rows.length < 100) {
      return matched;
    }
  }
  return matched;
}

async function writeGithubHook(
  http: GithubHookHttp,
  apiToken: string,
  owner: string,
  name: string,
  ingestUrl: string,
  existing: GithubHookView[],
): Promise<void> {
  const first = existing[0];
  if (first === undefined) {
    const created = await http(`https://api.github.com/repos/${owner}/${name}/hooks`, {
      method: "POST",
      token: apiToken,
      body: createHookBody(ingestUrl),
    });
    if (created.ok !== true) {
      throw new Error(hookStatusDetail(created.status));
    }
    return;
  }
  if (first.url !== ingestUrl) {
    const patched = await http(`https://api.github.com/repos/${owner}/${name}/hooks/${String(first.id)}/config`, {
      method: "PATCH",
      token: apiToken,
      body: configHookBody(ingestUrl),
    });
    if (patched.ok !== true) {
      throw new Error(hookStatusDetail(patched.status));
    }
  }
  if (first.active !== true) {
    const activated = await http(`https://api.github.com/repos/${owner}/${name}/hooks/${String(first.id)}`, {
      method: "PATCH",
      token: apiToken,
      body: JSON.stringify({ active: true }),
    });
    if (activated.ok !== true) {
      throw new Error(hookStatusDetail(activated.status));
    }
  }
}

async function syncGithubRepoHook(
  db: Database.Database,
  repo: string,
  apiToken: string,
  ingestUrl: string,
  nowMs: number,
  http: GithubHookHttp,
): Promise<void> {
  const stored = loadHookSync(db, "github", repo);
  if (hookSyncShouldSkip(stored, ingestUrl, nowMs)) {
    return;
  }
  const split = splitGithubRepo(repo);
  if (split.owner.length === 0) {
    saveHookSync(db, {
      connector: "github",
      repo,
      url: stored.url,
      lastError: "GitHub webhook invalid repo",
      lastAttemptAt: nowMs,
    });
    return;
  }
  const hookToken = hookTokenFromIngestUrl(ingestUrl);
  try {
    const matched = await listLotaruHooks(http, apiToken, split.owner, split.name, hookToken);
    await writeGithubHook(http, apiToken, split.owner, split.name, ingestUrl, matched);
    saveHookSync(db, {
      connector: "github",
      repo,
      url: ingestUrl,
      lastError: "",
      lastAttemptAt: nowMs,
    });
  } catch (failure) {
    saveHookSync(db, {
      connector: "github",
      repo,
      url: stored.url,
      lastError: catchHookMessage(failure),
      lastAttemptAt: nowMs,
    });
  }
}

export async function syncGithubInboundHooks(input: {
  db: Database.Database;
  watches: readonly { repo: string }[];
  token: string;
  ingestUrl: string;
  nowMs: number;
  tunnelLive: boolean;
  http?: GithubHookHttp;
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
  const http = input.http !== undefined ? input.http : defaultGithubHookHttp;
  const repos = uniqueGithubRepos(input.watches);
  for (const repo of repos) {
    await syncGithubRepoHook(input.db, repo, input.token, input.ingestUrl, input.nowMs, http);
  }
}
