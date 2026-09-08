import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aiToolById, listAiTools, requireAiTool } from "./ai-catalog.js";
import { assertHttpsAiBase, assertLocalAiBase } from "./ai-base.js";
import { parseOpenAiChat, parseOpenAiModels } from "./openai-compat.js";
import { parseAnthropicMessage, parseAnthropicModels } from "./anthropic-api.js";
import { ensureAiToolSchema, listAiToolConnections, saveAiToolConnection, connectionWithCliHealth } from "./ai-store.js";
import { presentAiToolConnections, probeCliTool, requireConnectedAiToolId } from "./ai-health.js";
import { openSettingsDb } from "./app-settings.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("ai catalog", () => {
  it("lists local, cloud, and CLI tools", () => {
    const tools = listAiTools();
    assert.equal(tools.length, 13);
    const ollama = aiToolById("ollama")[0];
    const openrouter = aiToolById("openrouter")[0];
    const cursor = aiToolById("cursor")[0];
    if (ollama === undefined || openrouter === undefined || cursor === undefined) {
      assert.fail("expected ollama, openrouter, and cursor");
      return;
    }
    assert.equal(ollama.lane, "local");
    assert.equal(ollama.protocol, "ollama");
    assert.equal(openrouter.lane, "cloud");
    assert.equal(openrouter.protocol, "openai");
    assert.equal(requireAiTool("anthropic").protocol, "anthropic");
    assert.equal(cursor.lane, "cli");
    assert.equal(aiToolById("n8n").length, 0);
    assert.equal(requireAiTool("groq").label, "Groq");
  });
});

describe("ai base allowlist", () => {
  it("accepts loopback local hosts and https cloud endpoints", () => {
    assert.equal(assertLocalAiBase("http://127.0.0.1:11434"), "http://127.0.0.1:11434");
    assert.equal(assertLocalAiBase("http://localhost:1234/v1"), "http://localhost:1234/v1");
    assert.equal(
      assertHttpsAiBase("https://openrouter.ai/api/v1"),
      "https://openrouter.ai/api/v1",
    );
    assert.throws(() => {
      assertLocalAiBase("http://169.254.169.254/");
    }, /this machine/);
    assert.throws(() => {
      assertHttpsAiBase("http://api.openai.com/v1");
    }, /https/);
  });
});

describe("openai-compat parse", () => {
  it("reads model ids and chat text from OpenAI envelopes", () => {
    const models = parseOpenAiModels({
      data: [{ id: "gpt-4.1-mini" }, { id: "gpt-4.1" }],
    });
    assert.deepEqual(models, ["gpt-4.1-mini", "gpt-4.1"]);
    const text = parseOpenAiChat({
      choices: [{ message: { content: "  hello  " } }],
    });
    assert.equal(text, "hello");
    assert.throws(() => {
      parseOpenAiChat({ choices: [] });
    }, /no choices/);
  });
});

describe("anthropic parse", () => {
  it("reads model ids and message text from Anthropic envelopes", () => {
    const models = parseAnthropicModels({
      data: [{ id: "claude-sonnet-4-6" }, { id: "claude-opus-4-6" }],
    });
    assert.deepEqual(models, ["claude-sonnet-4-6", "claude-opus-4-6"]);
    const text = parseAnthropicMessage({
      content: [{ type: "text", text: "  hello  " }],
    });
    assert.equal(text, "hello");
    assert.throws(() => {
      parseAnthropicMessage({ content: [{ type: "tool_use" }] });
    }, /empty text/);
  });
});

describe("ai store", () => {
  it("connects a cloud tool only with key and model", () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-ai-store-"));
    const db = openSettingsDb(join(dir, "app.sqlite"));
    ensureAiToolSchema(db);
    const listed = listAiToolConnections(db);
    assert.equal(listed.length, 13);
    const saved = saveAiToolConnection(db, "openai", {
      secret: "sk-test",
      baseUrl: "https://evil.example/v1",
      model: "gpt-4.1-mini",
      disconnect: false,
    });
    assert.equal(saved.connected, true);
    assert.equal(saved.baseUrl, "https://api.openai.com/v1");
    const kept = saveAiToolConnection(db, "openai", {
      secret: "",
      baseUrl: "",
      model: "gpt-4.1",
      disconnect: false,
    });
    assert.equal(kept.connected, true);
    assert.equal(kept.model, "gpt-4.1");
    const empty = saveAiToolConnection(db, "openai", {
      secret: "",
      baseUrl: "",
      model: "",
      disconnect: true,
    });
    assert.equal(empty.connected, false);
  });

  it("does not treat a missing CLI as connected", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-ai-cli-"));
    const db = openSettingsDb(join(dir, "app.sqlite"));
    ensureAiToolSchema(db);
    const flagged = saveAiToolConnection(db, "codex", {
      secret: "connected",
      baseUrl: "",
      model: "",
      disconnect: false,
    });
    assert.equal(flagged.connected, true);
    const health = await probeCliTool("codex");
    const presented = await presentAiToolConnections(db);
    let listed = flagged;
    for (const row of presented) {
      if (row.id === "codex") {
        listed = row;
      }
    }
    assert.equal(listed.connected, health.reachable);
    assert.equal(connectionWithCliHealth(flagged, false).connected, false);
  });

  it("fail-closes when no connected AI tool is given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-ai-require-"));
    const db = openSettingsDb(join(dir, "app.sqlite"));
    ensureAiToolSchema(db);
    await assert.rejects(() => requireConnectedAiToolId(db, ""), /Pick a connected AI tool/);
    await assert.rejects(() => requireConnectedAiToolId(db, "ollama"), /not connected/);
  });
});
