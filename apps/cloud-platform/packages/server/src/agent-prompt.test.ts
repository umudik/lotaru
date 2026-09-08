import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { replyLanguageInstruction, runLocalOllamaPrompt, runProjectAgentPrompt } from "./agent-prompt.js";
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

  it("fail-closes when no connected AI tool is selected", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lotaru-agent-prompt-empty-"));
    const databasePath = join(dir, "app.sqlite");
    await assert.rejects(
      () =>
        runProjectAgentPrompt({
          databasePath,
          projectId: "proj-a",
          prompt: "write docs",
          projectCwd: () => dir,
        }),
      /Pick a connected AI tool/,
    );
  });
});

describe("replyLanguageInstruction", () => {
  it("follows the prompt language and falls back to the settings label", () => {
    const line = replyLanguageInstruction("Turkish");
    assert.match(line, /same language as the user's instructions/);
    assert.match(line, /platform scaffolding/);
    assert.match(line, /write in Turkish/);
  });

  it("omits a fallback when no settings language is given", () => {
    const line = replyLanguageInstruction("   ");
    assert.match(line, /same language as the user's instructions/);
    assert.equal(line.includes("If the instructions do not pick a language"), false);
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
