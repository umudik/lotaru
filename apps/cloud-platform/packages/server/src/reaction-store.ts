import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { z } from "zod";
import { splitGithubRepo } from "./github-pulls.js";
import {
  REACTION_CREATE_TASK,
  REACTION_EVENT_TYPES,
  type LotaruReaction,
} from "./reactions.js";

export type TaskReactionInput = {
  action: "create_task";
  eventType: string;
  repo: string;
  titleTemplate: string;
  enabled: boolean;
};

export type ReactionInput = TaskReactionInput;

const eventTypeSchema = z.string().trim().min(1);
const repoSchema = z.string().trim();
const enabledSchema = z.boolean();

const reactionInputSchema = z.object({
  action: z.literal("create_task"),
  eventType: eventTypeSchema,
  repo: repoSchema,
  titleTemplate: z.string().trim(),
  enabled: enabledSchema,
});

const reactionRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  event_type: z.string(),
  repo: z.string(),
  action: z.string(),
  title_template: z.string(),
  knowledge_item_id: z.string(),
  knowledge_outputs: z.string(),
  enabled: z.number(),
  created_at: z.number(),
});

const pragmaColumnSchema = z.object({
  name: z.string(),
});

function tableHasColumn(db: Database.Database, table: string, column: string): boolean {
  const raw = db.pragma(`table_info(${table})`);
  if (Array.isArray(raw) !== true) {
    return false;
  }
  for (const entry of raw) {
    const parsed = pragmaColumnSchema.safeParse(entry);
    if (parsed.success !== true) {
      continue;
    }
    if (parsed.data.name === column) {
      return true;
    }
  }
  return false;
}

