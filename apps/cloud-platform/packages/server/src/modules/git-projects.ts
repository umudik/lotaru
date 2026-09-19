import type { FastifyInstance, FastifyRequest } from "fastify";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { userCanAccessProject } from "../../../../../task-bridge/apps/backend/dist/services/project-registry.js";
import {
  getProjectGitLink,
  insertProjectGitLink,
  type GitProvider,
} from "../git-repo-store.js";
import {
  authedGitCloneUrl,
  githubUserToken,
  publicGitCloneUrl,
} from "../git-providers.js";
import type { GithubAuth } from "./github-auth.js";
import type { Identity, IdentityUser } from "./identity.js";
import { projectDir, type ProjectPathsOptions } from "./project-paths.js";

const execFileAsync = promisify(execFile);

export type GitProjectsOptions = ProjectPathsOptions & {
  identity: Identity;
  github: GithubAuth;
  dataDir: string;
  databasePath: string;
};

function repoUrl(owner: string, repo: string): string {
  return publicGitCloneUrl("github", owner, repo);
}

function authedRepoUrl(token: string, owner: string, repo: string): string {
  return authedGitCloneUrl("github", token, owner, repo);
}

async function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { cwd, maxBuffer: 1024 * 1024 * 32 });
}

export async function attachExistingGitRepo(input: {
  paths: ProjectPathsOptions;
  dataDir: string;
  github: GithubAuth;
  cloneToken: string;
  projectId: string;
  ownerId: string;
  provider: GitProvider;
  owner: string;
  repo: string;
  branch: string;
}): Promise<{ repoPath: string; error: string | null }> {
  if (getProjectGitLink(input.dataDir, input.projectId) !== null) {
    return { repoPath: "", error: "a repo is already linked to this project" };
  }
  const saved = insertProjectGitLink(input.dataDir, {
    projectId: input.projectId,
    ownerId: input.ownerId,
    provider: input.provider,
    owner: input.owner,
    repo: input.repo,
    branch: input.branch,
    linkedAt: Date.now(),
  });
  if (saved !== true) {
    return { repoPath: "", error: "that repository is already linked to a project" };
  }
  let token = input.cloneToken;
  if (token.length === 0 && input.provider === "github") {
    const oauth = input.github.getAccessToken(input.ownerId);
    if (oauth !== null) {
      token = oauth;
    }
  }
  if (token.length === 0) {
    return { repoPath: "", error: null };
  }
  const authedUrl = authedGitCloneUrl(input.provider, token, input.owner, input.repo);
  const originUrl = publicGitCloneUrl(input.provider, input.owner, input.repo);
  if (authedUrl.length === 0 || originUrl.length === 0) {
    return { repoPath: "", error: null };
  }
  const dir = projectDir(input.paths, input.projectId);
  const cloneError = await cloneRemoteCheckout(dir, authedUrl, originUrl, input.branch);
  if (cloneError !== null) {
    return { repoPath: "", error: null };
  }
  return { repoPath: dir, error: null };
}

async function cloneRemoteCheckout(
  dir: string,
  authedUrl: string,
  originUrl: string,
  branch: string,
): Promise<string | null> {
  mkdirSync(dir, { recursive: true });
  if (readdirSync(dir).length > 0) {
    return "project folder is not empty";
  }
  try {
    await runGit(process.cwd(), [
      "clone",
      "--branch",
      branch,
      "--single-branch",
      authedUrl,
      dir,
    ]);
    await runGit(dir, ["remote", "set-url", "origin", originUrl]);
  } catch (err) {
    return `clone failed: ${err instanceof Error ? err.message : String(err)}`;
  }
  return null;
}

