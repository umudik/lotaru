import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_APP_SETTINGS } from "./app-settings.js";
import { probeAgentRuntime } from "./agent-probe.js";

describe("probeAgentRuntime", () => {
  it("marks CLI agents connected when the binary is on PATH", async () => {
    const result = await probeAgentRuntime({
      profile: { kind: "cursor", mode: "execute", command: "" },
      settings: DEFAULT_APP_SETTINGS,
      locateBinary: async () => ["C:\\Users\\seyit\\AppData\\Local\\cursor-agent\\agent.cmd"],
    });
    assert.equal(result.reachable, true);
    assert.equal(result.command, "agent");
    assert.match(result.detail, /agent/i);
    assert.equal(result.error, "");
  });

  it("marks CLI agents offline when the binary is missing", async () => {
    const result = await probeAgentRuntime({
      profile: { kind: "claude", mode: "ask", command: "" },
      settings: DEFAULT_APP_SETTINGS,
      locateBinary: async () => [],
    });
    assert.equal(result.reachable, false);
    assert.equal(result.command, "claude");
    assert.match(result.error, /not found/i);
  });

  it("rejects an invalid CLI override without probing PATH", async () => {
    const result = await probeAgentRuntime({
      profile: { kind: "cursor", mode: "ask", command: "../evil" },
      settings: DEFAULT_APP_SETTINGS,
      locateBinary: async () => {
        assert.fail("should not locate");
        return [];
      },
    });
    assert.equal(result.reachable, false);
    assert.match(result.error, /bare binary/i);
  });

  it("requires an Ollama model when provider is Ollama", async () => {
    const result = await probeAgentRuntime({
      profile: { kind: "ollama", mode: "ask", command: "" },
      settings: Object.assign({}, DEFAULT_APP_SETTINGS, {
        ollamaHost: "",
        ollamaModel: "",
      }),
    });
    assert.equal(result.reachable, false);
    assert.match(result.error, /host/i);
  });
});
