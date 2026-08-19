import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { githubReposFromRemoteListing } from "./github-pulls.js";

const execFileAsync = promisify(execFile);

export async function listGithubReposAt(repoPath: string): Promise<string[]> {
  if (repoPath.length === 0) {
    return [];
  }
  if (!existsSync(repoPath)) {
    return [];
  }
  try {
    const result = await execFileAsync("git", ["remote", "-v"], {
      cwd: repoPath,
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    return githubReposFromRemoteListing(result.stdout);
  } catch {
    return [];
  }
}
