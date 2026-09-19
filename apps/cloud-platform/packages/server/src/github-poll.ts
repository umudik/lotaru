import type Database from "better-sqlite3";
import { requireConnectorEvent } from "./connector-catalog.js";
import {
  classifyIssueChange,
  classifyPullChange,
  mapGithubNotificationType,
  parseGithubIssues,
  parseGithubNotifications,
  parseGithubPulls,
  splitGithubRepo,
  type IssueSnapshot,
  type NotificationSnapshot,
  type PullSnapshot,
} from "./github-pulls.js";
import {
  isGithubRepoPrimed,
  loadGithubToken,
  loadPullSeen,
  markGithubRepoPrimed,
  savePullSeen,
} from "./github-store.js";
import {
  cutoffMsFrom,
  drainCursorForPage,
  drainPageFromCursor,
  fetchUntilCutoff,
  nextPollDelayMs,
  nextPollWatermark,
  parseIsoMs,
  POLL_MAX_PAGES,
  POLL_MAX_WALK_PAGES,
  POLL_OVERLAP_MS,
  POLL_PAGE_SIZE,
  type PollWalkLimits,
} from "./poll-walk.js";
import { pollConnectedAdapters } from "./poll-adapters.js";
import { loadConnectionSecret, ensureConnectionSchema } from "./connection-store.js";
import {
  loadPollCursor,
  listPollCursors,
  pollFingerprintSeen,
  rememberPollFingerprint,
  savePollCursor,
  ensurePollSchema,
  hookTokenFor,
} from "./poll-store.js";
import { ingestHookUrl, pollDelayWithHookWait, syncGithubInboundHooks } from "./github-hooks.js";
import { syncLinearInboundHook, syncStripeInboundHook } from "./inbound-hooks.js";
import { ingestAlarmFrom, ingestAlarmLogEvents, type IngestAlarmKind } from "./ingest-alarm.js";
import { EVENT_INGEST_ALARM } from "./events.js";

export type GithubPollEmit = (event: {
  type: string;
  projectId: string;
  path: string;
  detail: string;
}) => void;

export type GithubWatch = {
  repo: string;
  projectId: string;
};

export type GithubHttpGet = (
  url: string,
  token: string,
) => Promise<{ ok: boolean; status: number; body: unknown }>;

const GITHUB_NOTIFY_PAGE_SIZE = 50;

export async function defaultGithubHttpGet(url: string, token: string): Promise<{
  ok: boolean;
  status: number;
  body: unknown;
}> {
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "Lotaru",
    },
  });
  let body: unknown = [];
  try {
    body = await res.json();
  } catch {
    body = [];
  }
  return { ok: res.ok, status: res.status, body };
}

export function mergeGithubWatches(discovered: readonly GithubWatch[]): GithubWatch[] {
  const watches: GithubWatch[] = [];
  const seen = new Set<string>();
  for (const watch of discovered) {
    const repo = watch.repo.trim();
    const projectId = watch.projectId.trim();
    if (repo.length === 0 || projectId.length === 0) {
      continue;
    }
    const key = `${projectId}:${repo}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    watches.push({ repo, projectId });
  }
  return watches;
}

function emitTyped(
  emit: GithubPollEmit,
  connector: string,
  type: string,
  projectId: string,
  path: string,
  detail: string,
): void {
  if (type.length === 0) {
    return;
  }
  requireConnectorEvent(connector, type);
  emit({ type, projectId, path, detail });
}

async function pollPullsForWatch(
  db: Database.Database,
  token: string,
  watch: GithubWatch,
  emit: GithubPollEmit,
  httpGet: GithubHttpGet,
  cutoffMs: number,
  primed: boolean,
  limits: PollWalkLimits,
): Promise<{ error: string; lagged: boolean; nextPage: number }> {
  const split = splitGithubRepo(watch.repo);
  if (split.owner.length === 0) {
    return { error: "", lagged: false, nextPage: 1 };
  }
  const repoCursor = loadPollCursor(db, "github", `${watch.repo}:pulls`);
  const startPage = repoCursor.lagged ? drainPageFromCursor(repoCursor.cursor) : 1;
  const walked = await fetchUntilCutoff({
    fetchPage: async (page) => {
      const url = `https://api.github.com/repos/${split.owner}/${split.name}/pulls?state=all&sort=updated&direction=desc&per_page=${String(limits.pageSize)}&page=${String(page)}`;
      const res = await httpGet(url, token);
      if (res.ok !== true) {
        throw new Error(`GitHub pulls ${String(res.status)}`);
      }
      return parseGithubPulls(res.body);
    },
    updatedMs: (pull: PullSnapshot) => parseIsoMs(pull.updatedAt),
    cutoffMs,
    maxPages: limits.maxPages,
    pageSize: limits.pageSize,
    maxWalkPages: limits.maxWalkPages,
    startPage,
    takeItem: (pull: PullSnapshot) => {
      const seen = loadPullSeen(db, watch.repo, pull.number);
      if (seen === false) {
        return true;
      }
      return seen.updatedAt !== pull.updatedAt;
    },
  });
  for (const pull of walked.items) {
    const seen = loadPullSeen(db, watch.repo, pull.number);
    let previous: PullSnapshot | false = false;
    if (seen !== false) {
      previous = {
        number: pull.number,
        updatedAt: seen.updatedAt,
        mergedAt: seen.mergedAt,
        state: seen.state,
        title: pull.title,
      };
    }
    const kind = classifyPullChange(previous, pull, primed);
    savePullSeen(db, watch.repo, pull.number, pull.updatedAt, pull.mergedAt, pull.state);
    if (kind.length === 0) {
      continue;
    }
    emitTyped(emit, "github", kind, watch.projectId, watch.repo, String(pull.number));
  }
  savePollCursor(db, {
    connector: "github",
    scope: `${watch.repo}:pulls`,
    cursor: drainCursorForPage(walked.nextPage),
    primed: true,
    lastSuccessAt: 0,
    lastError: "",
    lagged: walked.lagged,
  });
  return { error: "", lagged: walked.lagged, nextPage: walked.nextPage };
}

