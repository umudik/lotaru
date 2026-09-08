import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { ConnectorKind } from "./connector-catalog.js";

const cursorRowSchema = z.object({
  connector: z.string(),
  scope: z.string(),
  cursor: z.string(),
  primed: z.number().int(),
  last_success_at: z.number().int(),
  last_error: z.string(),
  lagged: z.number().int(),
});

const seenRowSchema = z.object({ fingerprint: z.string() });
const hookRowSchema = z.object({ connector_id: z.string(), token: z.string() });
const hookSyncRowSchema = z.object({
  connector: z.string(),
  repo: z.string(),
  url: z.string(),
  last_error: z.string(),
  last_attempt_at: z.number().int(),
});

export type PollCursor = {
  connector: string;
  scope: string;
  cursor: string;
  primed: boolean;
  lastSuccessAt: number;
  lastError: string;
  lagged: boolean;
};

export type HookSyncRow = {
  connector: string;
  repo: string;
  url: string;
  lastError: string;
  lastAttemptAt: number;
};

export function ensurePollSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lotaru_poll_cursor (
      connector TEXT NOT NULL,
      scope TEXT NOT NULL,
      cursor TEXT NOT NULL,
      primed INTEGER NOT NULL,
      last_success_at INTEGER NOT NULL,
      last_error TEXT NOT NULL,
      lagged INTEGER NOT NULL,
      PRIMARY KEY (connector, scope)
    );
    CREATE TABLE IF NOT EXISTS lotaru_poll_seen (
      connector TEXT NOT NULL,
      scope TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      PRIMARY KEY (connector, scope, fingerprint)
    );
    CREATE TABLE IF NOT EXISTS lotaru_hook_token (
      connector_id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS lotaru_hook_sync (
      connector TEXT NOT NULL,
      repo TEXT NOT NULL,
      url TEXT NOT NULL,
      last_error TEXT NOT NULL,
      last_attempt_at INTEGER NOT NULL,
      PRIMARY KEY (connector, repo)
    );
  `);
}

export function loadPollCursor(db: Database.Database, connector: string, scope: string): PollCursor {
  ensurePollSchema(db);
  const parsed = cursorRowSchema.safeParse(
    db
      .prepare(
        "SELECT connector, scope, cursor, primed, last_success_at, last_error, lagged FROM lotaru_poll_cursor WHERE connector = ? AND scope = ?",
      )
      .get(connector, scope),
  );
  if (parsed.success !== true) {
    return {
      connector,
      scope,
      cursor: "",
      primed: false,
      lastSuccessAt: 0,
      lastError: "",
      lagged: false,
    };
  }
  return {
    connector: parsed.data.connector,
    scope: parsed.data.scope,
    cursor: parsed.data.cursor,
    primed: parsed.data.primed === 1,
    lastSuccessAt: parsed.data.last_success_at,
    lastError: parsed.data.last_error,
    lagged: parsed.data.lagged === 1,
  };
}

export function savePollCursor(db: Database.Database, row: PollCursor): void {
  ensurePollSchema(db);
  db.prepare(
    "INSERT INTO lotaru_poll_cursor (connector, scope, cursor, primed, last_success_at, last_error, lagged) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(connector, scope) DO UPDATE SET cursor = excluded.cursor, primed = excluded.primed, last_success_at = excluded.last_success_at, last_error = excluded.last_error, lagged = excluded.lagged",
  ).run(
    row.connector,
    row.scope,
    row.cursor,
    row.primed ? 1 : 0,
    row.lastSuccessAt,
    row.lastError,
    row.lagged ? 1 : 0,
  );
}

export function pollFingerprintSeen(db: Database.Database, connector: string, scope: string, fingerprint: string): boolean {
  ensurePollSchema(db);
  const parsed = seenRowSchema.safeParse(
    db
      .prepare(
        "SELECT fingerprint FROM lotaru_poll_seen WHERE connector = ? AND scope = ? AND fingerprint = ?",
      )
      .get(connector, scope, fingerprint),
  );
  return parsed.success === true;
}

export function rememberPollFingerprint(
  db: Database.Database,
  connector: string,
  scope: string,
  fingerprint: string,
): void {
  ensurePollSchema(db);
  db.prepare(
    "INSERT OR IGNORE INTO lotaru_poll_seen (connector, scope, fingerprint) VALUES (?, ?, ?)",
  ).run(connector, scope, fingerprint);
}

export function listPollCursors(db: Database.Database): PollCursor[] {
  ensurePollSchema(db);
  const rows = db
    .prepare(
      "SELECT connector, scope, cursor, primed, last_success_at, last_error, lagged FROM lotaru_poll_cursor",
    )
    .all();
  const listed: PollCursor[] = [];
  if (Array.isArray(rows) !== true) {
    return listed;
  }
  for (const row of rows) {
    const parsed = cursorRowSchema.safeParse(row);
    if (parsed.success !== true) {
      continue;
    }
    listed.push({
      connector: parsed.data.connector,
      scope: parsed.data.scope,
      cursor: parsed.data.cursor,
      primed: parsed.data.primed === 1,
      lastSuccessAt: parsed.data.last_success_at,
      lastError: parsed.data.last_error,
      lagged: parsed.data.lagged === 1,
    });
  }
  return listed;
}

export function hookTokenFor(db: Database.Database, connectorId: ConnectorKind): string {
  ensurePollSchema(db);
  const existing = hookRowSchema.safeParse(
    db.prepare("SELECT connector_id, token FROM lotaru_hook_token WHERE connector_id = ?").get(connectorId),
  );
  if (existing.success === true) {
    return existing.data.token;
  }
  const token = nanoid(24);
  db.prepare("INSERT INTO lotaru_hook_token (connector_id, token) VALUES (?, ?)").run(connectorId, token);
  return token;
}

export function connectorIdForHookToken(db: Database.Database, token: string): string {
  ensurePollSchema(db);
  const parsed = hookRowSchema.safeParse(
    db.prepare("SELECT connector_id, token FROM lotaru_hook_token WHERE token = ?").get(token),
  );
  if (parsed.success !== true) {
    return "";
  }
  return parsed.data.connector_id;
}

export function loadHookSync(db: Database.Database, connector: string, repo: string): HookSyncRow {
  ensurePollSchema(db);
  const parsed = hookSyncRowSchema.safeParse(
    db
      .prepare(
        "SELECT connector, repo, url, last_error, last_attempt_at FROM lotaru_hook_sync WHERE connector = ? AND repo = ?",
      )
      .get(connector, repo),
  );
  if (parsed.success !== true) {
    return {
      connector,
      repo,
      url: "",
      lastError: "",
      lastAttemptAt: 0,
    };
  }
  return {
    connector: parsed.data.connector,
    repo: parsed.data.repo,
    url: parsed.data.url,
    lastError: parsed.data.last_error,
    lastAttemptAt: parsed.data.last_attempt_at,
  };
}

export function saveHookSync(db: Database.Database, row: HookSyncRow): void {
  ensurePollSchema(db);
  db.prepare(
    "INSERT INTO lotaru_hook_sync (connector, repo, url, last_error, last_attempt_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(connector, repo) DO UPDATE SET url = excluded.url, last_error = excluded.last_error, last_attempt_at = excluded.last_attempt_at",
  ).run(row.connector, row.repo, row.url, row.lastError, row.lastAttemptAt);
}

export function listHookSync(db: Database.Database): HookSyncRow[] {
  ensurePollSchema(db);
  const rows = db.prepare("SELECT connector, repo, url, last_error, last_attempt_at FROM lotaru_hook_sync").all();
  const listed: HookSyncRow[] = [];
  if (Array.isArray(rows) !== true) {
    return listed;
  }
  for (const row of rows) {
    const parsed = hookSyncRowSchema.safeParse(row);
    if (parsed.success !== true) {
      continue;
    }
    listed.push({
      connector: parsed.data.connector,
      repo: parsed.data.repo,
      url: parsed.data.url,
      lastError: parsed.data.last_error,
      lastAttemptAt: parsed.data.last_attempt_at,
    });
  }
  return listed;
}

export function listHookTokens(db: Database.Database): { connectorId: string; token: string }[] {
  ensurePollSchema(db);
  const rows = db.prepare("SELECT connector_id, token FROM lotaru_hook_token").all();
  const listed: { connectorId: string; token: string }[] = [];
  if (Array.isArray(rows) !== true) {
    return listed;
  }
  for (const row of rows) {
    const parsed = hookRowSchema.safeParse(row);
    if (parsed.success !== true) {
      continue;
    }
    listed.push({ connectorId: parsed.data.connector_id, token: parsed.data.token });
  }
  return listed;
}
