import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { createIdentity } from "./modules/identity.js";
import { registerSettingsModule } from "./modules/settings.js";

async function startSettings() {
  const dir = mkdtempSync(join(tmpdir(), "lotaru-settings-"));
  const app = Fastify({ logger: false });
  const identity = await createIdentity({
    publicUrl: "http://127.0.0.1:4317",
    dataDir: dir,
  });
  await registerSettingsModule(app, {
    databasePath: join(dir, "app.sqlite"),
    identity,
  });
  return { app, dir };
}

describe("settings agent", () => {
  it("returns the default agent profile", async (t) => {
    const { app } = await startSettings();
    t.after(async () => {
      await app.close();
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/settings/agent",
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().profile.kind, "ollama");
    assert.equal(res.json().profile.mode, "ask");
  });

  it("rejects an invalid agent profile", async (t) => {
    const { app } = await startSettings();
    t.after(async () => {
      await app.close();
    });
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/agent",
      payload: { kind: "invalid", mode: "ask", command: "" },
    });
    assert.equal(res.statusCode, 400);
  });

  it("persists agent profile changes", async (t) => {
    const { app } = await startSettings();
    t.after(async () => {
      await app.close();
    });
    const saved = await app.inject({
      method: "PUT",
      url: "/api/settings/agent",
      payload: { kind: "claude", mode: "plan", command: "" },
    });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().profile.kind, "claude");
    assert.equal(saved.json().profile.mode, "plan");
    const loaded = await app.inject({
      method: "GET",
      url: "/api/settings/agent",
    });
    assert.equal(loaded.json().profile.kind, "claude");
    assert.equal(loaded.json().profile.mode, "plan");
  });

  it("probes a CLI agent and reports missing binary", async (t) => {
    const { app } = await startSettings();
    t.after(async () => {
      await app.close();
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/settings/agent/probe",
      payload: { kind: "cursor", mode: "ask", command: "lotaru-missing-agent-bin" },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().reachable, false);
    assert.equal(res.json().command, "lotaru-missing-agent-bin");
    assert.match(res.json().error, /not found/i);
  });
});

describe("settings app", () => {
  it("returns app settings and language list", async (t) => {
    const { app } = await startSettings();
    t.after(async () => {
      await app.close();
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/settings",
    });
    assert.equal(res.statusCode, 200);
    assert.equal(typeof res.json().settings.ollamaHost, "string");
    assert.equal(Array.isArray(res.json().languages), true);
    assert.equal(res.json().languages.length > 0, true);
  });
});
