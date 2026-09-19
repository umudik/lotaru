import { join } from "node:path";
import type Database from "better-sqlite3";
import { z } from "zod";
import { cachedSqlite } from "./sqlite-cache.js";

export const GIT_PROVIDER_VALUES = ["github", "gitlab", "azuredevops", "bitbucket"] as const;

export const gitProviderSchema = z.enum(GIT_PROVIDER_VALUES);

export type GitProvider = (typeof GIT_PROVIDER_VALUES)[number];

export type ProjectGitLink = {
  projectId: string;
  ownerId: string;
  provider: GitProvider;
  owner: string;
  repo: string;
  branch: string;
  linkedAt: number;
};

type GitLinkRow = {
  project_id: string;
  owner_id: string;
  provider: string;
  github_owner: string;
  github_repo: string;
  default_branch: string;
  linked_at: number;
};

function columnExists(database: Database.Database, table: string, column: string): boolean {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  for (const row of rows) {
    if (row.name === column) {
      return true;
    }
  }
  return false;
}

function migrateGitRepoSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS project_repos (
      project_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      github_owner TEXT NOT NULL,
      github_repo TEXT NOT NULL,
      default_branch TEXT NOT NULL,
      linked_at INTEGER NOT NULL
    );
  `);
  if (columnExists(database, "project_repos", "provider") !== true) {
    database.exec(`ALTER TABLE project_repos ADD COLUMN provider TEXT NOT NULL DEFAULT 'github'`);
  }
  try {
    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS project_repos_provider_repo
      ON project_repos (provider, github_owner, github_repo);
    `);
  } catch {
  }
}

export function gitDatabasePath(dataDir: string): string {
  return join(dataDir, "git.db");
}

export function openGitRepoDb(dataDir: string): Database.Database {
  return cachedSqlite("git-repos", gitDatabasePath(dataDir), migrateGitRepoSchema);
}

function rowToLink(row: GitLinkRow): ProjectGitLink | null {
  const parsed = gitProviderSchema.safeParse(row.provider);
  if (parsed.success !== true) {
    return null;
  }
  return {
    projectId: row.project_id,
    ownerId: row.owner_id,
    provider: parsed.data,
    owner: row.github_owner,
    repo: row.github_repo,
    branch: row.default_branch,
    linkedAt: row.linked_at,
  };
}

export function listProjectGitLinks(dataDir: string): ProjectGitLink[] {
  const database = openGitRepoDb(dataDir);
  const rows = database.prepare(`SELECT * FROM project_repos`).all() as GitLinkRow[];
  const links: ProjectGitLink[] = [];
  for (const row of rows) {
    const link = rowToLink(row);
    if (link === null) {
      continue;
    }
    links.push(link);
  }
  return links;
}

export function getProjectGitLink(dataDir: string, projectId: string): ProjectGitLink | null {
  const database = openGitRepoDb(dataDir);
  const row = database.prepare(`SELECT * FROM project_repos WHERE project_id = ?`).get(projectId) as
    | GitLinkRow
    | undefined;
  if (row === undefined) {
    return null;
  }
  return rowToLink(row);
}

export function findProjectGitLink(
  dataDir: string,
  provider: GitProvider,
  owner: string,
  repo: string,
): ProjectGitLink | null {
  const database = openGitRepoDb(dataDir);
  const row = database
    .prepare(
      `SELECT * FROM project_repos WHERE provider = ? AND github_owner = ? AND github_repo = ?`,
    )
    .get(provider, owner, repo) as GitLinkRow | undefined;
  if (row === undefined) {
    return null;
  }
  return rowToLink(row);
}

export function insertProjectGitLink(dataDir: string, link: ProjectGitLink): boolean {
  const database = openGitRepoDb(dataDir);
  try {
    database
      .prepare(
        `INSERT INTO project_repos (
          project_id, owner_id, provider, github_owner, github_repo, default_branch, linked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        link.projectId,
        link.ownerId,
        link.provider,
        link.owner,
        link.repo,
        link.branch,
        link.linkedAt,
      );
    return true;
  } catch {
    return false;
  }
}

export function githubWatchesFromLinks(
  links: readonly ProjectGitLink[],
): { repo: string; projectId: string }[] {
  const watches: { repo: string; projectId: string }[] = [];
  for (const link of links) {
    if (link.provider !== "github") {
      continue;
    }
    watches.push({
      repo: `${link.owner}/${link.repo}`,
      projectId: link.projectId,
    });
  }
  return watches;
}
