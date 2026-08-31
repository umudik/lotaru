import type Database from "better-sqlite3";
import { z } from "zod";

export function ensureGithubSchema(db: Database.Database): void {
  db.exec(`
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
}

export function loadGithubToken(db: Database.Database): string {
  const tokenSchema = z.object({ token: z.string() });
  const parsed = tokenSchema.safeParse(
    db.prepare("SELECT token FROM lotaru_github WHERE id = ?").get("lotaru"),
  );
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
    db
      .prepare(
        "SELECT updated_at, merged_at, state FROM lotaru_github_seen WHERE repo = ? AND number = ?",
      )
      .get(repo, number),
  );
  if (parsed.success !== true) {
    return false;
  }
  return {
    updatedAt: parsed.data.updated_at,
    mergedAt: parsed.data.merged_at,
    state: parsed.data.state,
  };
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