export async function registerGitProjectsModule(
  app: FastifyInstance,
  options: GitProjectsOptions,
): Promise<void> {
  const dataDir = options.dataDir;

  async function requireProjectAccess(
    request: FastifyRequest,
    projectId: string,
  ): Promise<IdentityUser | null> {
    const user = await options.identity.userFrom(request);
    if (user === null) {
      return null;
    }
    if (!userCanAccessProject(projectId, user.id)) {
      return null;
    }
    return user;
  }

  app.get<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/git",
    async (request, reply) => {
      const user = await requireProjectAccess(request, request.params.projectId);
      if (user === null) {
        return reply.code(404).send({ error: "not found" });
      }
      const repo = getProjectGitLink(dataDir, request.params.projectId);
      if (repo === null) {
        return { linked: false };
      }
      const dir = projectDir(options, request.params.projectId);
      let dirty = false;
      let ahead = 0;
      let behind = 0;
      if (existsSync(join(dir, ".git"))) {
        try {
          const status = await runGit(dir, ["status", "--porcelain"]);
          dirty = status.stdout.trim().length > 0;
          const counts = await runGit(dir, [
            "rev-list",
            "--left-right",
            "--count",
            `origin/${repo.branch}...HEAD`,
          ]);
          const parts = counts.stdout.trim().split(/\s+/);
          behind = Number.parseInt(parts[0] ?? "0", 10) || 0;
          ahead = Number.parseInt(parts[1] ?? "0", 10) || 0;
        } catch {
        }
      }
      return {
        linked: true,
        provider: repo.provider,
        owner: repo.owner,
        repo: repo.repo,
        branch: repo.branch,
        dirty,
        ahead,
        behind,
      };
    },
  );

  async function cloneIntoProject(
    projectId: string,
    ownerId: string,
    token: string,
    owner: string,
    repoName: string,
    branch: string,
  ): Promise<string | null> {
    const dir = projectDir(options, projectId);
    mkdirSync(dir, { recursive: true });
    if (readdirSync(dir).length > 0) {
      return "project folder is not empty; clear it before linking a repo";
    }
    try {
      await runGit(process.cwd(), [
        "clone",
        "--branch",
        branch,
        "--single-branch",
        authedRepoUrl(token, owner, repoName),
        dir,
      ]);
      await runGit(dir, ["remote", "set-url", "origin", repoUrl(owner, repoName)]);
    } catch (err) {
      return `clone failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    const saved = insertProjectGitLink(dataDir, {
      projectId,
      ownerId,
      provider: "github",
      owner,
      repo: repoName,
      branch,
      linkedAt: Date.now(),
    });
    if (saved !== true) {
      return "a repo is already linked to this project";
    }
    return null;
  }

  app.post<{ Params: { projectId: string }; Body: { owner?: unknown; repo?: unknown; branch?: unknown } }>(
    "/api/v1/projects/:projectId/git/link",
    async (request, reply) => {
      const user = await requireProjectAccess(request, request.params.projectId);
      if (user === null) {
        return reply.code(404).send({ error: "not found" });
      }
      const token = githubUserToken(options.github, user.id, options.databasePath);
      if (token.length === 0) {
        return reply.code(409).send({ error: "github not connected" });
      }
      const owner = typeof request.body.owner === "string" ? request.body.owner.trim() : "";
      const repoName = typeof request.body.repo === "string" ? request.body.repo.trim() : "";
      if (owner.length === 0 || repoName.length === 0) {
        return reply.code(400).send({ error: "owner and repo are required" });
      }
      const branch = typeof request.body.branch === "string" && request.body.branch.length > 0
        ? request.body.branch
        : "main";
      if (getProjectGitLink(dataDir, request.params.projectId) !== null) {
        return reply.code(409).send({ error: "a repo is already linked to this project" });
      }
      const failure = await cloneIntoProject(request.params.projectId, user.id, token, owner, repoName, branch);
      if (failure !== null) {
        return reply.code(502).send({ error: failure });
      }
      return reply.code(201).send({ linked: true, owner, repo: repoName, branch });
    },
  );

  app.post<{ Params: { projectId: string }; Body: { message?: unknown } }>(
    "/api/v1/projects/:projectId/git/push",
    async (request, reply) => {
      const user = await requireProjectAccess(request, request.params.projectId);
      if (user === null) {
        return reply.code(404).send({ error: "not found" });
      }
      const repo = getProjectGitLink(dataDir, request.params.projectId);
      if (repo === null) {
        return reply.code(409).send({ error: "no repo linked to this project" });
      }
      if (repo.provider !== "github") {
        return reply.code(409).send({ error: "push is only available for GitHub repos" });
      }
      const token = githubUserToken(options.github, user.id, options.databasePath);
      const account = options.github.getAccount(user.id);
      if (token.length === 0 || account === null) {
        return reply.code(409).send({ error: "github not connected" });
      }
      const message = typeof request.body.message === "string" && request.body.message.trim().length > 0
        ? request.body.message.trim()
        : "Update from Fookie Cloud";
      const dir = projectDir(options, request.params.projectId);
      const commitEmail = account.email ?? `${account.login}@users.noreply.github.com`;
      try {
        await runGit(dir, ["add", "-A"]);
        try {
          await runGit(dir, [
            "-c",
            `user.name=${account.login}`,
            "-c",
            `user.email=${commitEmail}`,
            "commit",
            "-m",
            message,
          ]);
        } catch (err) {
          const text = err instanceof Error ? err.message : String(err);
          if (!text.includes("nothing to commit")) {
            throw err;
          }
        }
        await runGit(dir, ["remote", "set-url", "origin", authedRepoUrl(token, repo.owner, repo.repo)]);
        await runGit(dir, ["push", "origin", `HEAD:${repo.branch}`]);
      } catch (err) {
        return reply.code(502).send({
          error: `push failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        await runGit(dir, ["remote", "set-url", "origin", repoUrl(repo.owner, repo.repo)]).catch(
          () => {},
        );
      }
      return { ok: true };
    },
  );

  app.post<{ Params: { projectId: string } }>(
    "/api/v1/projects/:projectId/git/pull",
    async (request, reply) => {
      const user = await requireProjectAccess(request, request.params.projectId);
      if (user === null) {
        return reply.code(404).send({ error: "not found" });
      }
      const repo = getProjectGitLink(dataDir, request.params.projectId);
      if (repo === null) {
        return reply.code(409).send({ error: "no repo linked to this project" });
      }
      if (repo.provider !== "github") {
        return reply.code(409).send({ error: "pull is only available for GitHub repos" });
      }
      const token = githubUserToken(options.github, user.id, options.databasePath);
      if (token.length === 0) {
        return reply.code(409).send({ error: "github not connected" });
      }
      const dir = projectDir(options, request.params.projectId);
      try {
        await runGit(dir, ["remote", "set-url", "origin", authedRepoUrl(token, repo.owner, repo.repo)]);
        await runGit(dir, ["pull", "--ff-only", "origin", repo.branch]);
      } catch (err) {
        return reply.code(502).send({
          error: `pull failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        await runGit(dir, ["remote", "set-url", "origin", repoUrl(repo.owner, repo.repo)]).catch(
          () => {},
        );
      }
      return { ok: true };
    },
  );
}
