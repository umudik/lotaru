import type Database from "better-sqlite3";
import { classifyPullChange, parseGithubPulls, splitGithubRepo, type PullSnapshot } from "./github-pulls.js";
import {
  isGithubRepoPrimed,
  listEnabledGithubRepos,
  loadGithubToken,
  loadPullSeen,
  markGithubRepoPrimed,
  savePullSeen,
} from "./reaction-store.js";

export type GithubPollEmit = (event: {
  type: string;
  projectId: string;
  path: string;
  detail: string;
}) => void;

async function fetchRepoPulls(token: string, owner: string, name: string): Promise<PullSnapshot[]> {
  const url = `https://api.github.com/repos/${owner}/${name}/pulls?state=all&sort=updated&direction=desc&per_page=30`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2026-03-10",
      "user-agent": "Lotaru",
    },
  });
  if (!res.ok) {
    return [];
  }
  const body: unknown = await res.json();
  return parseGithubPulls(body);
}

export async function pollGithubOnce(
  db: Database.Database,
  projectIdForRepo: (repo: string) => string,
  emit: GithubPollEmit,
): Promise<void> {
  const token = loadGithubToken(db);
  if (token.length === 0) {
    return;
  }
  const repos = listEnabledGithubRepos(db);
  for (const repo of repos) {
    const split = splitGithubRepo(repo);
    if (split.owner.length === 0) {
      continue;
    }
    const projectId = projectIdForRepo(repo);
    if (projectId.length === 0) {
      continue;
    }
    const pulls = await fetchRepoPulls(token, split.owner, split.name);
    const primed = isGithubRepoPrimed(db, repo);
    for (const pull of pulls) {
      const seen = loadPullSeen(db, repo, pull.number);
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
      savePullSeen(db, repo, pull.number, pull.updatedAt, pull.mergedAt, pull.state);
      if (kind.length === 0) {
        continue;
      }
      emit({
        type: kind,
        projectId,
        path: repo,
        detail: String(pull.number),
      });
    }
    markGithubRepoPrimed(db, repo);
  }
}

export function startGithubPoller(
  db: Database.Database,
  projectIdForRepo: (repo: string) => string,
  emit: GithubPollEmit,
): void {
  const tick = (): void => {
    void pollGithubOnce(db, projectIdForRepo, emit);
  };
  tick();
  setInterval(tick, 30_000);
}
