import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { createIdentity } from "./modules/identity.js";
import { registerProjectsModule } from "./modules/projects.js";
import type { GithubAuth } from "./modules/github-auth.js";
import { closeCachedSqlite } from "./sqlite-cache.js";

function stubGithub(): GithubAuth {
  return {
    isConfigured(): boolean {
      return false;
    },
    getAccessToken(): string | null {
      return null;
    },
    getAccount(): null {
      return null;
    },
  };
}

async function startProjects() {
  const dir = mkdtempSync(join(tmpdir(), "lotaru-projects-"));
  process.env.DATABASE_PATH = join(dir, "bridge.db");
  process.env.FOOKIE_MODE = "1";
  const app = Fastify({ logger: false });
  const identity = await createIdentity({
    publicUrl: "http://127.0.0.1:4317",
    dataDir: dir,
  });
  await registerProjectsModule(app, {
    identity,
    github: stubGithub(),
    dataDir: dir,
    workspacesHostDir: null,
    databasePath: join(dir, "app.sqlite"),
  });
  return { app, dir };
}

describe("projects", () => {
  it("lists projects for the local owner", async (t) => {
    const { app } = await startProjects();
    t.after(async () => {
      await app.close();
      closeCachedSqlite();
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/projects",
    });
    assert.equal(res.statusCode, 200);
    assert.equal(Array.isArray(res.json().projects), true);
  });

  it("creates a project from an existing git repo", async (t) => {
    const { app } = await startProjects();
    t.after(async () => {
      await app.close();
      closeCachedSqlite();
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Demo",
        description: "Test project",
        workflowTemplateId: "plan-build-deliver",
        git: { provider: "github", owner: "acme", repo: "demo", branch: "main" },
      },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().name, "Demo");
    assert.equal(res.json().git.provider, "github");
    assert.equal(res.json().git.repo, "demo");
  });

  it("creates a project from a local folder", async (t) => {
    const { app, dir } = await startProjects();
    t.after(async () => {
      await app.close();
      closeCachedSqlite();
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Folder Demo",
        description: "Local folder",
        workflowTemplateId: "plan-build-deliver",
        repoPath: dir,
      },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().name, "Folder Demo");
    assert.equal(res.json().repoPath, dir);
    assert.equal(res.json().git, null);
  });

  it("follows origin when a local folder is already a github clone", async (t) => {
    const { app, dir } = await startProjects();
    t.after(async () => {
      await app.close();
      closeCachedSqlite();
    });
    const checkout = join(dir, "checkout");
    mkdirSync(checkout);
    execFileSync("git", ["init", "-b", "main"], { cwd: checkout, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/from-folder.git"], {
      cwd: checkout,
      stdio: "ignore",
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "From Folder",
        description: "Already cloned",
        workflowTemplateId: "plan-build-deliver",
        repoPath: checkout,
      },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().repoPath, checkout);
    assert.equal(res.json().git.provider, "github");
    assert.equal(res.json().git.repo, "from-folder");
  });

  it("rejects a missing folder path", async (t) => {
    const { app } = await startProjects();
    t.after(async () => {
      await app.close();
      closeCachedSqlite();
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Demo",
        description: "Test project",
        workflowTemplateId: "plan-build-deliver",
        repoPath: join(tmpdir(), "lotaru-missing-folder-never-exists"),
      },
    });
    assert.equal(res.statusCode, 400);
  });

  it("rejects create without a folder or git repository", async (t) => {
    const { app } = await startProjects();
    t.after(async () => {
      await app.close();
      closeCachedSqlite();
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Demo",
        description: "Test project",
        workflowTemplateId: "plan-build-deliver",
      },
    });
    assert.equal(res.statusCode, 400);
  });

  it("rejects linking the same git repo twice", async (t) => {
    const { app } = await startProjects();
    t.after(async () => {
      await app.close();
      closeCachedSqlite();
    });
    const payload = {
      name: "Demo",
      description: "Test project",
      workflowTemplateId: "plan-build-deliver",
      git: { provider: "github", owner: "acme", repo: "once" },
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload,
    });
    assert.equal(first.statusCode, 201);
    const second = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Other",
        description: "",
        workflowTemplateId: "plan-build-deliver",
        git: { provider: "github", owner: "acme", repo: "once" },
      },
    });
    assert.equal(second.statusCode, 409);
  });

  it("rejects create with an invalid body", async (t) => {
    const { app } = await startProjects();
    t.after(async () => {
      await app.close();
      closeCachedSqlite();
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "",
        description: "Test project",
        workflowTemplateId: "plan-build-deliver",
        git: { provider: "github", owner: "acme", repo: "demo" },
      },
    });
    assert.equal(res.statusCode, 400);
  });

  it("rejects patch when the project id format is invalid", async (t) => {
    const { app } = await startProjects();
    t.after(async () => {
      await app.close();
      closeCachedSqlite();
    });
    const res = await app.inject({
      method: "PATCH",
      url: "/api/projects/INVALID_ID",
      payload: {
        name: "Demo",
        description: "Updated",
        workflowTemplateId: "plan-build-deliver",
      },
    });
    assert.equal(res.statusCode, 400);
  });

  it("returns 404 when patching a missing project", async (t) => {
    const { app } = await startProjects();
    t.after(async () => {
      await app.close();
      closeCachedSqlite();
    });
    const res = await app.inject({
      method: "PATCH",
      url: "/api/projects/missing-project",
      payload: {
        name: "Demo",
        description: "Updated",
        workflowTemplateId: "plan-build-deliver",
      },
    });
    assert.equal(res.statusCode, 404);
  });

  it("creates a gitlab project from an existing repo", async (t) => {
    const { app } = await startProjects();
    t.after(async () => {
      await app.close();
      closeCachedSqlite();
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Gitlab Demo",
        description: "GitLab project",
        workflowTemplateId: "plan-build-deliver",
        git: { provider: "gitlab", owner: "acme", repo: "platform", branch: "main" },
      },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().git.provider, "gitlab");
    assert.equal(res.json().git.repo, "platform");
  });

  it("creates an azure devops project from an existing repo", async (t) => {
    const { app } = await startProjects();
    t.after(async () => {
      await app.close();
      closeCachedSqlite();
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Azure Demo",
        description: "Azure DevOps project",
        workflowTemplateId: "plan-build-deliver",
        git: {
          provider: "azuredevops",
          owner: "fabrikam/Fiber",
          repo: "platform",
          branch: "main",
        },
      },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().git.provider, "azuredevops");
    assert.equal(res.json().git.owner, "fabrikam/Fiber");
  });

  it("creates a bitbucket project from an existing repo", async (t) => {
    const { app } = await startProjects();
    t.after(async () => {
      await app.close();
      closeCachedSqlite();
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Bitbucket Demo",
        description: "Bitbucket project",
        workflowTemplateId: "plan-build-deliver",
        git: { provider: "bitbucket", owner: "acme", repo: "platform", branch: "main" },
      },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().git.provider, "bitbucket");
    assert.equal(res.json().git.repo, "platform");
  });

  it("ignores a folder path on patch and keeps the git link", async (t) => {
    const { app, dir } = await startProjects();
    t.after(async () => {
      await app.close();
      closeCachedSqlite();
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Demo",
        description: "Test project",
        workflowTemplateId: "plan-build-deliver",
        git: { provider: "github", owner: "acme", repo: "keep-git" },
      },
    });
    assert.equal(created.statusCode, 201);
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/projects/${created.json().id}`,
      payload: {
        name: "Renamed",
        description: "Updated",
        workflowTemplateId: "plan-build-deliver",
        repoPath: dir,
      },
    });
    assert.equal(patched.statusCode, 200);
    assert.equal(patched.json().name, "Renamed");
    assert.equal(patched.json().git.repo, "keep-git");
    assert.equal(patched.json().repoPath, created.json().repoPath);
  });
});
