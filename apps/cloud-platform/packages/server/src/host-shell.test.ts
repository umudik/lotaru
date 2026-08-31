import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hostShellSpawn, interactiveHostShell } from "./host-shell.js";

describe("hostShellSpawn", () => {
  it("runs through cmd.exe on Windows", () => {
    const spec = hostShellSpawn("win32", "npm test");
    assert.equal(spec.cmd, "cmd.exe");
    assert.deepEqual(spec.args, ["/d", "/s", "/c", "npm test"]);
  });

  it("runs through sh on unix", () => {
    const spec = hostShellSpawn("linux", "npm test");
    assert.equal(spec.cmd, "/bin/sh");
    assert.deepEqual(spec.args, ["-c", "npm test"]);
  });

  it("rejects an empty command", () => {
    assert.throws(() => hostShellSpawn("win32", "  "), {
      message: "Script command is required",
    });
  });
});

describe("interactiveHostShell", () => {
  it("uses PowerShell on Windows", () => {
    const spec = interactiveHostShell("win32");
    assert.equal(spec.cmd, "powershell.exe");
  });

  it("prefers SHELL when the binary exists", () => {
    const spec = interactiveHostShell("linux", "/bin/sh");
    assert.equal(spec.cmd, "/bin/sh");
  });

  it("falls back to sh when SHELL is missing", () => {
    const spec = interactiveHostShell("linux", "");
    assert.equal(spec.cmd === "/bin/bash" || spec.cmd === "/bin/sh", true);
  });
});
