import { z } from "zod";
import {
  EVENT_GITHUB_PR_MERGED,
  EVENT_GITHUB_PR_OPENED,
  EVENT_GITHUB_PR_UPDATED,
} from "./events.js";
import type { GitProvider } from "./git-repo-store.js";

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

export type DetectedGitRemote = {
  provider: GitProvider;
  owner: string;
  repo: string;
};

function pathSegments(pathname: string): string[] {
  let path = stripGitSuffix(pathname.trim());
  if (path.startsWith("/")) {
    path = path.slice(1);
  }
  const segments: string[] = [];
  for (const part of path.split("/")) {
    if (part.length === 0) {
      continue;
    }
    try {
      const decoded = decodeURIComponent(part);
      if (decoded.length > 0) {
        segments.push(decoded);
      }
    } catch {
      return [];
    }
  }
  return segments;
}

function ownerRepoFromSegments(segments: readonly string[]): { owner: string; repo: string }[] {
  if (segments.length < 2) {
    return [];
  }
  const repo = segments[segments.length - 1];
  if (repo === undefined || repo.length === 0) {
    return [];
  }
  const ownerParts: string[] = [];
  for (let index = 0; index < segments.length - 1; index += 1) {
    const part = segments[index];
    if (part === undefined || part.length === 0) {
      continue;
    }
    ownerParts.push(part);
  }
  const owner = ownerParts.join("/");
  if (owner.length === 0) {
    return [];
  }
  return [{ owner, repo }];
}

function azureOwnerRepo(pathname: string): { owner: string; repo: string }[] {
  const raw = pathSegments(pathname);
  let segments = raw;
  if (raw[0] === "v3") {
    segments = raw.slice(1);
  }
  const gitAt = segments.indexOf("_git");
  if (gitAt >= 1 && gitAt + 1 < segments.length) {
    const organization = segments[0];
    const repoName = segments[gitAt + 1];
    if (organization === undefined || repoName === undefined) {
      return [];
    }
    let project = repoName;
    if (gitAt >= 2) {
      project = segments.slice(1, gitAt).join("/");
    }
    if (organization.length === 0 || project.length === 0 || repoName.length === 0) {
      return [];
    }
    return [{ owner: `${organization}/${project}`, repo: repoName }];
  }
  return ownerRepoFromSegments(segments);
}

function providerFromHost(host: string): GitProvider[] {
  const name = host.trim().toLowerCase();
  if (name === "github.com" || name === "www.github.com") {
    return ["github"];
  }
  if (name === "gitlab.com") {
    return ["gitlab"];
  }
  if (name === "bitbucket.org") {
    return ["bitbucket"];
  }
  if (name === "dev.azure.com" || name === "ssh.dev.azure.com") {
    return ["azuredevops"];
  }
  if (name.endsWith(".visualstudio.com") === true) {
    return ["azuredevops"];
  }
  return [];
}

function remoteFromHostPath(host: string, pathname: string): DetectedGitRemote[] {
  const providers = providerFromHost(host);
  const provider = providers[0];
  if (provider === undefined) {
    return [];
  }
  let parts = ownerRepoFromSegments(pathSegments(pathname));
  if (provider === "azuredevops") {
    parts = azureOwnerRepo(pathname);
  }
  const split = parts[0];
  if (split === undefined) {
    return [];
  }
  return [{ provider, owner: split.owner, repo: split.repo }];
}

export function gitRemoteFromUrl(raw: string): DetectedGitRemote[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return [];
  }
  let href = trimmed;
  if (trimmed.startsWith("git+") === true) {
    href = trimmed.slice(4);
  }
  try {
    const parsed = new URL(href);
    if (parsed.hostname.length > 0) {
      return remoteFromHostPath(parsed.hostname, parsed.pathname);
    }
  } catch {
  }
  const scp = /^([^@\s]+)@([^:\s]+):(.+)$/.exec(href);
  if (scp === null) {
    return [];
  }
  const host = scp[2];
  const pathname = scp[3];
  if (host === undefined || pathname === undefined) {
    return [];
  }
  return remoteFromHostPath(host, pathname);
}

export function githubRepoFromRemoteUrl(raw: string): string {
  const hits = gitRemoteFromUrl(raw);
  const first = hits[0];
  if (first === undefined) {
    return "";
  }
  if (first.provider !== "github") {
    return "";
  }
  return `${first.owner}/${first.repo}`;
}

export function gitRemotesFromListing(stdout: string): DetectedGitRemote[] {
  const originRemotes: DetectedGitRemote[] = [];
  const otherRemotes: DetectedGitRemote[] = [];
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
    const parsed = gitRemoteFromUrl(url);
    const remote = parsed[0];
    if (remote === undefined) {
      continue;
    }
    const key = `${remote.provider}:${remote.owner}/${remote.repo}`;
    if (seen.has(key) === true) {
      continue;
    }
    seen.add(key);
    if (name === "origin") {
      originRemotes.push(remote);
    } else {
      otherRemotes.push(remote);
    }
  }
  const ordered: DetectedGitRemote[] = [];
  for (const remote of originRemotes) {
    ordered.push(remote);
  }
  for (const remote of otherRemotes) {
    ordered.push(remote);
  }
  return ordered;
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
