import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentCliSpec,
  defaultAgentCommand,
  parseAgentKind,
  resolvedAgentCommand,
} from "./agent-runtime.js";

describe("agentCliSpec", () => {
  it("runs Cursor Agent CLI in print mode without an API key flag", () => {
    const spec = agentCliSpec({
      kind: "cursor",
      mode: "ask",
      command: "",
      prompt: "Update Transfer docs",
    });
    assert.equal(spec.command, "agent");
    assert.equal(spec.args.includes("-p"), true);
    assert.equal(spec.args.includes("--mode=ask"), true);
    assert.equal(spec.args.includes("Update Transfer docs"), true);
    assert.equal(spec.args.join(" ").includes("api-key"), false);
    assert.equal(spec.args.join(" ").includes("API_KEY"), false);
  });

  it("lets Cursor write files only in execute mode", () => {
    const ask = agentCliSpec({
      kind: "cursor",
      mode: "ask",
      command: "",
      prompt: "q",
    });
    const execute = agentCliSpec({
      kind: "cursor",
      mode: "execute",
      command: "",
      prompt: "q",
    });
    assert.equal(ask.args.includes("--force"), false);
    assert.equal(execute.args.includes("--force"), true);
  });

  it("maps Claude Code print mode to permission-mode", () => {
    const ask = agentCliSpec({
      kind: "claude",
      mode: "ask",
      command: "",
      prompt: "Explain transfer",
    });
    assert.equal(ask.command, "claude");
    assert.deepEqual(ask.args.slice(0, 5), [
      "-p",
      "--output-format",
      "text",
      "--permission-mode",
      "plan",
    ]);
  });

  it("runs Codex as exec with a sandbox", () => {
    const spec = agentCliSpec({
      kind: "codex",
      mode: "execute",
      command: "",
      prompt: "Draw the sequence",
    });
    assert.equal(spec.command, "codex");
    assert.equal(spec.args[0], "exec");
    assert.equal(spec.args.includes("workspace-write"), true);
  });

  it("honors a custom binary name", () => {
    const spec = agentCliSpec({
      kind: "cursor",
      mode: "plan",
      command: "cursor-agent",
      prompt: "plan this",
    });
    assert.equal(spec.command, "cursor-agent");
    assert.equal(spec.args.includes("--mode=plan"), true);
  });

  it("refuses to treat Ollama as a CLI agent", () => {
    assert.throws(
      () =>
        agentCliSpec({
          kind: "ollama",
          mode: "ask",
          command: "",
          prompt: "hi",
        }),
      { message: "Ollama runs locally, not as an agent CLI" },
    );
  });
});

describe("agent command defaults", () => {
  it("uses the published CLI names", () => {
    assert.equal(defaultAgentCommand("cursor"), "agent");
    assert.equal(defaultAgentCommand("claude"), "claude");
    assert.equal(defaultAgentCommand("codex"), "codex");
    assert.equal(resolvedAgentCommand("cursor", "  "), "agent");
    assert.equal(parseAgentKind("cursor"), "cursor");
  });
});
