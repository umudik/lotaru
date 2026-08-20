import type Database from "better-sqlite3";
import { classifyPullChange, parseGithubPulls, splitGithubRepo, type PullSnapshot } from "./github-pulls.js";
import {
  isGithubRepoPrimed,
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

export type GithubWatch = {
  repo: string;
  projectId: string;
};

export function mergeGithubWatches(
  fromReactions: readonly GithubWatch[],
  fromRemotes: readonly GithubWatch[],
): GithubWatch[] {
  const watches: GithubWatch[] = [];
  const seen = new Set<string>();
  const groups: readonly (readonly GithubWatch[])[] = [fromReactions, fromRemotes];
  for (const group of groups) {
    for (const watch of group) {
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
  }
  return watches;
}

async function fetchRepoPulls(token: string, owner: string, name: string): Promise<PullSnapshot[]> {
  const url = `https://api.github.com/repos/${owner}/${name}/pulls?state=all&sort=updated&direction=desc&per_page=30`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
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
  watches: readonly GithubWatch[],
  emit: GithubPollEmit,
): Promise<void> {
  const token = loadGithubToken(db);
  if (token.length === 0) {
    return;
  }
  for (const watch of watches) {
    const split = splitGithubRepo(watch.repo);
    if (split.owner.length === 0) {
      continue;
    }
    const pulls = await fetchRepoPulls(token, split.owner, split.name);
    const primed = isGithubRepoPrimed(db, watch.repo);
    for (const pull of pulls) {
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
      emit({
        type: kind,
        projectId: watch.projectId,
        path: watch.repo,
        detail: String(pull.number),
      });
    }
    markGithubRepoPrimed(db, watch.repo);
  }
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

export function startGithubPoller(
  db: Database.Database,
  loadWatches: () => Promise<GithubWatch[]>,
  emit: GithubPollEmit,
): void {
  const tick = (): void => {
    void loadWatches()
      .then((watches) => pollGithubOnce(db, watches, emit))
      .catch(() => {
        return;
      });
  };
  pollTick = tick;
  tick();
  setInterval(tick, 30_000);
}