async function pollIssuesForWatch(
  db: Database.Database,
  token: string,
  watch: GithubWatch,
  emit: GithubPollEmit,
  httpGet: GithubHttpGet,
  cutoffMs: number,
  primed: boolean,
  limits: PollWalkLimits,
): Promise<{ error: string; lagged: boolean }> {
  const split = splitGithubRepo(watch.repo);
  if (split.owner.length === 0) {
    return { error: "", lagged: false };
  }
  const repoCursor = loadPollCursor(db, "github", `${watch.repo}:issues`);
  const startPage = repoCursor.lagged ? drainPageFromCursor(repoCursor.cursor) : 1;
  const walked = await fetchUntilCutoff({
    fetchPage: async (page) => {
      const url = `https://api.github.com/repos/${split.owner}/${split.name}/issues?state=all&sort=updated&direction=desc&per_page=${String(limits.pageSize)}&page=${String(page)}`;
      const res = await httpGet(url, token);
      if (res.ok !== true) {
        throw new Error(`GitHub issues ${String(res.status)}`);
      }
      return parseGithubIssues(res.body);
    },
    updatedMs: (issue: IssueSnapshot) => parseIsoMs(issue.updatedAt),
    cutoffMs,
    maxPages: limits.maxPages,
    pageSize: limits.pageSize,
    maxWalkPages: limits.maxWalkPages,
    startPage,
    takeItem: (issue: IssueSnapshot) => {
      const fingerprint = `issue:${String(issue.number)}:${issue.updatedAt}`;
      return pollFingerprintSeen(db, "github", watch.repo, fingerprint) !== true;
    },
  });
  for (const issue of walked.items) {
    const fingerprint = `issue:${String(issue.number)}:${issue.updatedAt}`;
    const numberKey = `issue:${String(issue.number)}`;
    const seenExact = pollFingerprintSeen(db, "github", watch.repo, fingerprint);
    const alreadyKnown = pollFingerprintSeen(db, "github", watch.repo, numberKey);
    rememberPollFingerprint(db, "github", watch.repo, numberKey);
    rememberPollFingerprint(db, "github", watch.repo, fingerprint);
    if (seenExact) {
      continue;
    }
    const kind = classifyIssueChange(alreadyKnown, primed);
    if (kind.length === 0) {
      continue;
    }
    emitTyped(emit, "github", kind, watch.projectId, watch.repo, String(issue.number));
  }
  savePollCursor(db, {
    connector: "github",
    scope: `${watch.repo}:issues`,
    cursor: drainCursorForPage(walked.nextPage),
    primed: true,
    lastSuccessAt: 0,
    lastError: "",
    lagged: walked.lagged,
  });
  return { error: "", lagged: walked.lagged };
}

function projectIdForRepo(watches: readonly GithubWatch[], repo: string): string {
  for (const watch of watches) {
    if (watch.repo === repo) {
      return watch.projectId;
    }
  }
  return "";
}

