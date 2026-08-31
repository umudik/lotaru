import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { createIdentity } from "./modules/identity.js";
import { registerProjectsModule } from "./modules/projects.js";

async function startProjects() {
  const dir = mkdtempSync(join(tmpdir(), "lotaru-projects-"));
  process.env.DATABASE_PATH = join(dir, "bridge.db");
  process.env.FOOKIE_MODE = "1";
  const app = Fastify({ logger: false });
  const identity = await createIdentity({
    publicUrl: "http://127.0.0.1:4317",
    dataDir: dir,
  });
  await registerProjectsModule(app, identity);
  return { app, dir };
}

describe("projects", () => {
  it("lists projects for the local owner", async (t) => {
    const { app } = await startProjects();
    t.after(async () => {
      await app.close();
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/projects",
    });
    assert.equal(res.statusCode, 200);
    assert.equal(Array.isArray(res.json().projects), true);
  });

  it("creates a project when the folder exists", async (t) => {
    const { app, dir } = await startProjects();
    t.after(async () => {
      await app.close();
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Demo",
        description: "Test project",
        workflowTemplateId: "plan-build-deliver",
        repoPath: dir,
      },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().name, "Demo");
    assert.equal(res.json().repoPath, dir);
  });

  it("rejects create when the folder path is missing", async (t) => {
    const { app } = await startProjects();
    t.after(async () => {
      await app.close();
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

  it("rejects create with an invalid body", async (t) => {
    const { app, dir } = await startProjects();
    t.after(async () => {
      await app.close();
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "",
        description: "Test project",
        workflowTemplateId: "plan-build-deliver",
        repoPath: dir,
      },
    });
    assert.equal(res.statusCode, 400);
  });

  it("rejects patch when the project id format is invalid", async (t) => {
    const { app, dir } = await startProjects();
    t.after(async () => {
      await app.close();
    });
    const res = await app.inject({
      method: "PATCH",
      url: "/api/projects/INVALID_ID",
      payload: {
        name: "Demo",
        description: "Updated",
        workflowTemplateId: "plan-build-deliver",
        repoPath: dir,
      },
    });
    assert.equal(res.statusCode, 400);
  });

  it("returns 404 when patching a missing project", async (t) => {
    const { app, dir } = await startProjects();
    t.after(async () => {
      await app.close();
    });
    const res = await app.inject({
      method: "PATCH",
      url: "/api/projects/missing-project",
      payload: {
        name: "Demo",
        description: "Updated",
        workflowTemplateId: "plan-build-deliver",
        repoPath: dir,
      },
    });
    assert.equal(res.statusCode, 404);
  });
});
