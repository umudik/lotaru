import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runLocalOllamaPrompt, runProjectAgentPrompt } from "./agent-prompt.js";
import { openSettingsDb } from "./app-settings.js";
import { saveAgentProfile, openAgentDb } from "./agent-store.js";

describe("runProjectAgentPrompt", () => {
  it("routes injected agent runs through the saved profile kind and mode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-agent-prompt-"));
    const databasePath = join(dir, "app.sqlite");
    saveAgentProfile(openAgentDb(databasePath), {
      kind: "claude",
      mode: "plan",
      command: "",
    });
    let capturedKind = "";
    let capturedMode = "";
    const reply = await runProjectAgentPrompt({
      databasePath,
      projectId: "proj-a",
      prompt: "write docs",
      mode: "ask",
      projectCwd: () => dir,
      runAgent: async (input) => {
        capturedKind = input.kind;
        capturedMode = input.mode;
        return "ok";
      },
    });
    assert.equal(reply, "ok");
    assert.equal(capturedKind, "claude");
    assert.equal(capturedMode, "ask");
  });
});

describe("runLocalOllamaPrompt", () => {
  it("fail-closes when no Ollama model is configured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-local-ollama-"));
    const databasePath = join(dir, "app.sqlite");
    openSettingsDb(databasePath);
    await assert.rejects(
      () =>
        runLocalOllamaPrompt({
          databasePath,
          systemPrompt: "classify intents",
          prompt: "hello",
        }),
      /model/i,
    );
  });
});