async function pollNotifications(
  db: Database.Database,
  token: string,
  watches: readonly GithubWatch[],
  emit: GithubPollEmit,
  httpGet: GithubHttpGet,
  cutoffMs: number,
  primed: boolean,
  limits: PollWalkLimits,
): Promise<{ error: string; lagged: boolean }> {
  if (watches.length === 0) {
    return { error: "", lagged: false };
  }
  const noteCursor = loadPollCursor(db, "github", "notifications");
  const startPage = noteCursor.lagged ? drainPageFromCursor(noteCursor.cursor) : 1;
  const since = new Date(cutoffMs).toISOString();
  const walked = await fetchUntilCutoff({
    fetchPage: async (page) => {
      const url = `https://api.github.com/notifications?all=true&per_page=${String(GITHUB_NOTIFY_PAGE_SIZE)}&page=${String(page)}&since=${encodeURIComponent(since)}`;
      const res = await httpGet(url, token);
      if (res.ok !== true) {
        throw new Error(`GitHub notifications ${String(res.status)}`);
      }
      return parseGithubNotifications(res.body);
    },
    updatedMs: (note: NotificationSnapshot) => parseIsoMs(note.updatedAt),
    cutoffMs,
    maxPages: limits.maxPages,
    pageSize: GITHUB_NOTIFY_PAGE_SIZE,
    maxWalkPages: limits.maxWalkPages,
    startPage,
    takeItem: (note: NotificationSnapshot) => {
      const fingerprint = `note:${note.id}`;
      return pollFingerprintSeen(db, "github", "notifications", fingerprint) !== true;
    },
  });
  for (const note of walked.items) {
    const projectId = projectIdForRepo(watches, note.repo);
    if (projectId.length === 0) {
      continue;
    }
    const fingerprint = `note:${note.id}`;
    if (pollFingerprintSeen(db, "github", "notifications", fingerprint)) {
      continue;
    }
    rememberPollFingerprint(db, "github", "notifications", fingerprint);
    if (primed !== true) {
      continue;
    }
    const type = mapGithubNotificationType(note.subjectType);
    if (type.length === 0) {
      continue;
    }
    emitTyped(emit, "github", type, projectId, note.repo, note.title);
  }
  savePollCursor(db, {
    connector: "github",
    scope: "notifications",
    cursor: drainCursorForPage(walked.nextPage),
    primed: true,
    lastSuccessAt: 0,
    lastError: "",
    lagged: walked.lagged,
  });
  return { error: "", lagged: walked.lagged };
}

export async function pollGithubOnce(
  db: Database.Database,
  watches: readonly GithubWatch[],
  emit: GithubPollEmit,
  options: {
    httpGet?: GithubHttpGet;
    nowMs?: number;
    maxPages?: number;
    pageSize?: number;
    maxWalkPages?: number;
    token?: string;
  } = {},
): Promise<void> {
  let token = loadGithubToken(db);
  if (options.token !== undefined && options.token.length > 0) {
    token = options.token;
  }
  if (token.length === 0) {
    return;
  }
  const httpGet = options.httpGet !== undefined ? options.httpGet : defaultGithubHttpGet;
  const nowMs = options.nowMs !== undefined ? options.nowMs : Date.now();
  const limits: PollWalkLimits = {
    maxPages: options.maxPages !== undefined ? options.maxPages : POLL_MAX_PAGES,
    pageSize: options.pageSize !== undefined ? options.pageSize : POLL_PAGE_SIZE,
    maxWalkPages: options.maxWalkPages !== undefined ? options.maxWalkPages : POLL_MAX_WALK_PAGES,
  };
  const cursor = loadPollCursor(db, "github", "account");
  const primed = cursor.primed;
  const cutoffMs = cutoffMsFrom(cursor.lastSuccessAt, nowMs, POLL_OVERLAP_MS);
  let lagged = false;
  let lastError = "";
  try {
    const notes = await pollNotifications(db, token, watches, emit, httpGet, cutoffMs, primed, limits);
    if (notes.lagged) {
      lagged = true;
    }
  } catch (err) {
    lastError = "GitHub notifications poll failed";
    if (err instanceof Error && err.message.length > 0) {
      lastError = err.message;
    }
  }
  for (const watch of watches) {
    const repoPrimed = isGithubRepoPrimed(db, watch.repo);
    try {
      const pulls = await pollPullsForWatch(db, token, watch, emit, httpGet, cutoffMs, repoPrimed, limits);
      if (pulls.lagged) {
        lagged = true;
      }
      const issues = await pollIssuesForWatch(db, token, watch, emit, httpGet, cutoffMs, repoPrimed, limits);
      if (issues.lagged) {
        lagged = true;
      }
      markGithubRepoPrimed(db, watch.repo);
    } catch (err) {
      lastError = "GitHub poll failed";
      if (err instanceof Error && err.message.length > 0) {
        lastError = err.message;
      }
    }
  }
  savePollCursor(db, {
    connector: "github",
    scope: "account",
    cursor: new Date(nowMs).toISOString(),
    primed: true,
    lastSuccessAt: nextPollWatermark({
      lastSuccessAt: cursor.lastSuccessAt,
      nowMs,
      error: lastError,
      lagged,
    }),
    lastError,
    lagged: lastError.length === 0 ? lagged : cursor.lagged,
  });
}

