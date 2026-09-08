import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { createIdentity } from "./modules/identity.js";
import { registerSettingsModule } from "./modules/settings.js";
import type { TunnelSnapshot, WebhookTunnel } from "./webhook-tunnel.js";

function stubTunnel(): WebhookTunnel {
  let enabled = true;
  let provider: "cloudflare" | "ngrok" = "cloudflare";
  let ngrokConfigured = false;
  let state: TunnelSnapshot["state"] = "off";
  let publicUrl = "";
  let detail = "";
  function snapshot(): TunnelSnapshot {
    return {
      enabled,
      provider,
      ngrokConfigured,
      state,
      publicUrl,
      detail,
    };
  }
  return {
    snapshot,
    async apply(input) {
      enabled = input.enabled;
      provider = input.provider;
      if (input.ngrokToken.trim().length > 0) {
        ngrokConfigured = true;
      }
      if (input.enabled !== true) {
        state = "off";
        publicUrl = "";
        detail = "";
        return snapshot();
      }
      state = "up";
      publicUrl = "https://lotaru-test.trycloudflare.com";
      detail = "";
      return snapshot();
    },
    async restart() {
      if (enabled !== true) {
        state = "off";
        publicUrl = "";
        detail = "";
        return snapshot();
      }
      state = "up";
      publicUrl = "https://lotaru-test.trycloudflare.com";
      detail = "";
      return snapshot();
    },
    async boot() {
      return;
    },
    async stop() {
      return;
    },
  };
}

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
    tunnel: stubTunnel(),
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

describe("connectors", () => {
  it("lists product connections and opens events after connect", async (t) => {
    const { app } = await startSettings();
    t.after(async () => {
      await app.close();
    });
    const listed = await app.inject({ method: "GET", url: "/api/connectors" });
    assert.equal(listed.statusCode, 200);
    const body = listed.json() as {
      connectors: { id: string; connected: boolean; events: { type: string }[] }[];
    };
    assert.equal(body.connectors.length >= 80, true);
    for (const connector of body.connectors) {
      assert.equal(connector.connected, false);
      assert.equal(connector.events.length > 0, true);
    }
    const clickup = await app.inject({
      method: "PUT",
      url: "/api/connectors/clickup",
      payload: { secret: "clickup-token" },
    });
    assert.equal(clickup.statusCode, 200);
    assert.equal(clickup.json().connected, true);
    const after = await app.inject({ method: "GET", url: "/api/connectors" });
    const clickupRow = (after.json() as { connectors: { id: string; connected: boolean }[] }).connectors.find(
      (row) => row.id === "clickup",
    );
    assert.equal(clickupRow?.connected, true);
  });
});

describe("tunnel settings", () => {
  it("returns a tunnel snapshot and persists enablement", async (t) => {
    const { app } = await startSettings();
    t.after(async () => {
      await app.close();
    });
    const listed = await app.inject({ method: "GET", url: "/api/settings/tunnel" });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().tunnel.enabled, true);
    assert.equal(listed.json().tunnel.provider, "cloudflare");
    const saved = await app.inject({
      method: "PUT",
      url: "/api/settings/tunnel",
      payload: { enabled: false, provider: "ngrok", ngrokToken: "ngrok-auth-token" },
    });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().tunnel.enabled, false);
    assert.equal(saved.json().tunnel.provider, "ngrok");
    assert.equal(saved.json().tunnel.ngrokConfigured, true);
    assert.equal(saved.json().tunnel.state, "off");
    const loaded = await app.inject({ method: "GET", url: "/api/settings/tunnel" });
    assert.equal(loaded.json().tunnel.enabled, false);
    const restarted = await app.inject({ method: "POST", url: "/api/settings/tunnel/restart" });
    assert.equal(restarted.statusCode, 200);
    assert.equal(restarted.json().tunnel.state, "off");
    const ingest = await app.inject({ method: "GET", url: "/api/settings/ingest" });
    assert.equal(ingest.statusCode, 200);
    assert.equal(Array.isArray(ingest.json().polls), true);
    assert.equal(Array.isArray(ingest.json().hooks), true);
    assert.equal(Array.isArray(ingest.json().hookSync), true);
    assert.equal(typeof ingest.json().notionVerificationToken, "string");
    assert.equal(ingest.json().alarm.kind, "ok");
  });

  it("rejects an invalid tunnel payload", async (t) => {
    const { app } = await startSettings();
    t.after(async () => {
      await app.close();
    });
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings/tunnel",
      payload: { enabled: true, provider: "wireguard" },
    });
    assert.equal(res.statusCode, 400);
  });
});

describe("ai tools", () => {
  it("lists the catalog and stores a cloud key locally", async (t) => {
    const { app } = await startSettings();
    t.after(async () => {
      await app.close();
    });
    const listed = await app.inject({ method: "GET", url: "/api/ai-tools" });
    assert.equal(listed.statusCode, 200);
    const body = listed.json() as {
      tools: { id: string; connected: boolean; lane: string }[];
    };
    assert.equal(body.tools.length, 13);
    for (const tool of body.tools) {
      assert.equal(tool.connected, false);
    }
    const saved = await app.inject({
      method: "PUT",
      url: "/api/ai-tools/openrouter",
      payload: { secret: "sk-or-test", baseUrl: "", model: "openai/gpt-4.1-mini" },
    });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().tool.connected, true);
    assert.equal(saved.json().tool.baseUrl, "https://openrouter.ai/api/v1");
    const missing = await app.inject({
      method: "PUT",
      url: "/api/ai-tools/n8n",
      payload: { secret: "x", baseUrl: "", model: "x" },
    });
    assert.equal(missing.statusCode, 404);
    const badLocal = await app.inject({
      method: "PUT",
      url: "/api/ai-tools/lmstudio",
      payload: { secret: "", baseUrl: "http://8.8.8.8:1234/v1", model: "qwen" },
    });
    assert.equal(badLocal.statusCode, 400);
    const cli = await app.inject({
      method: "PUT",
      url: "/api/ai-tools/codex",
      payload: { secret: "connected", baseUrl: "", model: "" },
    });
    if (cli.statusCode === 200) {
      assert.equal(cli.json().tool.connected, true);
    } else {
      assert.equal(cli.statusCode, 400);
      assert.match(String(cli.json().error), /not found on PATH/);
      const again = await app.inject({ method: "GET", url: "/api/ai-tools" });
      const tools = again.json().tools as { id: string; connected: boolean }[];
      for (const tool of tools) {
        if (tool.id === "codex") {
          assert.equal(tool.connected, false);
        }
      }
    }
  });
});
