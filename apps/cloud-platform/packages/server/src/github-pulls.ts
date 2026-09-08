import { z } from "zod";
import {
  EVENT_GITHUB_PR_MERGED,
  EVENT_GITHUB_PR_OPENED,
  EVENT_GITHUB_PR_UPDATED,
} from "./events.js";

export type PullSnapshot = {
  number: number;
  updatedAt: string;
  mergedAt: string;
  state: string;
  title: string;
};

const pullWireSchema = z.object({
  number: z.number().int().positive(),
  state: z.string(),
  updated_at: z.string().min(1),
  merged_at: z.union([z.string(), z.null()]),
  title: z.string(),
});

export function parseGithubPulls(body: unknown): PullSnapshot[] {
  const parsed = z.array(pullWireSchema).safeParse(body);
  if (!parsed.success) {
    return [];
  }
  const pulls: PullSnapshot[] = [];
  for (const row of parsed.data) {
    let mergedAt = "";
    if (row.merged_at !== null) {
      mergedAt = row.merged_at;
    }
    pulls.push({
      number: row.number,
      updatedAt: row.updated_at,
      mergedAt,
      state: row.state,
      title: row.title,
    });
  }
  return pulls;
}

export function splitGithubRepo(repo: string): { owner: string; name: string } {
  const parts = repo.split("/");
  if (parts.length !== 2) {
    return { owner: "", name: "" };
  }
  const owner = parts[0];
  const name = parts[1];
  if (owner === undefined || name === undefined) {
    return { owner: "", name: "" };
  }
  if (owner.length === 0 || name.length === 0) {
    return { owner: "", name: "" };
  }
  return { owner, name };
}

function stripGitSuffix(path: string): string {
  const trimmed = path.trim();
  if (trimmed.endsWith(".git")) {
    return trimmed.slice(0, trimmed.length - 4);
  }
  if (trimmed.endsWith("/")) {
    return trimmed.slice(0, trimmed.length - 1);
  }
  return trimmed;
}

function ownerRepoFromPath(pathname: string): string {
  let path = pathname.trim();
  if (path.startsWith("/")) {
    path = path.slice(1);
  }
  path = stripGitSuffix(path);
  if (path.endsWith("/")) {
    path = path.slice(0, path.length - 1);
  }
  const split = splitGithubRepo(path);
  if (split.owner.length === 0) {
    return "";
  }
  return `${split.owner}/${split.name}`;
}

export function githubRepoFromRemoteUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return "";
  }
  const scp = /^git@github\.com:(.+)$/.exec(trimmed);
  if (scp !== null) {
    const captured = scp[1];
    if (captured === undefined) {
      return "";
    }
    return ownerRepoFromPath(captured);
  }
  let href = trimmed;
  if (trimmed.startsWith("git+")) {
    href = trimmed.slice(4);
  }
  try {
    const parsed = new URL(href);
    if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") {
      return "";
    }
    return ownerRepoFromPath(parsed.pathname);
  } catch {
    return "";
  }
}

export function githubReposFromRemoteListing(stdout: string): string[] {
  const originRepos: string[] = [];
  const otherRepos: string[] = [];
  const seen = new Set<string>();
  const lines = stdout.split("\n");
  for (const line of lines) {
    const trimmed = line.replaceAll("\r", "").trim();
    if (trimmed.length === 0) {
      continue;
    }
    const chunks = trimmed.split(/\s+/);
    if (chunks.length < 2) {
      continue;
    }
    const name = chunks[0];
    const url = chunks[1];
    if (name === undefined || url === undefined) {
      continue;
    }
    const repo = githubRepoFromRemoteUrl(url);
    if (repo.length === 0) {
      continue;
    }
    if (seen.has(repo)) {
      continue;
    }
    seen.add(repo);
    if (name === "origin") {
      originRepos.push(repo);
    } else {
      otherRepos.push(repo);
    }
  }
  const ordered: string[] = [];
  for (const repo of originRepos) {
    ordered.push(repo);
  }
  for (const repo of otherRepos) {
    ordered.push(repo);
  }
  return ordered;
}

export type IssueSnapshot = {
  number: number;
  updatedAt: string;
  createdAt: string;
  title: string;
};

const issueWireSchema = z.object({
  number: z.number().int().positive(),
  updated_at: z.string().min(1),
  created_at: z.string().min(1),
  title: z.string(),
  pull_request: z.unknown().optional(),
});

export function parseGithubIssues(body: unknown): IssueSnapshot[] {
  const parsed = z.array(issueWireSchema).safeParse(body);
  if (parsed.success !== true) {
    return [];
  }
  const issues: IssueSnapshot[] = [];
  for (const row of parsed.data) {
    if ("pull_request" in row) {
      continue;
    }
    issues.push({
      number: row.number,
      updatedAt: row.updated_at,
      createdAt: row.created_at,
      title: row.title,
    });
  }
  return issues;
}

export type NotificationSnapshot = {
  id: string;
  updatedAt: string;
  repo: string;
  subjectType: string;
  title: string;
};

const notificationWireSchema = z.object({
  id: z.union([z.string(), z.number()]),
  updated_at: z.string().min(1),
  repository: z.object({ full_name: z.string().min(1) }),
  subject: z.object({
    type: z.string().min(1),
    title: z.string(),
  }),
});

export function parseGithubNotifications(body: unknown): NotificationSnapshot[] {
  const parsed = z.array(notificationWireSchema).safeParse(body);
  if (parsed.success !== true) {
    return [];
  }
  const notes: NotificationSnapshot[] = [];
  for (const row of parsed.data) {
    notes.push({
      id: String(row.id),
      updatedAt: row.updated_at,
      repo: row.repository.full_name,
      subjectType: row.subject.type,
      title: row.subject.title,
    });
  }
  return notes;
}

export function mapGithubNotificationType(subjectType: string): string {
  if (subjectType === "CheckSuite") {
    return "github.check_suite";
  }
  if (subjectType === "CheckRun") {
    return "github.check_run";
  }
  if (subjectType === "Release") {
    return "github.release";
  }
  if (subjectType === "RepositoryVulnerabilityAlert") {
    return "github.repository_vulnerability_alert";
  }
  if (subjectType === "RepositoryInvitation") {
    return "github.repository";
  }
  if (subjectType === "Discussion") {
    return "";
  }
  if (subjectType === "PullRequest") {
    return "";
  }
  if (subjectType === "Issue") {
    return "";
  }
  if (subjectType === "Commit") {
    return "";
  }
  return "";
}

export function classifyIssueChange(alreadyKnown: boolean, primed: boolean): string {
  if (primed !== true) {
    return "";
  }
  if (alreadyKnown) {
    return "github.issues";
  }
  return "github.issues";
}

export function classifyPullChange(previous: PullSnapshot | false, next: PullSnapshot, primed: boolean): string {
  if (previous === false) {
    if (primed !== true) {
      return "";
    }
    if (next.mergedAt.length > 0) {
      return EVENT_GITHUB_PR_MERGED;
    }
    return EVENT_GITHUB_PR_OPENED;
  }
  if (previous.mergedAt.length === 0 && next.mergedAt.length > 0) {
    return EVENT_GITHUB_PR_MERGED;
  }
  if (previous.updatedAt !== next.updatedAt) {
    return EVENT_GITHUB_PR_UPDATED;
  }
  return "";
}