let pollTick: (() => void) | false = false;

export function requestGithubPoll(): void {
  const tick = pollTick;
  if (tick === false) {
    return;
  }
  try {
    tick();
  } catch {
    return;
  }
}

function projectIdsForPoll(watches: readonly GithubWatch[], loadProjectIds: () => string[]): string[] {
  const loaded = loadProjectIds();
  if (loaded.length > 0) {
    return loaded.slice();
  }
  const fromWatches: string[] = [];
  for (const watch of watches) {
    if (fromWatches.includes(watch.projectId) !== true) {
      fromWatches.push(watch.projectId);
    }
  }
  return fromWatches;
}

function emitIngestAlarmChange(
  emit: GithubPollEmit,
  previousKind: IngestAlarmKind,
  polls: readonly { connector: string; lastError: string; lagged: boolean }[],
  tunnel: { enabled: boolean; state: string },
  projectIds: readonly string[],
): IngestAlarmKind {
  const alarm = ingestAlarmFrom({
    polls,
    tunnelEnabled: tunnel.enabled,
    tunnelState: tunnel.state,
  });
  const rows = ingestAlarmLogEvents(previousKind, alarm, projectIds);
  for (const row of rows) {
    emit({
      type: EVENT_INGEST_ALARM,
      projectId: row.projectId,
      path: row.path,
      detail: row.detail,
    });
  }
  return alarm.kind;
}

export function startGithubPoller(
  db: Database.Database,
  loadWatches: () => Promise<GithubWatch[]>,
  emit: GithubPollEmit,
  loadProjectIds: () => string[] = () => [],
  loadTunnel: () => { enabled: boolean; state: string; publicUrl: string } = () => {
    return { enabled: false, state: "off", publicUrl: "" };
  },
  resolveGithubToken: () => string = () => loadGithubToken(db),
): () => void {
  ensurePollSchema(db);
  ensureConnectionSchema(db);
  let timer: ReturnType<typeof setTimeout> | false = false;
  let inFlight = false;
  let queued = false;
  let lastAlarmKind: IngestAlarmKind = "ok";
  let waitForTunnelHook = false;
  const arm = (ms: number): void => {
    if (timer !== false) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = false;
      run();
    }, ms);
  };
  const run = (): void => {
    if (pollTick === false) {
      return;
    }
    if (inFlight === true) {
      queued = true;
      return;
    }
    inFlight = true;
    void loadWatches()
      .then(async (watches) => {
        const githubToken = resolveGithubToken();
        await pollGithubOnce(db, watches, emit, { token: githubToken });
        const projectIds = projectIdsForPoll(watches, loadProjectIds);
        await pollConnectedAdapters(db, projectIds, emit);
        const tunnel = loadTunnel();
        const linearToken = loadConnectionSecret(db, "linear");
        const stripeToken = loadConnectionSecret(db, "stripe");
        const tunnelLive = tunnel.state === "up" && tunnel.publicUrl.length > 0;
        const needsHook =
          githubToken.length > 0 || linearToken.length > 0 || stripeToken.length > 0;
        waitForTunnelHook = needsHook === true && tunnelLive !== true;
        const nowMs = Date.now();
        if (githubToken.length > 0 && tunnelLive === true) {
          await syncGithubInboundHooks({
            db,
            watches,
            token: githubToken,
            ingestUrl: ingestHookUrl(tunnel.publicUrl, hookTokenFor(db, "github")),
            nowMs,
            tunnelLive: true,
          });
        }
        if (linearToken.length > 0 && tunnelLive === true) {
          await syncLinearInboundHook({
            db,
            token: linearToken,
            ingestUrl: ingestHookUrl(tunnel.publicUrl, hookTokenFor(db, "linear")),
            nowMs,
            tunnelLive: true,
          });
        }
        if (stripeToken.length > 0 && tunnelLive === true) {
          await syncStripeInboundHook({
            db,
            token: stripeToken,
            ingestUrl: ingestHookUrl(tunnel.publicUrl, hookTokenFor(db, "stripe")),
            nowMs,
            tunnelLive: true,
          });
        }
        const polls = listPollCursors(db);
        lastAlarmKind = emitIngestAlarmChange(emit, lastAlarmKind, polls, tunnel, projectIds);
      })
      .catch(() => {
        return;
      })
      .finally(() => {
        inFlight = false;
        if (pollTick === false) {
          return;
        }
        if (queued === true) {
          queued = false;
          run();
          return;
        }
        arm(pollDelayWithHookWait(nextPollDelayMs(listPollCursors(db)), waitForTunnelHook));
      });
  };
  pollTick = run;
  run();
  return () => {
    pollTick = false;
    if (timer !== false) {
      clearTimeout(timer);
    }
    timer = false;
  };
}
