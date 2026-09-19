import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import {
  gitRemotesFromListing,
  githubReposFromRemoteListing,
} from "./github-pulls.js";
import type { GitProvider } from "./git-repo-store.js";

const execFileAsync = promisify(execFile);

export type DetectedGitCheckout = {
  provider: GitProvider;
  owner: string;
  repo: string;
  branch: string;
};

async function gitText(repoPath: string, args: readonly string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", args.slice(), {
      cwd: repoPath,
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    return result.stdout.trim();
  } catch {
    return "";
  }
}

export async function listGithubReposAt(repoPath: string): Promise<string[]> {
  if (repoPath.length === 0) {
    return [];
  }
  if (!existsSync(repoPath)) {
    return [];
  }
  const stdout = await gitText(repoPath, ["remote", "-v"]);
  if (stdout.length === 0) {
    return [];
  }
  return githubReposFromRemoteListing(stdout);
}

export async function detectGitCheckout(repoPath: string): Promise<DetectedGitCheckout[]> {
  if (repoPath.length === 0) {
    return [];
  }
  if (existsSync(repoPath) !== true) {
    return [];
  }
  const inside = await gitText(repoPath, ["rev-parse", "--is-inside-work-tree"]);
  if (inside !== "true") {
    return [];
  }
  const listing = await gitText(repoPath, ["remote", "-v"]);
  const remotes = gitRemotesFromListing(listing);
  const remote = remotes[0];
  if (remote === undefined) {
    return [];
  }
  let branch = "main";
  const head = await gitText(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (head.length > 0 && head !== "HEAD") {
    branch = head;
  }
  return [
    {
      provider: remote.provider,
      owner: remote.owner,
      repo: remote.repo,
      branch,
    },
  ];
}
