import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHostRuntime } from "./script-runtime.js";

describe("parseHostRuntime", () => {
  it("always runs on the host shell", () => {
    assert.equal(parseHostRuntime("shell"), "shell");
    assert.equal(parseHostRuntime("docker"), "shell");
    assert.equal(parseHostRuntime(undefined), "shell");
  });

  it("rejects unknown runtimes", () => {
    assert.equal(parseHostRuntime("lambda"), "invalid");
    assert.equal(parseHostRuntime(1), "invalid");
  });
});