export function ensureReactionSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lotaru_reactions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      repo TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      title_template TEXT NOT NULL DEFAULT '',
      knowledge_item_id TEXT NOT NULL DEFAULT '',
      knowledge_outputs TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lotaru_reactions_project ON lotaru_reactions(project_id);
    CREATE TABLE IF NOT EXISTS lotaru_reaction_fires (
      fingerprint TEXT PRIMARY KEY,
      reaction_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lotaru_github (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lotaru_github_seen (
      repo TEXT NOT NULL,
      number INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      merged_at TEXT NOT NULL,
      state TEXT NOT NULL,
      PRIMARY KEY (repo, number)
    );
    CREATE TABLE IF NOT EXISTS lotaru_github_primed (
      repo TEXT PRIMARY KEY
    );
  `);
  if (tableHasColumn(db, "lotaru_reactions", "knowledge_item_id") !== true) {
    db.exec("ALTER TABLE lotaru_reactions ADD COLUMN knowledge_item_id TEXT NOT NULL DEFAULT ''");
  }
  if (tableHasColumn(db, "lotaru_reactions", "knowledge_outputs") !== true) {
    db.exec("ALTER TABLE lotaru_reactions ADD COLUMN knowledge_outputs TEXT NOT NULL DEFAULT ''");
  }
}

function reactionsFromRow(row: z.infer<typeof reactionRowSchema>): LotaruReaction[] {
  if (row.action !== REACTION_CREATE_TASK) {
    return [];
  }
  return [
    {
      id: row.id,
      projectId: row.project_id,
      eventType: row.event_type,
      repo: row.repo,
      action: REACTION_CREATE_TASK,
      titleTemplate: row.title_template,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
    },
  ];
}

export function listReactions(db: Database.Database, projectId: string): LotaruReaction[] {
  const raw = db
    .prepare(
      "SELECT id, project_id, event_type, repo, action, title_template, knowledge_item_id, knowledge_outputs, enabled, created_at FROM lotaru_reactions WHERE project_id = ? ORDER BY created_at ASC",
    )
    .all(projectId);
  if (Array.isArray(raw) !== true) {
    return [];
  }
  const reactions: LotaruReaction[] = [];
  for (const entry of raw) {
    const parsed = reactionRowSchema.safeParse(entry);
    if (parsed.success !== true) {
      continue;
    }
    const mapped = reactionsFromRow(parsed.data);
    for (const reaction of mapped) {
      reactions.push(reaction);
    }
  }
  return reactions;
}

export function listEnabledGithubRepos(db: Database.Database): string[] {
  const raw = db
    .prepare(
      "SELECT DISTINCT repo FROM lotaru_reactions WHERE enabled = 1 AND event_type LIKE 'github.%' AND repo != ''",
    )
    .all();
  if (Array.isArray(raw) !== true) {
    return [];
  }
  const repos: string[] = [];
  const repoSchema = z.object({ repo: z.string() });
  for (const entry of raw) {
    const parsed = repoSchema.safeParse(entry);
    if (parsed.success !== true) {
      continue;
    }
    repos.push(parsed.data.repo);
  }
  return repos;
}

function requireKnownEventType(eventType: string): void {
  let knownType = false;
  for (const known of REACTION_EVENT_TYPES) {
    if (known === eventType) {
      knownType = true;
    }
  }
  if (knownType !== true) {
    throw new Error("Unknown event type");
  }
}

export function parseReactionInput(body: unknown): ReactionInput {
  const parsed = reactionInputSchema.safeParse(body);
  if (parsed.success !== true) {
    throw new Error("Invalid reaction");
  }
  requireKnownEventType(parsed.data.eventType);
  if (parsed.data.eventType.startsWith("github.") && parsed.data.repo.length > 0) {
    const split = splitGithubRepo(parsed.data.repo);
    if (split.owner.length === 0) {
      throw new Error("GitHub reactions need owner/repo");
    }
  }
  return {
    action: REACTION_CREATE_TASK,
    eventType: parsed.data.eventType,
    repo: parsed.data.repo,
    titleTemplate: parsed.data.titleTemplate,
    enabled: parsed.data.enabled,
  };
}

export function listEnabledReactionProjectIds(db: Database.Database, eventType: string): string[] {
  const raw = db
    .prepare("SELECT DISTINCT project_id FROM lotaru_reactions WHERE enabled = 1 AND event_type = ?")
    .all(eventType);
  if (Array.isArray(raw) !== true) {
    return [];
  }
  const projectIds: string[] = [];
  const idSchema = z.object({ project_id: z.string() });
  for (const entry of raw) {
    const parsed = idSchema.safeParse(entry);
    if (parsed.success !== true) {
      continue;
    }
    projectIds.push(parsed.data.project_id);
  }
  return projectIds;
}

export function insertReaction(db: Database.Database, projectId: string, input: ReactionInput): LotaruReaction {
  const id = nanoid(12);
  const createdAt = Date.now();
  const titleTemplate = input.titleTemplate;
  db.prepare(
    "INSERT INTO lotaru_reactions (id, project_id, event_type, repo, action, title_template, knowledge_item_id, knowledge_outputs, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    projectId,
    input.eventType,
    input.repo,
    input.action,
    titleTemplate,
    "",
    "",
    input.enabled ? 1 : 0,
    createdAt,
  );
  const stored = listReactions(db, projectId);
  for (const reaction of stored) {
    if (reaction.id === id) {
      return reaction;
    }
  }
  throw new Error("reaction missing after insert");
}

export function deleteReaction(db: Database.Database, projectId: string, reactionId: string): boolean {
  const result = db
    .prepare("DELETE FROM lotaru_reactions WHERE id = ? AND project_id = ?")
    .run(reactionId, projectId);
  return result.changes > 0;
}

export function claimReactionFire(db: Database.Database, fingerprint: string, reactionId: string): boolean {
  const fireSchema = z.object({ fingerprint: z.string() });
  const existing = fireSchema.safeParse(
    db.prepare("SELECT fingerprint FROM lotaru_reaction_fires WHERE fingerprint = ?").get(fingerprint),
  );
  if (existing.success === true) {
    return false;
  }
  db.prepare("INSERT INTO lotaru_reaction_fires (fingerprint, reaction_id, created_at) VALUES (?, ?, ?)").run(
    fingerprint,
    reactionId,
    Date.now(),
  );
  return true;
}

export function releaseReactionFire(db: Database.Database, fingerprint: string): void {
  db.prepare("DELETE FROM lotaru_reaction_fires WHERE fingerprint = ?").run(fingerprint);
}

export function loadGithubToken(db: Database.Database): string {
  const tokenSchema = z.object({ token: z.string() });
  const parsed = tokenSchema.safeParse(db.prepare("SELECT token FROM lotaru_github WHERE id = ?").get("lotaru"));
  if (parsed.success !== true) {
    return "";
  }
  return parsed.data.token;
}

export function saveGithubToken(db: Database.Database, token: string): void {
  db.prepare(
    "INSERT INTO lotaru_github (id, token) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET token = excluded.token",
  ).run("lotaru", token.trim());
}

export function loadPullSeen(
  db: Database.Database,
  repo: string,
  number: number,
): { updatedAt: string; mergedAt: string; state: string } | false {
  const seenSchema = z.object({
    updated_at: z.string(),
    merged_at: z.string(),
    state: z.string(),
  });
  const parsed = seenSchema.safeParse(
    db.prepare("SELECT updated_at, merged_at, state FROM lotaru_github_seen WHERE repo = ? AND number = ?").get(
      repo,
      number,
    ),
  );
  if (parsed.success !== true) {
    return false;
  }
  return { updatedAt: parsed.data.updated_at, mergedAt: parsed.data.merged_at, state: parsed.data.state };
}

export function savePullSeen(
  db: Database.Database,
  repo: string,
  number: number,
  updatedAt: string,
  mergedAt: string,
  state: string,
): void {
  db.prepare(
    "INSERT INTO lotaru_github_seen (repo, number, updated_at, merged_at, state) VALUES (?, ?, ?, ?, ?) ON CONFLICT(repo, number) DO UPDATE SET updated_at = excluded.updated_at, merged_at = excluded.merged_at, state = excluded.state",
  ).run(repo, number, updatedAt, mergedAt, state);
}

export function isGithubRepoPrimed(db: Database.Database, repo: string): boolean {
  const primedSchema = z.object({ repo: z.string() });
  const parsed = primedSchema.safeParse(
    db.prepare("SELECT repo FROM lotaru_github_primed WHERE repo = ?").get(repo),
  );
  return parsed.success === true;
}

export function markGithubRepoPrimed(db: Database.Database, repo: string): void {
  db.prepare("INSERT OR IGNORE INTO lotaru_github_primed (repo) VALUES (?)").run(repo);
}
