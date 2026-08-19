import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { createIdentity } from "./modules/identity.js";
import { registerKnowledgeModule, runKnowledgeAutomation } from "./modules/knowledge.js";

const PROJECT_ID = "proj-knowledge";

async function startKnowledge(runAgent?: (prompt: string) => Promise<string>) {
  const dir = mkdtempSync(join(tmpdir(), "lotaru-knowledge-"));
  const app = Fastify({ logger: false });
  const identity = await createIdentity({
    publicUrl: "http://127.0.0.1:4317",
    dataDir: dir,
  });
  await registerKnowledgeModule(app, {
    databasePath: join(dir, "app.sqlite"),
    identity,
    projectAccess: () => true,
    projectCwd: () => dir,
    runAgent:
      runAgent === undefined
        ? undefined
        : async (input) => {
            return runAgent(input.prompt);
          },
  });
  return app;
}

describe("knowledge", () => {
  it("creates a brief with empty documentation and diagram outputs", async (t) => {
    const app = await startKnowledge();
    t.after(async () => {
      await app.close();
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/knowledge",
      payload: {
        projectId: PROJECT_ID,
        subject: "Transfer",
        intent: "process",
        audience: "developer",
        language: "tr",
      },
    });
    assert.equal(created.statusCode, 201);
    const item = created.json();
    assert.equal(item.subject, "Transfer");
    assert.equal(item.intent, "process");
    assert.equal(item.document.currentVersion, 0);
    assert.equal(item.diagram.currentVersion, 0);
    assert.equal(item.document.currentBody, "");
    assert.equal(item.diagram.currentBody, "");
  });

  it("lets the user edit current, then approve a proposed version", async (t) => {
    const app = await startKnowledge();
    t.after(async () => {
      await app.close();
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/knowledge",
      payload: {
        projectId: PROJECT_ID,
        subject: "Wallet",
        intent: "overview",
        audience: "ops",
        language: "en",
      },
    });
    const id = created.json().id;
    const edited = await app.inject({
      method: "PATCH",
      url: `/api/knowledge/${id}/document`,
      payload: { currentBody: "# Wallet\nCurrent text", sourcesText: "Note #1" },
    });
    assert.equal(edited.statusCode, 200);
    assert.equal(edited.json().document.currentVersion, 1);
    assert.equal(edited.json().document.currentBody, "# Wallet\nCurrent text");
    const proposed = await app.inject({
      method: "PATCH",
      url: `/api/knowledge/${id}/document`,
      payload: { proposedBody: "# Wallet\nProposed rewrite" },
    });
    assert.equal(proposed.json().document.proposedVersion, 2);
    assert.equal(proposed.json().document.currentBody, "# Wallet\nCurrent text");
    const approved = await app.inject({
      method: "POST",
      url: `/api/knowledge/${id}/document/approve`,
    });
    assert.equal(approved.statusCode, 200);
    assert.equal(approved.json().document.currentBody, "# Wallet\nProposed rewrite");
    assert.equal(approved.json().document.currentVersion, 2);
    assert.equal(approved.json().document.proposedBody, "");
    assert.equal(approved.json().document.proposedVersion, 0);
  });

  it("filters list views for documentation and diagrams", async (t) => {
    const app = await startKnowledge();
    t.after(async () => {
      await app.close();
    });
    const transfer = await app.inject({
      method: "POST",
      url: "/api/knowledge",
      payload: {
        projectId: PROJECT_ID,
        subject: "Transfer",
        intent: "process",
        audience: "developer",
        language: "tr",
      },
    });
    const wallet = await app.inject({
      method: "POST",
      url: "/api/knowledge",
      payload: {
        projectId: PROJECT_ID,
        subject: "Wallet",
        intent: "overview",
        audience: "developer",
        language: "en",
      },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/knowledge/${transfer.json().id}/document`,
      payload: { currentBody: "transfer doc" },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/knowledge/${wallet.json().id}/diagram`,
      payload: { currentBody: "flowchart TD" },
    });
    const docs = await app.inject({
      method: "GET",
      url: `/api/knowledge?projectId=${PROJECT_ID}&view=documentation`,
    });
    assert.equal(docs.json().items.length, 1);
    assert.equal(docs.json().items[0].subject, "Transfer");
    const diagrams = await app.inject({
      method: "GET",
      url: `/api/knowledge?projectId=${PROJECT_ID}&view=diagrams`,
    });
    assert.equal(diagrams.json().items.length, 1);
    assert.equal(diagrams.json().items[0].subject, "Wallet");
  });

  it("writes agent output into proposed, not current", async (t) => {
    const app = await startKnowledge(async () => "# Generated\nfrom agent");
    t.after(async () => {
      await app.close();
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/knowledge",
      payload: {
        projectId: PROJECT_ID,
        subject: "Transfer",
        intent: "process",
        audience: "developer",
        language: "tr",
      },
    });
    const id = created.json().id;
    await app.inject({
      method: "PATCH",
      url: `/api/knowledge/${id}/document`,
      payload: { currentBody: "keep me" },
    });
    const proposed = await app.inject({
      method: "POST",
      url: `/api/knowledge/${id}/document/propose`,
    });
    assert.equal(proposed.statusCode, 200);
    assert.equal(proposed.json().document.currentBody, "keep me");
    assert.equal(proposed.json().document.proposedBody, "# Generated\nfrom agent");
    assert.equal(proposed.json().document.proposedVersion, 2);
  });

  it("runs knowledge automation into proposed and leaves current on failure", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-knowledge-auto-"));
    const databasePath = join(dir, "app.sqlite");
    const app = Fastify({ logger: false });
    const identity = await createIdentity({
      publicUrl: "http://127.0.0.1:4317",
      dataDir: dir,
    });
    await registerKnowledgeModule(app, {
      databasePath,
      identity,
      projectAccess: () => true,
      projectCwd: () => dir,
    });
    t.after(async () => {
      await app.close();
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/knowledge",
      payload: {
        projectId: PROJECT_ID,
        subject: "Transfer",
        intent: "process",
        audience: "developer",
        language: "tr",
      },
    });
    const id = created.json().id;
    await app.inject({
      method: "PATCH",
      url: `/api/knowledge/${id}/document`,
      payload: { currentBody: "keep me" },
    });
    await runKnowledgeAutomation({
      databasePath,
      itemId: id,
      projectId: PROJECT_ID,
      outputs: ["document"],
      projectCwd: () => dir,
      runAgent: async () => {
        return "proposed v2";
      },
    });
    const proposed = await app.inject({
      method: "GET",
      url: `/api/knowledge/${id}`,
    });
    assert.equal(proposed.json().document.currentBody, "keep me");
    assert.equal(proposed.json().document.proposedBody, "proposed v2");
    assert.equal(proposed.json().stale, false);
    await assert.rejects(async () => {
      await runKnowledgeAutomation({
        databasePath,
        itemId: id,
        projectId: PROJECT_ID,
        outputs: ["document"],
        projectCwd: () => dir,
        runAgent: async () => {
          throw new Error("agent down");
        },
      });
    });
    const failed = await app.inject({
      method: "GET",
      url: `/api/knowledge/${id}`,
    });
    assert.equal(failed.json().document.currentBody, "keep me");
    assert.equal(failed.json().document.proposedBody, "proposed v2");
    assert.equal(failed.json().stale, true);
  });
});
